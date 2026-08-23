import type { Sql } from 'postgres'

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
export type QuoteActor = Readonly<{
  id: string
  role: 'admin' | 'representative' | 'read_only' | 'system'
}>
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined }
export type JsonObject = Readonly<Record<string, JsonValue | undefined>>

export type PersistedQuote = Readonly<{
  id: string
  quoteNumber: string
  sourceQuoteId: string | null
  ownerUserId: string
  status: QuoteStatus
  validUntil: string
  version: number
  customerSnapshot: JsonObject
  commercialSnapshot: JsonObject
}>

export type CreateQuoteInput = Readonly<{
  ownerUserId: string
  validUntil: string
  customerSnapshot: JsonObject
  commercialSnapshot: JsonObject
  actor: QuoteActor
  commandId: string
}>

export type QuotePersistenceErrorCode =
  | 'QUOTE_NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'TRANSITION_REASON_REQUIRED'
  | 'QUOTE_NOT_EDITABLE'
  | 'CONCURRENT_MODIFICATION'

export class QuotePersistenceError extends Error {
  readonly code: QuotePersistenceErrorCode
  readonly currentVersion?: number

  constructor(
    code: QuotePersistenceErrorCode,
    options: Readonly<{ currentVersion?: number; message?: string }> = {},
  ) {
    super(options.message ?? code)
    this.name = 'QuotePersistenceError'
    this.code = code
    this.currentVersion = options.currentVersion
  }
}

type QuoteRow = {
  id: string
  quoteNumber: string
  sourceQuoteId: string | null
  ownerUserId: string
  status: QuoteStatus
  validUntil: string
  version: number
  customerSnapshot: JsonObject
  commercialSnapshot: JsonObject
}

type VersionRow = {
  quoteId: string
  version: number
  operation: QuoteOperation
  snapshot: JsonObject
  createdAt: Date
}

type AuditRow = {
  id: string
  quoteId: string
  actorId: string
  actorRole: QuoteActor['role']
  operation: QuoteOperation
  version: number
  commandId: string
  beforeState: JsonObject | null
  afterState: JsonObject
  occurredAt: Date
}

type QuoteOperation = 'create' | 'update' | 'transition' | 'duplicate'

const allowedTransitions: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  draft: ['sent', 'cancelled'],
  sent: ['draft', 'approved', 'rejected', 'expired', 'cancelled'],
  approved: ['converted', 'cancelled'],
  rejected: [],
  expired: [],
  converted: [],
  cancelled: [],
}

export function createPostgresQuoteRepository(options: {
  readonly sql: Sql
  readonly schemaName: string
}) {
  const { sql, schemaName } = options
  if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
    throw new Error(`Invalid PostgreSQL schema name: ${schemaName}`)
  }
  const quotedSchema = `"${schemaName}"`

  async function transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${quotedSchema}, public`)
      return work(tx as unknown as Sql)
    }) as Promise<T>
  }

  async function useSchema(): Promise<void> {
    await sql.unsafe(`SET search_path TO ${quotedSchema}, public`)
  }

  async function allocateQuoteNumber(tx: Sql): Promise<string> {
    const yearRows = await tx<{ year: number }[]>`
      SELECT extract(year FROM statement_timestamp() AT TIME ZONE 'America/Fortaleza')::integer AS year
    `
    const year = yearRows[0]!.year
    const sequenceRows = await tx<{ value: string }[]>`
      INSERT INTO document_sequences (document_type, year, next_value)
      VALUES ('quote', ${year}, 1)
      ON CONFLICT (document_type, year)
      DO UPDATE SET next_value = document_sequences.next_value + 1
      RETURNING next_value::text AS value
    `
    return `ORC-${year}-${sequenceRows[0]!.value.padStart(6, '0')}`
  }

  function snapshotOf(quote: PersistedQuote): JsonObject {
    return {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      sourceQuoteId: quote.sourceQuoteId,
      ownerUserId: quote.ownerUserId,
      status: quote.status,
      validUntil: quote.validUntil,
      version: quote.version,
      customerSnapshot: quote.customerSnapshot,
      commercialSnapshot: quote.commercialSnapshot,
    }
  }

  function stateOf(quote: PersistedQuote): JsonObject {
    return { status: quote.status, version: quote.version }
  }

  async function appendHistory(
    tx: Sql,
    quote: PersistedQuote,
    operation: QuoteOperation,
    actor: QuoteActor,
    commandId: string,
    beforeState: JsonObject | null,
  ): Promise<void> {
    await tx`
      INSERT INTO quote_versions (quote_id, version, operation, snapshot)
      VALUES (
        ${quote.id},
        ${quote.version},
        ${operation},
        ${JSON.stringify(snapshotOf(quote))}::text::jsonb
      )
    `
    await tx`
      INSERT INTO quote_audit (
        quote_id, actor_id, actor_role, operation, version, command_id,
        before_state, after_state
      ) VALUES (
        ${quote.id},
        ${actor.id},
        ${actor.role},
        ${operation},
        ${quote.version},
        ${commandId},
        ${beforeState === null ? null : JSON.stringify(beforeState)}::text::jsonb,
        ${JSON.stringify(stateOf(quote))}::text::jsonb
      )
    `
  }

  async function getInTransaction(tx: Sql, quoteId: string, lock = false) {
    const lockClause = lock ? ' FOR UPDATE' : ''
    const rows = await tx.unsafe<QuoteRow[]>(
      `SELECT
        id,
        quote_number AS "quoteNumber",
        source_quote_id AS "sourceQuoteId",
        owner_user_id AS "ownerUserId",
        status,
        valid_until::text AS "validUntil",
        version,
        customer_snapshot AS "customerSnapshot",
        commercial_snapshot AS "commercialSnapshot"
      FROM quotes
      WHERE id = $1${lockClause}`,
      [quoteId],
    )
    return rows[0] ?? null
  }

  async function insertQuote(
    tx: Sql,
    input: CreateQuoteInput & Readonly<{
      operation: 'create' | 'duplicate'
      sourceQuoteId: string | null
    }>,
  ): Promise<PersistedQuote> {
    const quoteNumber = await allocateQuoteNumber(tx)
    const rows = await tx<QuoteRow[]>`
      INSERT INTO quotes (
        quote_number, source_quote_id, owner_user_id, status, valid_until, version,
        customer_snapshot, commercial_snapshot
      ) VALUES (
        ${quoteNumber},
        ${input.sourceQuoteId},
        ${input.ownerUserId},
        'draft',
        ${input.validUntil},
        1,
        ${JSON.stringify(input.customerSnapshot)}::text::jsonb,
        ${JSON.stringify(input.commercialSnapshot)}::text::jsonb
      )
      RETURNING
        id,
        quote_number AS "quoteNumber",
        source_quote_id AS "sourceQuoteId",
        owner_user_id AS "ownerUserId",
        status,
        valid_until::text AS "validUntil",
        version,
        customer_snapshot AS "customerSnapshot",
        commercial_snapshot AS "commercialSnapshot"
    `
    const quote = rows[0]!
    await appendHistory(tx, quote, input.operation, input.actor, input.commandId, null)
    return quote
  }

  return {
    async create(input: CreateQuoteInput): Promise<PersistedQuote> {
      return transaction((tx) =>
        insertQuote(tx, { ...input, operation: 'create', sourceQuoteId: null }),
      )
    },

    async get(quoteId: string): Promise<PersistedQuote | null> {
      await useSchema()
      return getInTransaction(sql, quoteId)
    },

    async updateDraft(input: Readonly<{
      quoteId: string
      expectedVersion: number
      commercialSnapshot: JsonObject
      actor: QuoteActor
      commandId: string
    }>): Promise<PersistedQuote> {
      return transaction(async (tx) => {
        const current = await getInTransaction(tx, input.quoteId, true)
        if (!current) throw new QuotePersistenceError('QUOTE_NOT_FOUND')
        if (current.version !== input.expectedVersion) {
          throw new QuotePersistenceError('CONCURRENT_MODIFICATION', {
            currentVersion: current.version,
          })
        }
        if (current.status !== 'draft') {
          throw new QuotePersistenceError('QUOTE_NOT_EDITABLE')
        }

        const rows = await tx<QuoteRow[]>`
          UPDATE quotes
          SET commercial_snapshot = ${JSON.stringify(input.commercialSnapshot)}::text::jsonb,
              version = version + 1,
              updated_at = date_trunc('milliseconds', clock_timestamp())
          WHERE id = ${input.quoteId} AND version = ${input.expectedVersion}
          RETURNING
            id,
            quote_number AS "quoteNumber",
            source_quote_id AS "sourceQuoteId",
            owner_user_id AS "ownerUserId",
            status,
            valid_until::text AS "validUntil",
            version,
            customer_snapshot AS "customerSnapshot",
            commercial_snapshot AS "commercialSnapshot"
        `
        const updated = rows[0]
        if (!updated) {
          const latest = await getInTransaction(tx, input.quoteId)
          throw new QuotePersistenceError('CONCURRENT_MODIFICATION', {
            currentVersion: latest?.version,
          })
        }
        await appendHistory(
          tx,
          updated,
          'update',
          input.actor,
          input.commandId,
          stateOf(current),
        )
        return updated
      })
    },

    async transition(input: Readonly<{
      quoteId: string
      expectedVersion: number
      toStatus: QuoteStatus
      actor: QuoteActor
      commandId: string
      reason?: string
    }>): Promise<PersistedQuote> {
      return transaction(async (tx) => {
        const current = await getInTransaction(tx, input.quoteId, true)
        if (!current) throw new QuotePersistenceError('QUOTE_NOT_FOUND')
        if (current.version !== input.expectedVersion) {
          throw new QuotePersistenceError('CONCURRENT_MODIFICATION', {
            currentVersion: current.version,
          })
        }
        if (!allowedTransitions[current.status].includes(input.toStatus)) {
          throw new QuotePersistenceError('INVALID_STATE_TRANSITION', {
            message: `Cannot transition quote from ${current.status} to ${input.toStatus}`,
          })
        }
        if (
          (input.toStatus === 'rejected' || input.toStatus === 'cancelled') &&
          !input.reason?.trim()
        ) {
          throw new QuotePersistenceError('TRANSITION_REASON_REQUIRED')
        }

        const rows = await tx<QuoteRow[]>`
          UPDATE quotes
          SET status = ${input.toStatus}, version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp())
          WHERE id = ${input.quoteId} AND version = ${input.expectedVersion}
          RETURNING
            id,
            quote_number AS "quoteNumber",
            source_quote_id AS "sourceQuoteId",
            owner_user_id AS "ownerUserId",
            status,
            valid_until::text AS "validUntil",
            version,
            customer_snapshot AS "customerSnapshot",
            commercial_snapshot AS "commercialSnapshot"
        `
        const updated = rows[0]
        if (!updated) {
          throw new QuotePersistenceError('CONCURRENT_MODIFICATION')
        }
        await appendHistory(
          tx,
          updated,
          'transition',
          input.actor,
          input.commandId,
          stateOf(current),
        )
        return updated
      })
    },

    async duplicate(input: Readonly<{
      sourceQuoteId: string
      validUntil: string
      actor: QuoteActor
      commandId: string
    }>): Promise<PersistedQuote> {
      return transaction(async (tx) => {
        const source = await getInTransaction(tx, input.sourceQuoteId, true)
        if (!source) throw new QuotePersistenceError('QUOTE_NOT_FOUND')
        return insertQuote(tx, {
          ownerUserId: source.ownerUserId,
          validUntil: input.validUntil,
          customerSnapshot: source.customerSnapshot,
          commercialSnapshot: source.commercialSnapshot,
          actor: input.actor,
          commandId: input.commandId,
          operation: 'duplicate',
          sourceQuoteId: source.id,
        })
      })
    },

    async listVersions(quoteId: string): Promise<readonly VersionRow[]> {
      await useSchema()
      return sql<VersionRow[]>`
        SELECT
          quote_id AS "quoteId",
          version,
          operation,
          snapshot,
          created_at AS "createdAt"
        FROM quote_versions
        WHERE quote_id = ${quoteId}
        ORDER BY version
      `
    },

    async listAudit(quoteId: string): Promise<readonly AuditRow[]> {
      await useSchema()
      return sql<AuditRow[]>`
        SELECT
          id,
          quote_id AS "quoteId",
          actor_id AS "actorId",
          actor_role AS "actorRole",
          operation,
          version,
          command_id AS "commandId",
          before_state AS "beforeState",
          after_state AS "afterState",
          occurred_at AS "occurredAt"
        FROM quote_audit
        WHERE quote_id = ${quoteId}
        ORDER BY version, occurred_at, id
      `
    },

    async listQuoteNumbers(): Promise<readonly string[]> {
      await useSchema()
      const rows = await sql<{ quoteNumber: string }[]>`
        SELECT quote_number AS "quoteNumber" FROM quotes ORDER BY quote_number
      `
      return rows.map((row) => row.quoteNumber)
    },
  }
}
