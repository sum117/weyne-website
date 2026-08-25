import '@tanstack/react-start/server-only'

import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '@/lib/db/schema'
import { requireScopedCapability } from './authorization.server'
import {
  SINGLE_ORGANIZATION_TENANT_ID,
  evaluateRecordScope,
  type CommercialScopeRow,
} from './commercial-scope'
import type { Capability, ScopedResource } from './capabilities'

/**
 * SERVER ONLY bridge between the ambient Better Auth session and the
 * commercial record-scope tables (`commercial_resource_scopes` /
 * `commercial_resource_assignments` — the same source every commercial
 * surface reads). One call at a server-function boundary yields:
 *
 * - `session`: the authenticated actor (401 when absent);
 * - `scope`: the matrix scope kind for the resource (capability checked,
 *   403 with the fixed pt-BR message when the role lacks the command);
 * - helpers that translate scope into PostgreSQL-visible rows.
 *
 * Out-of-scope records resolve as NOT FOUND (never 403) so identifiers
 * cannot be enumerated; see `commercial-scope.ts` for the decision table.
 */

export type CommercialActorSession = Readonly<{
  id: string
  role: 'admin' | 'representative' | 'read_only'
}>

export interface ScopedCommercialContext {
  readonly session: CommercialActorSession
  readonly tenantId: string
  /** True when the role sees everything (no per-row filtering needed). */
  readonly unrestricted: boolean
}

/**
 * Session + capability + resolved resource scope in one call. The returned
 * context is the only sanctioned way a commercial server function learns who
 * is calling and what they may locate.
 */
export async function requireCommercialContext(
  resource: ScopedResource,
  capability: Capability,
): Promise<ScopedCommercialContext> {
  const { session, scope } = await requireScopedCapability(resource, capability)
  return Object.freeze({
    session: Object.freeze({ id: session.user.id, role: session.user.role }),
    tenantId: SINGLE_ORGANIZATION_TENANT_ID,
    unrestricted: scope === 'all',
  })
}

/**
 * Resolves the full scope row for one record. `null` means no row exists —
 * indistinguishable from an out-of-scope record by design.
 */
export async function loadCommercialScopeRow(
  database: PostgresJsDatabase<typeof schema>,
  resource: 'quote' | 'order',
  resourceId: string,
): Promise<CommercialScopeRow | null> {
  const rows = await database
    .select({
      ownerUserId: sql<string>`s.owner_user_id`,
    })
    .from(sql`commercial_resource_scopes s`)
    .where(
      sql`s.resource_type = ${resource} AND s.resource_id = ${resourceId}::uuid LIMIT 1`,
    )
  const row = rows[0]
  if (!row) return null

  const assignments = await database
    .select({ userId: sql<string>`a.user_id` })
    .from(sql`commercial_resource_assignments a`)
    .where(
      sql`a.resource_type = ${resource} AND a.resource_id = ${resourceId}::uuid`,
    )

  return Object.freeze({
    tenantId: SINGLE_ORGANIZATION_TENANT_ID,
    ownerUserId: row.ownerUserId,
    assignedUserIds: Object.freeze(assignments.map((assignment) => assignment.userId)),
  })
}

/**
 * All record IDs of `resource` visible to the caller, derived from the same
 * tables the single-record resolver uses. Collection queries MUST filter on
 * this set BEFORE pagination.
 */
export async function listVisibleCommercialRecordIds(
  database: PostgresJsDatabase<typeof schema>,
  context: ScopedCommercialContext,
  resource: 'quote' | 'order',
): Promise<readonly string[] | null> {
  if (context.unrestricted) return null

  const rows = await database
    .select({ resourceId: sql<string>`s.resource_id::text` })
    .from(sql`commercial_resource_scopes s`)
    .where(
      sql`s.resource_type = ${resource}
        AND s.tenant_id = ${context.tenantId}::uuid
        AND ${context.session.role === 'representative'
          ? sql`(s.owner_user_id = ${context.session.id} OR EXISTS (
              SELECT 1 FROM commercial_resource_assignments a
              WHERE a.resource_type = ${resource}
                AND a.resource_id = s.resource_id
                AND a.user_id = ${context.session.id}))`
          : sql`EXISTS (
              SELECT 1 FROM commercial_resource_assignments a
              WHERE a.resource_type = ${resource}
                AND a.resource_id = s.resource_id
                AND a.user_id = ${context.session.id})`}`,
    )
  return Object.freeze(rows.map((row) => row.resourceId))
}

export { evaluateRecordScope }
