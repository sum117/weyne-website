/**
 * Pure record-scope decisions for the commercial resources (quotes/orders),
 * shared by every enforcement site on this card.
 *
 * SAFE IN THE BROWSER (like `capabilities.ts`): data and pure functions only.
 * The server-side counterpart (`commercial-scope.server.ts`) resolves scope
 * rows from PostgreSQL and resolves sessions; this module decides, given a
 * resolved row, whether the actor may locate the record at all.
 *
 * Semantics come straight from the matrix (§2.2) through
 * `recordScope(role, resource)`:
 * - `all`: admins act anywhere in the single-organization installation.
 * - `own_assigned`: owner OR explicitly assigned.
 * - `explicit_assigned`: ONLY explicit assignment; ownership alone never
 *   qualifies (S3/S4 read_only posture).
 * - `none`: the role cannot locate records of the resource at all.
 *
 * An out-of-scope answer MUST be indistinguishable from absence: callers
 * translate `false` into their domain's not-found outcome (404) so
 * identifiers cannot be enumerated. Never turn this into a 403.
 */

import { recordScope, type RecordScope, type Role, type ScopedResource } from './capabilities'

/**
 * Single-organization installation: there are no tenants in the database
 * (canonical-domain-contract.md §single-organization), but the shared
 * commercial scope tables carry a `tenant_id` column that participates in
 * every lookup. All records and all actors live in this one fixed tenant;
 * nothing here introduces multitenancy behavior.
 */
export const SINGLE_ORGANIZATION_TENANT_ID = '00000000-0000-4000-8000-00000000fec1' as const

/** Resolved ownership/assignment row for one commercial record. */
export interface CommercialScopeRow {
  readonly tenantId: string
  readonly ownerUserId: string
  readonly assignedUserIds: readonly string[]
}

export type ScopeDecision = 'allow' | 'not_found'

/**
 * May an actor with this role/id locate the record described by `row`?
 * `null` row (no scope row persisted yet) resolves as not-found, failing
 * closed exactly like a missing record.
 */
export function evaluateRecordScope(input: {
  readonly role: Role
  readonly actorId: string
  readonly resource: ScopedResource
  readonly row: CommercialScopeRow | null
}): ScopeDecision {
  const kind: RecordScope = recordScope(input.role, input.resource)
  if (kind === 'all') {
    return input.row && input.row.tenantId === SINGLE_ORGANIZATION_TENANT_ID
      ? 'allow'
      : 'not_found'
  }
  if (!input.row) return 'not_found'
  if (input.row.tenantId !== SINGLE_ORGANIZATION_TENANT_ID) return 'not_found'

  const assigned = input.row.assignedUserIds.includes(input.actorId)
  switch (kind) {
    case 'own_assigned':
      return input.row.ownerUserId === input.actorId || assigned ? 'allow' : 'not_found'
    case 'explicit_assigned':
      return assigned ? 'allow' : 'not_found'
    default:
      // 'active_catalog' never applies to quote/order; 'none' locates nothing.
      return 'not_found'
  }
}

/**
 * Does the actor fall inside the record's visibility set for LIST purposes?
 * Mirrors `evaluateRecordScope` for rows synthesized from a visibility join
 * (same tables, projected columns).
 */
export function actorWithinScopeRow(input: {
  readonly role: Role
  readonly actorId: string
  readonly resource: ScopedResource
  readonly row: CommercialScopeRow
}): boolean {
  return evaluateRecordScope(input) === 'allow'
}
