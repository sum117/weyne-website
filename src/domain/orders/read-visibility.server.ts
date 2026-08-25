import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '@/lib/db/schema'
import {
  authorizeCommercialAction,
  type CommercialActor,
  type CommercialResourceScope,
} from '@/lib/orders/security-policy.server'
import {
  failure,
  success,
} from '@/lib/domain/result'
import type { OrderVisibilityResolver } from './read-service.server'

type Database = PostgresJsDatabase<typeof schema>

interface ScopeJoinRow {
  resourceId: string
  ownerUserId: string
}

/**
 * PostgreSQL-backed visibility resolution over the shared
 * `commercial_resource_scopes` / `commercial_resource_assignments` tables —
 * the exact authorization source used by quote/order attachments, so order
 * reads cannot diverge from the rest of the commercial RBAC surface.
 */
export function createPostgresOrderVisibilityResolver(
  database: Database,
): OrderVisibilityResolver {
  async function visibleScopes(
    actor: CommercialActor,
    orderId?: string,
  ): Promise<ScopeJoinRow[]> {
    const rows = await database
      .select({
        resourceId: sql<string>`${sql.raw('s.resource_id')}::text`,
        ownerUserId: sql<string>`s.owner_user_id`,
      })
      .from(sql`commercial_resource_scopes s`)
      .where(
        sql`s.resource_type = 'order'
          AND s.tenant_id = ${actor.tenantId}::uuid
          ${orderId ? sql`AND s.resource_id = ${orderId}::uuid` : sql``}
          ${
            actor.role === 'admin'
              ? sql``
              : actor.role === 'read_only'
                ? sql`AND EXISTS (
                    SELECT 1 FROM commercial_resource_assignments a
                    WHERE a.resource_type = 'order'
                      AND a.resource_id = s.resource_id
                      AND a.user_id = ${actor.id})`
                : sql`AND (s.owner_user_id = ${actor.id}
                    OR EXISTS (
                      SELECT 1 FROM commercial_resource_assignments a
                      WHERE a.resource_type = 'order'
                        AND a.resource_id = s.resource_id
                        AND a.user_id = ${actor.id}))`
          }`,
      )
    return rows as unknown as ScopeJoinRow[]
  }

  async function loadScope(
    actor: CommercialActor,
    orderId: string,
  ): Promise<CommercialResourceScope | null> {
    const [row] = await database
      .select({
        tenantId: sql<string>`s.tenant_id::text`,
        ownerUserId: sql<string>`s.owner_user_id`,
        status: sql<string>`s.resource_status`,
      })
      .from(sql`commercial_resource_scopes s`)
      .where(
        sql`s.resource_type = 'order' AND s.resource_id = ${orderId}::uuid AND s.tenant_id = ${actor.tenantId}::uuid`,
      )
    if (!row) return null

    const assignments = await database
      .select({ userId: sql<string>`a.user_id` })
      .from(sql`commercial_resource_assignments a`)
      .where(
        sql`a.resource_type = 'order' AND a.resource_id = ${orderId}::uuid`,
      )
    return Object.freeze({
      tenantId: row.tenantId,
      ownerUserId: row.ownerUserId,
      status: row.status,
      assignedUserIds: Object.freeze(
        assignments.map((assignment) => assignment.userId),
      ),
    })
  }

  return Object.freeze({
    async listVisibleOrderIds(actor) {
      if (!actor.tenantId) return []
      const rows = await visibleScopes(actor)
      return Object.freeze(rows.map((row) => row.resourceId))
    },

    async resolveResourceAccess(actor, orderId) {
      const scope = await loadScope(actor, orderId)
      if (!scope) return failure({ category: 'not-found' })

      const decision = authorizeCommercialAction(actor, 'order.read', scope)
      if (decision === 'not_found') return failure({ category: 'not-found' })
      // 'forbidden' cannot occur for order.read per the policy matrix, but
      // treat any non-allow decision defensively as absence of access.
      if (decision !== 'allow' && decision !== 'allow_redacted') {
        return failure({ category: 'not-found' })
      }
      return success(
        Object.freeze({ scope, authorization: decision }) as {
          scope: CommercialResourceScope
          authorization: 'allow' | 'allow_redacted'
        },
      )
    },
  })
}
