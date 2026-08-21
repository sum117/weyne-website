import { sql, type SQL } from 'drizzle-orm'
import type { CommercialActor } from '@/lib/orders/security-policy.server'

/**
 * Reusable RBAC visibility scoping for analytics queries.
 *
 * Every analytics query MUST apply `analyticsVisibilityPredicate()` (or the
 * stricter commission variant) before any aggregation, grouping, or export.
 * The predicate is the SQL translation of the commercial authorization
 * matrix (`src/lib/orders/security-policy.server.ts`,
 * `docs/domain/role-permission-matrix.md`) applied to the shared
 * `commercial_resource_scopes` / `commercial_resource_assignments` tables —
 * the exact authorization source used by order reads and attachments, so a
 * dashboard can never show an order its actor could not open.
 *
 * Role semantics:
 *
 * - `admin` — every order inside the actor's tenant.
 * - `representative` — orders whose originating quote is owned by the actor
 *   (`scopes.owner_user_id = actor.id`) or where the actor has an explicit
 *   assignment row.
 * - `read_only` — only explicitly assigned orders; never ownership.
 *
 * Tenant isolation is unconditional: the scope table is filtered by the
 * actor's tenant even for admins, so cross-tenant leakage is impossible by
 * construction rather than by caller discipline.
 *
 * The predicate references `commercial_resource_scopes s` joined to
 * `orders o ON s.resource_id = o.id`; callers using table aliases other than
 * `o` should pass their alias via `orderAlias`.
 */

export type AnalyticsVisibilityInput = Readonly<{
  actor: CommercialActor
  /** Alias of the `orders` table in the surrounding query. Default `o`. */
  orderAlias?: string
}>

/** Aliases are interpolated as identifiers, so only safe SQL names pass. */
const ORDER_ALIAS_PATTERN = /^[a-z_][a-z0-9_]*$/i

function visibilitySubquery(actor: CommercialActor, orderAlias: string): SQL {
  if (!ORDER_ALIAS_PATTERN.test(orderAlias)) {
    throw new RangeError(`Invalid orders table alias: ${orderAlias}`)
  }
  const roleClause =
    actor.role === 'admin'
      ? sql`TRUE`
      : actor.role === 'representative'
        ? sql`(s.owner_user_id = ${actor.id} OR EXISTS (
            SELECT 1 FROM commercial_resource_assignments a
            WHERE a.resource_type = 'order'
              AND a.resource_id = s.resource_id
              AND a.user_id = ${actor.id}))`
        : sql`EXISTS (
            SELECT 1 FROM commercial_resource_assignments a
            WHERE a.resource_type = 'order'
              AND a.resource_id = s.resource_id
              AND a.user_id = ${actor.id})`
  return sql`EXISTS (
    SELECT 1 FROM commercial_resource_scopes s
    WHERE s.resource_type = 'order'
      AND s.resource_id = ${sql.raw(`"${orderAlias}"`)}.id
      AND s.tenant_id = ${actor.tenantId}::uuid
      AND (${roleClause}))`
}

/**
 * Row-level visibility filter every analytics query must apply before
 * aggregation. Returns `FALSE` for actors without a tenant so a malformed
 * actor fails closed instead of leaking rows.
 */
export function analyticsVisibilityPredicate(input: AnalyticsVisibilityInput): SQL {
  if (!input.actor.tenantId) return sql`false`
  return visibilitySubquery(input.actor, input.orderAlias ?? 'o')
}

/**
 * Commission visibility: mirrors the reporting contract rule that
 * `read_only` actors may see volumes but never commission figures. Analytics
 * surfaces that expose commission amounts must additionally null out the
 * commission columns in their projection; this predicate removes the rows'
 * contribution from commission aggregates entirely.
 */
export function commissionVisiblePredicate(input: AnalyticsVisibilityInput): SQL {
  if (input.actor.role === 'read_only') return sql`false`
  return analyticsVisibilityPredicate(input)
}
