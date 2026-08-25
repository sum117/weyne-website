import { createHash, randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import {
  isQuoteCommandAuthorized,
  type ScopedCommandActor,
} from './command-authorization'

export const QUOTE_STATUSES = [
  'draft',
  'sent',
  'approved',
  'rejected',
  'expired',
  'converted',
  'cancelled',
] as const

export type QuoteStatus = (typeof QUOTE_STATUSES)[number]
export type QuoteLifecycleCommand =
  | 'sendQuote'
  | 'reopenQuote'
  | 'approveQuote'
  | 'rejectQuote'
  | 'expireQuote'
  | 'cancelQuote'

export type QuoteLifecycleErrorCode =
  | 'QUOTE_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_STATE_TRANSITION'
  | 'INVALID_TRANSITION_REASON'
  | 'QUOTE_NOT_READY'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'CONCURRENT_MODIFICATION'

export class QuoteLifecycleError extends Error {
  readonly code: QuoteLifecycleErrorCode

  constructor(code: QuoteLifecycleErrorCode, message = code) {
    super(message)
    this.name = 'QuoteLifecycleError'
    this.code = code
  }
}

export type QuoteLifecycleActor = ScopedCommandActor

export interface QuoteLifecycleRecord {
  readonly id: string
  readonly ownerUserId: string
  readonly status: QuoteStatus
  readonly validUntil: string
  readonly version: number
  readonly revision: number
  readonly readyToSend: boolean
  readonly customerSnapshot: Readonly<Record<string, unknown>>
  readonly commercialSnapshot: Readonly<Record<string, unknown>>
  readonly sentAt: Date | null
  readonly approvedAt: Date | null
  readonly approvedBy: string | null
  readonly rejectedAt: Date | null
  readonly rejectedBy: string | null
  readonly rejectedReason: string | null
  readonly expiredAt: Date | null
  readonly cancelledAt: Date | null
  readonly cancelledBy: string | null
  readonly cancelledReason: string | null
}

export interface QuoteHistoryEvent {
  readonly id: string
  readonly quoteId: string
  readonly actorId: string
  readonly actorRole: QuoteLifecycleActor['role']
  readonly occurredAt: Date
  readonly fromStatus: QuoteStatus
  readonly toStatus: QuoteStatus
  readonly reason: string | null
  readonly command: QuoteLifecycleCommand
  readonly idempotencyKey: string
}

export interface QuoteTransitionResult {
  readonly quote: QuoteLifecycleRecord
  readonly history: QuoteHistoryEvent
}

export interface StoredQuoteLifecycleCommand {
  readonly command: QuoteLifecycleCommand
  readonly idempotencyKey: string
  readonly payloadHash: string
  readonly result: QuoteTransitionResult
}

export interface QuoteLifecycleTransaction {
  now(): Promise<Date>
  getQuoteForUpdate(quoteId: string): Promise<QuoteLifecycleRecord | null>
  businessDate(): Promise<string>
  findCommand(
    command: QuoteLifecycleCommand,
    idempotencyKey: string,
  ): Promise<StoredQuoteLifecycleCommand | null>
  updateQuote(
    quoteId: string,
    expectedVersion: number,
    patch: MutableQuoteLifecyclePatch,
  ): Promise<QuoteLifecycleRecord>
  appendHistory(
    event: Omit<QuoteHistoryEvent, 'id' | 'occurredAt'>,
  ): Promise<QuoteHistoryEvent>
  saveCommand(command: StoredQuoteLifecycleCommand): Promise<void>
}

export interface QuoteLifecycleStore {
  businessDate(): Promise<string>
  transaction<T>(
    quoteId: string,
    work: (transaction: QuoteLifecycleTransaction) => Promise<T>,
  ): Promise<T>
}

export interface QuoteLifecycleStoreSnapshot {
  readonly quotes: readonly QuoteLifecycleRecord[]
  readonly history: readonly QuoteHistoryEvent[]
  readonly commands: readonly StoredQuoteLifecycleCommand[]
}

export type MutableQuoteLifecyclePatch = {
  -readonly [Key in keyof QuoteLifecycleRecord]?: QuoteLifecycleRecord[Key]
}

function cloneQuote(quote: QuoteLifecycleRecord): QuoteLifecycleRecord {
  return structuredClone(quote)
}

export function createInMemoryQuoteLifecycleStore(options: {
  readonly quotes?: readonly QuoteLifecycleRecord[]
  readonly now?: () => Date
  readonly failAppendHistory?: () => Error
} = {}): QuoteLifecycleStore & { snapshot(): QuoteLifecycleStoreSnapshot } {
  let quotes = new Map((options.quotes ?? []).map((quote) => [quote.id, cloneQuote(quote)]))
  let history: QuoteHistoryEvent[] = []
  let commands = new Map<string, StoredQuoteLifecycleCommand>()
  const locks = new Map<string, Promise<void>>()
  const now = options.now ?? (() => new Date())

  return {
    async transaction<T>(
      quoteId: string,
      work: (transaction: QuoteLifecycleTransaction) => Promise<T>,
    ) {
      const previous = locks.get(quoteId) ?? Promise.resolve()
      let release: () => void = () => undefined
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      const queued = previous.then(() => current)
      locks.set(quoteId, queued)
      await previous

      const workingQuotes = new Map(
        [...quotes].map(([id, quote]) => [id, cloneQuote(quote)]),
      )
      const workingHistory = structuredClone(history)
      const workingCommands = structuredClone(commands)

      const transaction: QuoteLifecycleTransaction = {
        async now() {
          return now()
        },
        async businessDate() {
          return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Fortaleza',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(now())
        },
        async getQuoteForUpdate(id) {
          const quote = workingQuotes.get(id)
          return quote ? cloneQuote(quote) : null
        },
        async findCommand(command, idempotencyKey) {
          return workingCommands.get(`${command}:${idempotencyKey}`) ?? null
        },
        async updateQuote(id, expectedVersion, patch) {
          const quote = workingQuotes.get(id)
          if (!quote || quote.version !== expectedVersion) {
            throw new QuoteLifecycleError('CONCURRENT_MODIFICATION')
          }
          const updated = cloneQuote({
            ...quote,
            ...patch,
            version: expectedVersion + 1,
          })
          workingQuotes.set(id, updated)
          return cloneQuote(updated)
        },
        async appendHistory(event) {
          const failure = options.failAppendHistory?.()
          if (failure) throw failure
          const saved: QuoteHistoryEvent = {
            ...event,
            id: randomUUID(),
            occurredAt: now(),
          }
          workingHistory.push(saved)
          return structuredClone(saved)
        },
        async saveCommand(command) {
          workingCommands.set(
            `${command.command}:${command.idempotencyKey}`,
            structuredClone(command),
          )
        },
      }

      try {
        const result = await work(transaction)
        quotes = workingQuotes
        history = workingHistory
        commands = workingCommands
        return result
      } finally {
        release()
        if (locks.get(quoteId) === queued) locks.delete(quoteId)
      }
    },
    async businessDate() {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Fortaleza',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now())
    },
    snapshot() {
      return {
        quotes: [...quotes.values()].map(cloneQuote),
        history: structuredClone(history),
        commands: [...commands.values()].map((command) => structuredClone(command)),
      }
    },
  }
}

function payloadHash(input: {
  readonly quoteId: string
  readonly command: QuoteLifecycleCommand
  readonly reason: string | null
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function isAuthorized(
  actor: QuoteLifecycleActor,
  quote: QuoteLifecycleRecord,
  command: QuoteLifecycleCommand,
): boolean {
  // Centralized matrix decision (command-authorization.ts): capability first,
  // then own-assigned record scope. Replaces the legacy permission-string
  // scheme; `expireQuote` resolves through the dedicated system grant.
  return isQuoteCommandAuthorized({
    actor,
    ownerUserId: quote.ownerUserId,
    command,
  })
}

const REQUIRED_REASON_COMMANDS = new Set<QuoteLifecycleCommand>([
  'reopenQuote',
  'rejectQuote',
  'cancelQuote',
])

const TRANSITION_TARGETS: Readonly<
  Record<QuoteLifecycleCommand, Readonly<Partial<Record<QuoteStatus, QuoteStatus>>>>
> = {
  sendQuote: { draft: 'sent' },
  reopenQuote: { sent: 'draft' },
  approveQuote: { sent: 'approved' },
  rejectQuote: { sent: 'rejected' },
  expireQuote: { sent: 'expired' },
  cancelQuote: { draft: 'cancelled', sent: 'cancelled', approved: 'cancelled' },
}

export function getEffectiveQuoteStatus(
  quote: Pick<QuoteLifecycleRecord, 'status' | 'validUntil'>,
  businessDate: string,
): QuoteStatus {
  return quote.status === 'sent' && businessDate > quote.validUntil
    ? 'expired'
    : quote.status
}

export interface QuoteListReadModel {
  readonly id: string
  readonly ownerUserId: string
  readonly status: QuoteStatus
  readonly validUntil: string
  readonly revision: number
  readonly version: number
}

export type QuoteDetailReadModel = QuoteLifecycleRecord

export function toQuoteListReadModel(
  quote: QuoteLifecycleRecord,
  businessDate: string,
): QuoteListReadModel {
  return {
    id: quote.id,
    ownerUserId: quote.ownerUserId,
    status: getEffectiveQuoteStatus(quote, businessDate),
    validUntil: quote.validUntil,
    revision: quote.revision,
    version: quote.version,
  }
}

export function toQuoteDetailReadModel(
  quote: QuoteLifecycleRecord,
  businessDate: string,
): QuoteDetailReadModel {
  return {
    ...quote,
    status: getEffectiveQuoteStatus(quote, businessDate),
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isDecimal(value: unknown, minimum: Decimal.Value): boolean {
  if (!isNonBlankString(value)) return false
  try {
    const decimal = new Decimal(value)
    return decimal.isFinite() && decimal.greaterThanOrEqualTo(minimum)
  } catch {
    return false
  }
}

function isPercentage(value: unknown): value is string {
  return (
    isNonBlankString(value) &&
    isDecimal(value, 0) &&
    new Decimal(value).lessThanOrEqualTo(100)
  )
}

function money(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

/**
 * Pure commercial-completeness gate for `sendQuote`. Exported so deployment
 * boundaries (autosave, workflow harnesses) evaluate readiness with the SAME
 * rules the lifecycle service enforces — never a drifted copy.
 */
export function isQuoteReadyToSend(
  quote: Pick<QuoteLifecycleRecord, 'customerSnapshot' | 'commercialSnapshot'>,
): boolean {
  return hasCompleteCommercialSnapshots({
    ...(quote as QuoteLifecycleRecord),
    status: 'draft',
    validUntil: '9999-12-31',
  })
}

function hasCompleteCommercialSnapshots(quote: QuoteLifecycleRecord): boolean {
  const customer = quote.customerSnapshot
  const commercial = quote.commercialSnapshot
  if (!isNonBlankString(customer.id)) return false
  if (!['PRICE_1', 'PRICE_2', 'PRICE_3', 'PRICE_4'].includes(String(commercial.priceListKey))) {
    return false
  }
  if (!Array.isArray(commercial.lines) || commercial.lines.length === 0) return false
  if (!isPercentage(commercial.generalDiscountRate) || !isDecimal(commercial.freight, 0)) {
    return false
  }
  if (
    !commercial.lines.every(
      (line) =>
        isRecord(line) &&
        isNonBlankString(line.productId) &&
        isNonBlankString(line.internalCode) &&
        isNonBlankString(line.description) &&
        isNonBlankString(line.unit) &&
        isDecimal(line.quantity, '0.0000001') &&
        isDecimal(line.unitPrice, 0) &&
        isPercentage(line.lineDiscountRate),
    )
  ) {
    return false
  }
  if (!isRecord(commercial.totals)) return false
  if (
    !isDecimal(commercial.totals.merchandiseGross, 0) ||
    !isDecimal(commercial.totals.merchandiseNet, 0) ||
    !isDecimal(commercial.totals.total, 0)
  ) {
    return false
  }

  let grossTotal = new Decimal(0)
  let netBeforeGeneralDiscount = new Decimal(0)
  for (const line of commercial.lines) {
    if (!isRecord(line)) return false
    const gross = money(new Decimal(String(line.quantity)).times(String(line.unitPrice)))
    const lineDiscount = money(gross.times(String(line.lineDiscountRate)).dividedBy(100))
    grossTotal = grossTotal.plus(gross)
    netBeforeGeneralDiscount = netBeforeGeneralDiscount.plus(gross.minus(lineDiscount))
  }
  const generalDiscount = money(
    netBeforeGeneralDiscount.times(commercial.generalDiscountRate).dividedBy(100),
  )
  const merchandiseNet = money(netBeforeGeneralDiscount.minus(generalDiscount))
  const total = money(merchandiseNet.plus(String(commercial.freight)))

  return (
    money(grossTotal).equals(String(commercial.totals.merchandiseGross)) &&
    merchandiseNet.equals(String(commercial.totals.merchandiseNet)) &&
    total.equals(String(commercial.totals.total))
  )
}

export function createQuoteLifecycleService(options: {
  readonly store: QuoteLifecycleStore
  readonly businessDate?: () => string
}) {
  const resolveBusinessDate = () =>
    options.businessDate ? Promise.resolve(options.businessDate()) : options.store.businessDate()

  return {
    async toListReadModel(quote: QuoteLifecycleRecord): Promise<QuoteListReadModel> {
      return toQuoteListReadModel(quote, await resolveBusinessDate())
    },
    async toDetailReadModel(quote: QuoteLifecycleRecord): Promise<QuoteDetailReadModel> {
      return toQuoteDetailReadModel(quote, await resolveBusinessDate())
    },
    async transition(input: {
      readonly quoteId: string
      readonly command: QuoteLifecycleCommand
      readonly actor: QuoteLifecycleActor
      readonly idempotencyKey: string
      readonly reason?: string
    }): Promise<QuoteTransitionResult> {
      if (!input.idempotencyKey.trim()) {
        throw new QuoteLifecycleError('IDEMPOTENCY_KEY_REQUIRED')
      }

      const reason = input.reason?.trim() || null
      const hash = payloadHash({
        quoteId: input.quoteId,
        command: input.command,
        reason,
      })

      return options.store.transaction(input.quoteId, async (transaction) => {
        const quote = await transaction.getQuoteForUpdate(input.quoteId)
        if (!quote) throw new QuoteLifecycleError('QUOTE_NOT_FOUND')
        if (!isAuthorized(input.actor, quote, input.command)) {
          throw new QuoteLifecycleError('FORBIDDEN')
        }

        const previous = await transaction.findCommand(
          input.command,
          input.idempotencyKey,
        )
        if (previous) {
          if (previous.payloadHash !== hash) {
            throw new QuoteLifecycleError('IDEMPOTENCY_KEY_REUSED')
          }
          return previous.result
        }

        if (REQUIRED_REASON_COMMANDS.has(input.command) && !reason) {
          throw new QuoteLifecycleError('INVALID_TRANSITION_REASON')
        }
        if (
          !REQUIRED_REASON_COMMANDS.has(input.command) &&
          input.command !== 'approveQuote' &&
          reason
        ) {
          throw new QuoteLifecycleError('INVALID_TRANSITION_REASON')
        }

        const businessDate = options.businessDate?.() ?? (await transaction.businessDate())
        const effectiveStatus = getEffectiveQuoteStatus(quote, businessDate)
        if (input.command !== 'expireQuote' && effectiveStatus !== quote.status) {
          throw new QuoteLifecycleError('INVALID_STATE_TRANSITION')
        }
        const toStatus = TRANSITION_TARGETS[input.command][quote.status]
        if (!toStatus) {
          throw new QuoteLifecycleError('INVALID_STATE_TRANSITION')
        }
        if (input.command === 'expireQuote' && businessDate <= quote.validUntil) {
          throw new QuoteLifecycleError('INVALID_STATE_TRANSITION')
        }
        if (
          (input.command === 'approveQuote' || input.command === 'rejectQuote') &&
          businessDate > quote.validUntil
        ) {
          throw new QuoteLifecycleError('INVALID_STATE_TRANSITION')
        }
        if (
          input.command === 'sendQuote' &&
          (!quote.readyToSend ||
            !hasCompleteCommercialSnapshots(quote) ||
            quote.validUntil < businessDate)
        ) {
          throw new QuoteLifecycleError('QUOTE_NOT_READY')
        }
        if (input.command === 'approveQuote' && !hasCompleteCommercialSnapshots(quote)) {
          throw new QuoteLifecycleError('QUOTE_NOT_READY')
        }

        const occurredAt = await transaction.now()
        const patch: MutableQuoteLifecyclePatch = { status: toStatus }
        if (input.command === 'sendQuote') {
          patch.revision = quote.revision + 1
          patch.sentAt = occurredAt
        } else if (input.command === 'reopenQuote') {
          patch.sentAt = null
        } else if (input.command === 'approveQuote') {
          patch.approvedAt = occurredAt
          patch.approvedBy = input.actor.id
        } else if (input.command === 'rejectQuote') {
          patch.rejectedAt = occurredAt
          patch.rejectedBy = input.actor.id
          patch.rejectedReason = reason
        } else if (input.command === 'expireQuote') {
          patch.expiredAt = occurredAt
        } else if (input.command === 'cancelQuote') {
          patch.cancelledAt = occurredAt
          patch.cancelledBy = input.actor.id
          patch.cancelledReason = reason
        }

        const updated = await transaction.updateQuote(quote.id, quote.version, patch)
        const event = await transaction.appendHistory({
          quoteId: quote.id,
          actorId: input.actor.id,
          actorRole: input.actor.role,
          fromStatus: quote.status,
          toStatus,
          reason,
          command: input.command,
          idempotencyKey: input.idempotencyKey,
        })
        const result = { quote: updated, history: event }
        await transaction.saveCommand({
          command: input.command,
          idempotencyKey: input.idempotencyKey,
          payloadHash: hash,
          result,
        })
        return result
      })
    },
  }
}
