import { createHash, randomUUID } from 'node:crypto'
import {
  isQuoteMutationAuthorized,
  type QuoteMutationActor,
} from './authorization.server'
import type { QuoteStatus } from './lifecycle.server'

export type QuoteDuplicationErrorCode =
  | 'QUOTE_NOT_FOUND'
  | 'FORBIDDEN'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SNAPSHOT_REFRESH_FAILED'

export class QuoteDuplicationError extends Error {
  readonly code: QuoteDuplicationErrorCode

  constructor(code: QuoteDuplicationErrorCode, message: string = code) {
    super(message)
    this.name = 'QuoteDuplicationError'
    this.code = code
  }
}

export interface QuotePartySnapshot {
  readonly id: string
  readonly active: boolean
  readonly legalName: string
}

export interface QuotePriceListSnapshot {
  readonly id: string
  readonly active: boolean
  readonly key: string
  readonly name: string
}

export interface QuoteLineCommercialSnapshot {
  readonly productCode: string
  readonly description: string
  readonly unit: string
  readonly industry: Readonly<{ id: string; name: string }>
  readonly price: Readonly<{
    productPriceId: string
    unitPrice: string
    currencyCode: string
  }>
  readonly [key: string]: unknown
}

export interface DuplicableQuoteLine {
  readonly id: string
  readonly productId: string
  readonly position: number
  readonly quantity: string
  readonly discount: Readonly<{ kind: string; value: string }> | null
  readonly snapshot: QuoteLineCommercialSnapshot
  readonly storageReferences: readonly string[]
}

export interface DuplicableQuote {
  readonly id: string
  readonly number: string
  readonly status: QuoteStatus
  readonly ownerUserId: string
  readonly customer: QuotePartySnapshot | null
  readonly priceList: QuotePriceListSnapshot | null
  readonly validUntil: string | null
  readonly paymentTerms: string | null
  readonly notes: string | null
  readonly lifecycle: Readonly<Record<string, Date | string | null>>
  readonly storageReferences: readonly string[]
  readonly lines: readonly DuplicableQuoteLine[]
  readonly duplicatedFromQuoteId?: string
  readonly createdAt?: Date
  readonly createdBy?: string
}

export interface QuoteDuplicationEvent {
  readonly id: string
  readonly quoteId: string
  readonly sourceQuoteId: string
  readonly actorId: string
  readonly actorRole: QuoteMutationActor['role']
  readonly eventType: 'quote_duplicated'
  readonly occurredAt: Date
  readonly idempotencyKey: string
}

export interface QuoteDuplicationResult {
  readonly quote: DuplicableQuote
  readonly event: QuoteDuplicationEvent
}

interface StoredDuplicationCommand {
  readonly idempotencyKey: string
  readonly payloadHash: string
  readonly result: QuoteDuplicationResult
}

export interface QuoteDuplicationTransaction {
  getQuoteForUpdate(quoteId: string): Promise<DuplicableQuote | null>
  findCommand(idempotencyKey: string): Promise<StoredDuplicationCommand | null>
  allocateQuoteNumber(at: Date): Promise<string>
  insertQuote(quote: DuplicableQuote): Promise<void>
  appendEvent(event: QuoteDuplicationEvent): Promise<void>
  saveCommand(command: StoredDuplicationCommand): Promise<void>
}

export interface QuoteDuplicationStore {
  transaction<T>(work: (transaction: QuoteDuplicationTransaction) => Promise<T>): Promise<T>
}

export interface QuoteDuplicationStoreSnapshot {
  readonly quotes: readonly DuplicableQuote[]
  readonly events: readonly QuoteDuplicationEvent[]
  readonly commands: readonly StoredDuplicationCommand[]
  readonly nextSequence: number
}

function businessYear(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
  }).formatToParts(at)
  return parts.find((part) => part.type === 'year')!.value
}

function cloneQuote(quote: DuplicableQuote): DuplicableQuote {
  return structuredClone(quote)
}

export function createInMemoryQuoteDuplicationStore(options: {
  readonly quotes?: readonly DuplicableQuote[]
  readonly firstSequence?: number
} = {}): QuoteDuplicationStore & { snapshot(): QuoteDuplicationStoreSnapshot } {
  let quotes = new Map((options.quotes ?? []).map((quote) => [quote.id, cloneQuote(quote)]))
  let events: QuoteDuplicationEvent[] = []
  let commands = new Map<string, StoredDuplicationCommand>()
  let nextSequence = options.firstSequence ?? 1
  let lock = Promise.resolve()

  return {
    async transaction<T>(work: (transaction: QuoteDuplicationTransaction) => Promise<T>) {
      const previous = lock
      let release: () => void = () => undefined
      lock = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous

      const workingQuotes = new Map(
        [...quotes].map(([id, quote]) => [id, cloneQuote(quote)]),
      )
      const workingEvents = structuredClone(events)
      const workingCommands = structuredClone(commands)
      let workingNextSequence = nextSequence

      const transaction: QuoteDuplicationTransaction = {
        async getQuoteForUpdate(id) {
          const quote = workingQuotes.get(id)
          return quote ? cloneQuote(quote) : null
        },
        async findCommand(idempotencyKey) {
          const command = workingCommands.get(idempotencyKey)
          return command ? structuredClone(command) : null
        },
        async allocateQuoteNumber(at) {
          const sequence = workingNextSequence++
          return `ORC-${businessYear(at)}-${String(sequence).padStart(6, '0')}`
        },
        async insertQuote(quote) {
          if (workingQuotes.has(quote.id)) throw new Error('duplicate quote id')
          if ([...workingQuotes.values()].some((item) => item.number === quote.number)) {
            throw new Error('duplicate quote number')
          }
          workingQuotes.set(quote.id, cloneQuote(quote))
        },
        async appendEvent(event) {
          workingEvents.push(structuredClone(event))
        },
        async saveCommand(command) {
          workingCommands.set(command.idempotencyKey, structuredClone(command))
        },
      }

      try {
        const result = await work(transaction)
        quotes = workingQuotes
        events = workingEvents
        commands = workingCommands
        nextSequence = workingNextSequence
        return result
      } finally {
        release()
      }
    },
    snapshot() {
      return {
        quotes: [...quotes.values()].map(cloneQuote),
        events: structuredClone(events),
        commands: [...commands.values()].map((command) => structuredClone(command)),
        nextSequence,
      }
    },
  }
}

function commandHash(sourceQuoteId: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ command: 'duplicateQuote', sourceQuoteId }))
    .digest('hex')
}

export function createQuoteDuplicationService(options: {
  readonly store: QuoteDuplicationStore
  readonly createId?: () => string
  readonly now?: () => Date
  readonly refreshLine: (
    line: DuplicableQuoteLine,
    context: Readonly<{
      customer: QuotePartySnapshot | null
      priceList: QuotePriceListSnapshot | null
    }>,
  ) => Promise<QuoteLineCommercialSnapshot>
}) {
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date())

  return {
    async duplicate(input: {
      readonly sourceQuoteId: string
      readonly actor: QuoteMutationActor
      readonly idempotencyKey: string
    }): Promise<QuoteDuplicationResult> {
      const idempotencyKey = input.idempotencyKey.trim()
      if (!idempotencyKey) {
        throw new QuoteDuplicationError('IDEMPOTENCY_KEY_REQUIRED')
      }
      const payloadHash = commandHash(input.sourceQuoteId)

      return options.store.transaction(async (transaction) => {
        const source = await transaction.getQuoteForUpdate(input.sourceQuoteId)
        if (!source) throw new QuoteDuplicationError('QUOTE_NOT_FOUND')
        if (
          !isQuoteMutationAuthorized({
            actor: input.actor,
            ownerUserId: source.ownerUserId,
            permission: 'quotes:duplicate',
          })
        ) {
          throw new QuoteDuplicationError('FORBIDDEN')
        }

        const previous = await transaction.findCommand(idempotencyKey)
        if (previous) {
          if (previous.payloadHash !== payloadHash) {
            throw new QuoteDuplicationError('IDEMPOTENCY_KEY_REUSED')
          }
          return structuredClone(previous.result)
        }

        const occurredAt = now()
        const customer = source.customer?.active ? structuredClone(source.customer) : null
        const priceList = source.priceList?.active ? structuredClone(source.priceList) : null
        const quoteId = createId()
        const lines: DuplicableQuoteLine[] = []
        for (const sourceLine of source.lines) {
          let snapshot: QuoteLineCommercialSnapshot
          try {
            snapshot = await options.refreshLine(sourceLine, { customer, priceList })
          } catch (error) {
            throw new QuoteDuplicationError(
              'SNAPSHOT_REFRESH_FAILED',
              error instanceof Error ? error.message : undefined,
            )
          }
          lines.push({
            id: createId(),
            productId: sourceLine.productId,
            position: sourceLine.position,
            quantity: sourceLine.quantity,
            discount: sourceLine.discount ? structuredClone(sourceLine.discount) : null,
            snapshot: structuredClone(snapshot),
            storageReferences: [],
          })
        }

        const quote: DuplicableQuote = {
          id: quoteId,
          number: await transaction.allocateQuoteNumber(occurredAt),
          status: 'draft',
          ownerUserId: source.ownerUserId,
          customer,
          priceList,
          validUntil: null,
          paymentTerms: source.paymentTerms,
          notes: source.notes,
          lifecycle: {},
          storageReferences: [],
          lines,
          duplicatedFromQuoteId: source.id,
          createdAt: occurredAt,
          createdBy: input.actor.id,
        }
        const event: QuoteDuplicationEvent = {
          id: createId(),
          quoteId,
          sourceQuoteId: source.id,
          actorId: input.actor.id,
          actorRole: input.actor.role,
          eventType: 'quote_duplicated',
          occurredAt,
          idempotencyKey,
        }
        const result = { quote, event }

        await transaction.insertQuote(quote)
        await transaction.appendEvent(event)
        await transaction.saveCommand({ idempotencyKey, payloadHash, result })
        return structuredClone(result)
      })
    },
  }
}
