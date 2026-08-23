import { createServerFn } from '@tanstack/react-start'
import type { Sql } from 'postgres'
import { getAppSession } from '@/lib/auth/session.server'
import {
  createAuditActivityQuery,
  type AuditActivityError,
  type AuditActivityRepository,
  type AuditRequester,
} from '@/lib/audit/activity.server'
import { getDatabase } from '@/lib/db/database.server'

/**
 * Authorized audit-activity endpoint for `/app/configuracoes/auditoria`.
 *
 * A thin RPC bridge over `createAuditActivityQuery`: every authorization and
 * bound check lives inside the query boundary (per-request authentication,
 * admin-only role, strict filters, keyset pagination). The client can only
 * ever ask for a bounded page — it cannot widen limits by crafting input.
 *
 * All server-only work stays lexically inside the `.handler` callback so the
 * TanStack Start compiler strips the database layer from the client bundle.
 */

/** JSON-safe shape of the redacted before/after summaries. */
export type AuditSummaryValue =
  | string
  | number
  | boolean
  | null
  | readonly AuditSummaryValue[]
  | Readonly<{ readonly [key: string]: AuditSummaryValue }>

export type AuditActivityItem = Readonly<{
  id: string
  occurredAt: string
  correlationId: string
  action: 'create' | 'update' | 'transition' | 'duplicate'
  description: string
  actor: Readonly<{ id: string; displayName: string }>
  entity:
    | Readonly<{ type: 'quote'; id: string }>
    | Readonly<{
        type: 'quote'
        id: string
        displayName: string
        href: string
      }>
  before: AuditSummaryValue
  after: AuditSummaryValue
}>

export type AuditActivityPage = Readonly<{
  items: readonly AuditActivityItem[]
  nextCursor: string | null
}>

export type AuditActivityPublicResult =
  | Readonly<{ ok: true; data: AuditActivityPage }>
  | Readonly<{ ok: false; error: AuditActivityError }>

/**
 * Resolves the requester from the Better Auth request cookie. The query
 * boundary itself enforces the admin-only role (401/403 before any filter or
 * repository access), so a forged payload can never supply an identity.
 */
function authenticate(): Promise<AuditRequester | null> {
  return getAppSession().then((session) =>
    session
      ? {
          id: session.user.id,
          role: session.user.role,
          displayName: session.user.name,
        }
      : null,
  )
}

function sqlClient(): Promise<Sql> {
  return getDatabase().then(
    (database) => (database as unknown as { $client: Sql }).$client,
  )
}

function resolveSchemaName(): string {
  const configured = process.env.WEYNE_DB_SCHEMA?.trim()
  if (!configured) {
    throw new Error('WEYNE_DB_SCHEMA is required for the audit activity endpoint')
  }
  if (!/^[a-z_][a-z0-9_]*$/i.test(configured)) {
    throw new Error(`Invalid PostgreSQL schema name: ${configured}`)
  }
  return configured
}

/**
 * Batch entity authorization. A quote is viewable when its commercial
 * resource scope row exists; missing rows resolve as not authorized, so the
 * viewer never renders a link it cannot follow.
 */
async function authorizeQuoteEntities(
  _requester: AuditRequester,
  entities: readonly Readonly<{ type: 'quote'; id: string }>[],
): Promise<ReadonlySet<string>> {
  const quoteIds = [...new Set(entities.map((entity) => entity.id))]
  if (quoteIds.length === 0) return new Set()
  const sql = await sqlClient()
  const schemaName = resolveSchemaName()
  await sql.unsafe(`SET search_path TO "${schemaName}", public`)
  const placeholders = quoteIds.map((_id, index) => `$${index + 1}::uuid`).join(', ')
  const rows = await sql.unsafe<Array<{ resourceId: string }>>(
    `SELECT resource_id::text AS "resourceId"
    FROM commercial_resource_scopes
    WHERE resource_type = 'quote'
      AND resource_id IN (${placeholders})`,
    quoteIds,
  )
  return new Set(rows.map((row) => row.resourceId))
}

async function loadActorNames(
  actorIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (actorIds.length === 0) return new Map()
  const sql = await sqlClient()
  const schemaName = resolveSchemaName()
  await sql.unsafe(`SET search_path TO "${schemaName}", public`)
  const placeholders = actorIds.map((_id, index) => `$${index + 1}`).join(', ')
  const rows = await sql.unsafe<Array<{ id: string; name: string }>>(
    `SELECT id::text AS id, name
    FROM users
    WHERE id IN (${placeholders})`,
    [...actorIds],
  )
  return new Map(rows.map((row) => [row.id, row.name]))
}

async function getAuditRepository(): Promise<AuditActivityRepository> {
  const { createPostgresQuoteAuditRepository } = await import(
    '@/lib/audit/quote-audit-repository.server'
  )
  return createPostgresQuoteAuditRepository({
    sql: await sqlClient(),
    schemaName: resolveSchemaName(),
    loadActorNames,
  })
}

const acceptUnknownInput = (input: unknown) => input

export const getAuditActivity = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }): Promise<AuditActivityPublicResult> => {
    const query = createAuditActivityQuery({
      authenticate,
      repository: await getAuditRepository(),
      authorizeEntities: authorizeQuoteEntities,
    })
    const result = await query(data)
    // The redaction layer guarantees JSON-safe summaries before serialization;
    // this cast only restates that guarantee for the RPC boundary's type check.
    return result as AuditActivityPublicResult
  })
