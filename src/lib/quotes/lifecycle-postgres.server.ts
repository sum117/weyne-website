import type { JSONValue, Sql } from 'postgres'

import {
  QuoteLifecycleError,
  type MutableQuoteLifecyclePatch,
  type QuoteHistoryEvent,
  type QuoteLifecycleCommand,
  type QuoteLifecycleRecord,
  type QuoteLifecycleStore,
  type QuoteLifecycleTransaction,
  type QuoteStatus,
  type QuoteTransitionResult,
  type StoredQuoteLifecycleCommand,
} from './lifecycle.server'

type QuoteRow = {
  id: string
  ownerUserId: string
  status: QuoteStatus
  validUntil: string
  version: number
  revision: number
  readyToSend: boolean
  customerSnapshot: Readonly<Record<string, unknown>>
  commercialSnapshot: Readonly<Record<string, unknown>>
  sentAt: Date | null
  approvedAt: Date | null
  approvedBy: string | null
  rejectedAt: Date | null
  rejectedBy: string | null
  rejectedReason: string | null
  expiredAt: Date | null
  cancelledAt: Date | null
  cancelledBy: string | null
  cancelledReason: string | null
}

type HistoryRow = {
  id: string
  quoteId: string
  actorId: string
  actorRole: QuoteHistoryEvent['actorRole']
  occurredAt: Date
  fromStatus: QuoteStatus
  toStatus: QuoteStatus
  reason: string | null
  command: QuoteLifecycleCommand
  idempotencyKey: string
}

type SerializedTransitionResult = {
  quote: Omit<QuoteLifecycleRecord, 'sentAt' | 'approvedAt' | 'rejectedAt' | 'expiredAt' | 'cancelledAt'> & {
    sentAt: string | null
    approvedAt: string | null
    rejectedAt: string | null
    expiredAt: string | null
    cancelledAt: string | null
  }
  history: Omit<QuoteHistoryEvent, 'occurredAt'> & { occurredAt: string }
}

type CommandRow = {
  command: QuoteLifecycleCommand
  idempotencyKey: string
  payloadHash: string
  result: SerializedTransitionResult
}

function serializeResult(result: QuoteTransitionResult): SerializedTransitionResult {
  return {
    quote: {
      ...result.quote,
      sentAt: result.quote.sentAt?.toISOString() ?? null,
      approvedAt: result.quote.approvedAt?.toISOString() ?? null,
      rejectedAt: result.quote.rejectedAt?.toISOString() ?? null,
      expiredAt: result.quote.expiredAt?.toISOString() ?? null,
      cancelledAt: result.quote.cancelledAt?.toISOString() ?? null,
    },
    history: {
      ...result.history,
      occurredAt: result.history.occurredAt.toISOString(),
    },
  }
}

function deserializeResult(result: SerializedTransitionResult): QuoteTransitionResult {
  return {
    quote: {
      ...result.quote,
      sentAt: result.quote.sentAt === null ? null : new Date(result.quote.sentAt),
      approvedAt: result.quote.approvedAt === null ? null : new Date(result.quote.approvedAt),
      rejectedAt: result.quote.rejectedAt === null ? null : new Date(result.quote.rejectedAt),
      expiredAt: result.quote.expiredAt === null ? null : new Date(result.quote.expiredAt),
      cancelledAt: result.quote.cancelledAt === null ? null : new Date(result.quote.cancelledAt),
    },
    history: {
      ...result.history,
      occurredAt: new Date(result.history.occurredAt),
    },
  }
}

const quoteColumns = `
  id,
  owner_user_id AS "ownerUserId",
  status,
  valid_until::text AS "validUntil",
  version,
  revision,
  ready_to_send AS "readyToSend",
  customer_snapshot AS "customerSnapshot",
  commercial_snapshot AS "commercialSnapshot",
  sent_at AS "sentAt",
  approved_at AS "approvedAt",
  approved_by AS "approvedBy",
  rejected_at AS "rejectedAt",
  rejected_by AS "rejectedBy",
  rejected_reason AS "rejectedReason",
  expired_at AS "expiredAt",
  cancelled_at AS "cancelledAt",
  cancelled_by AS "cancelledBy",
  cancelled_reason AS "cancelledReason"
`

export function createPostgresQuoteLifecycleStore(options: {
  readonly sql: Sql
  readonly schemaName: string
}): QuoteLifecycleStore {
  const { sql, schemaName } = options
  if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
    throw new Error(`Invalid PostgreSQL schema name: ${schemaName}`)
  }
  const quotedSchema = `"${schemaName}"`

  return {
    async businessDate() {
      const rows = await sql<{ value: string }[]>`
        SELECT (clock_timestamp() AT TIME ZONE 'America/Fortaleza')::date::text AS value
      `
      return rows[0]!.value
    },
    async transaction<T>(
      _quoteId: string,
      work: (transaction: QuoteLifecycleTransaction) => Promise<T>,
    ): Promise<T> {
      return sql.begin(async (rawTransaction) => {
        const tx = rawTransaction as unknown as Sql
        await tx.unsafe(`SET LOCAL search_path TO ${quotedSchema}, public`)

        const getQuote = async (quoteId: string): Promise<QuoteLifecycleRecord | null> => {
          const rows = await tx.unsafe<QuoteRow[]>(
            `SELECT ${quoteColumns} FROM quotes WHERE id = $1 FOR UPDATE`,
            [quoteId],
          )
          return rows[0] ?? null
        }

        const transaction: QuoteLifecycleTransaction = {
          async now() {
            const rows = await tx<{ value: Date }[]>`
              SELECT clock_timestamp() AS value
            `
            return rows[0]!.value
          },
          async businessDate() {
            const rows = await tx<{ value: string }[]>`
              SELECT (clock_timestamp() AT TIME ZONE 'America/Fortaleza')::date::text AS value
            `
            return rows[0]!.value
          },
          getQuoteForUpdate: getQuote,
          async findCommand(command, idempotencyKey) {
            const rows = await tx<CommandRow[]>`
              SELECT
                command_type AS command,
                idempotency_key AS "idempotencyKey",
                payload_hash AS "payloadHash",
                result
              FROM quote_lifecycle_commands
              WHERE command_type = ${command} AND idempotency_key = ${idempotencyKey}
            `
            const row = rows[0]
            return row
              ? {
                  command: row.command,
                  idempotencyKey: row.idempotencyKey,
                  payloadHash: row.payloadHash,
                  result: deserializeResult(row.result),
                }
              : null
          },
          async updateQuote(
            quoteId: string,
            expectedVersion: number,
            patch: MutableQuoteLifecyclePatch,
          ) {
            const current = await getQuote(quoteId)
            if (!current || current.version !== expectedVersion) {
              throw new QuoteLifecycleError('CONCURRENT_MODIFICATION')
            }
            const updated = { ...current, ...patch }
            const rows = await tx.unsafe<QuoteRow[]>(
              `UPDATE quotes SET
                status = $1,
                revision = $2,
                ready_to_send = $3,
                sent_at = $4,
                approved_at = $5,
                approved_by = $6,
                rejected_at = $7,
                rejected_by = $8,
                rejected_reason = $9,
                expired_at = $10,
                cancelled_at = $11,
                cancelled_by = $12,
                cancelled_reason = $13,
                version = version + 1,
                updated_at = clock_timestamp()
              WHERE id = $14 AND version = $15
              RETURNING ${quoteColumns}`,
              [
                updated.status,
                updated.revision,
                updated.readyToSend,
                updated.sentAt,
                updated.approvedAt,
                updated.approvedBy,
                updated.rejectedAt,
                updated.rejectedBy,
                updated.rejectedReason,
                updated.expiredAt,
                updated.cancelledAt,
                updated.cancelledBy,
                updated.cancelledReason,
                quoteId,
                expectedVersion,
              ],
            )
            const saved = rows[0]
            if (!saved) throw new QuoteLifecycleError('CONCURRENT_MODIFICATION')
            return saved
          },
          async appendHistory(event) {
            const rows = await tx<HistoryRow[]>`
              INSERT INTO quote_transition_history (
                quote_id, actor_id, actor_role, from_status, to_status, reason,
                command_type, idempotency_key
              ) VALUES (
                ${event.quoteId}, ${event.actorId}, ${event.actorRole},
                ${event.fromStatus}, ${event.toStatus}, ${event.reason},
                ${event.command}, ${event.idempotencyKey}
              )
              RETURNING
                id,
                quote_id AS "quoteId",
                actor_id AS "actorId",
                actor_role AS "actorRole",
                occurred_at AS "occurredAt",
                from_status AS "fromStatus",
                to_status AS "toStatus",
                reason,
                command_type AS command,
                idempotency_key AS "idempotencyKey"
            `
            return rows[0]!
          },
          async saveCommand(command: StoredQuoteLifecycleCommand) {
            const result = serializeResult(command.result)
            const resultJson = JSON.parse(JSON.stringify(result)) as JSONValue
            await tx`
              INSERT INTO quote_lifecycle_commands (
                command_type, idempotency_key, quote_id, payload_hash, result
              ) VALUES (
                ${command.command},
                ${command.idempotencyKey},
                ${command.result.quote.id},
                ${command.payloadHash},
                ${tx.json(resultJson)}
              )
            `
          },
        }

        return work(transaction)
      }) as Promise<T>
    },
  }
}
