import type { Sql } from 'postgres'
import type {
  AuditActivityRepository,
  AuditActivityRepositoryQuery,
  AuditEntityReference,
  AuditEventRow,
} from './activity.server'

type QuoteAuditRow = Readonly<{
  id: string
  quoteId: string
  actorId: string
  operation: AuditEventRow['action']
  commandId: string
  beforeState: unknown
  afterState: unknown
  occurredAt: Date | string
}>

type QuoteDisplayRow = Readonly<{ id: string; quoteNumber: string }>

export function createPostgresQuoteAuditRepository(options: Readonly<{
  sql: Sql
  schemaName: string
  loadActorNames: (actorIds: readonly string[]) => Promise<ReadonlyMap<string, string>>
}>): AuditActivityRepository {
  const { sql, schemaName } = options
  if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
    throw new Error(`Invalid PostgreSQL schema name: ${schemaName}`)
  }
  const quotedSchema = `"${schemaName}"`

  return {
    async listEvents(input: AuditActivityRepositoryQuery) {
      const clauses: string[] = []
      const parameters: unknown[] = []
      const add = (fragment: string, ...values: unknown[]) => {
        const offset = parameters.length
        clauses.push(
          fragment.replaceAll(/\$(\d+)/g, (_match, index: string) =>
            `$${offset + Number(index)}`,
          ),
        )
        parameters.push(...values)
      }

      if (input.filters.actorId) add('qa.actor_id = $1', input.filters.actorId)
      if (input.filters.action) add('qa.operation = $1', input.filters.action)
      if (input.filters.entityId) add('qa.quote_id = $1::uuid', input.filters.entityId)
      if (input.filters.occurredFrom) {
        add('qa.occurred_at >= $1::timestamptz', input.filters.occurredFrom)
      }
      if (input.filters.occurredTo) {
        add('qa.occurred_at <= $1::timestamptz', input.filters.occurredTo)
      }
      if (input.filters.correlationId) {
        add('qa.command_id = $1', input.filters.correlationId)
      }
      if (input.cursor) {
        add(
          '(qa.occurred_at, qa.id) < ($1::timestamptz, $2::uuid)',
          input.cursor.occurredAt,
          input.cursor.id,
        )
      }
      // `entityType` is validated to the only current store projection (`quote`).
      parameters.push(input.limit)
      const limitParameter = `$${parameters.length}`
      const where = clauses.length > 0 ? `WHERE ${clauses.join('\n          AND ')}` : ''
      const rows = await sql.unsafe<QuoteAuditRow[]>(
        `SELECT
          qa.id,
          qa.quote_id AS "quoteId",
          qa.actor_id AS "actorId",
          qa.operation,
          qa.command_id AS "commandId",
          qa.before_state AS "beforeState",
          qa.after_state AS "afterState",
          qa.occurred_at AS "occurredAt"
        FROM ${quotedSchema}.quote_audit qa
        ${where}
        ORDER BY qa.occurred_at DESC, qa.id DESC
        LIMIT ${limitParameter}`,
        parameters as never[],
      )

      return rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        action: row.operation,
        entity: { type: 'quote' as const, id: row.quoteId },
        occurredAt: new Date(row.occurredAt),
        correlationId: row.commandId,
        before: row.beforeState,
        after: row.afterState,
      }))
    },

    loadActorMetadata(actorIds) {
      return options.loadActorNames(actorIds)
    },

    async loadEntityMetadata(entities: readonly AuditEntityReference[]) {
      const quoteIds = [...new Set(
        entities.filter((entity) => entity.type === 'quote').map((entity) => entity.id),
      )]
      if (quoteIds.length === 0) return new Map<string, string>()

      const placeholders = quoteIds.map((_id, index) => `$${index + 1}::uuid`).join(', ')
      const rows = await sql.unsafe<QuoteDisplayRow[]>(
        `SELECT id, quote_number AS "quoteNumber"
        FROM ${quotedSchema}.quotes
        WHERE id IN (${placeholders})`,
        quoteIds,
      )
      return new Map(rows.map((row) => [`quote:${row.id}`, row.quoteNumber]))
    },
  }
}
