import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '@/lib/db/schema'

/**
 * Explicit representative assignments backing the read_only report scope:
 * distinct owners of order resources explicitly assigned to `userId` in
 * `commercial_resource_assignments` / `commercial_resource_scopes` — the
 * same shared RBAC tables every commercial surface reads. An empty result
 * means "no readable rows", never "all rows".
 */
export async function loadAssignedOrderOwners(
  database: PostgresJsDatabase<typeof schema>,
  userId: string,
): Promise<readonly string[]> {
  const rows = await database
    .select({
      ownerUserId: sql<string>`DISTINCT s.owner_user_id`,
    })
    .from(sql`commercial_resource_scopes s`)
    .where(
      sql`s.resource_type = 'order' AND EXISTS (
        SELECT 1 FROM commercial_resource_assignments a
        WHERE a.resource_type = 'order'
          AND a.resource_id = s.resource_id
          AND a.user_id = ${userId})`,
    )
  return Object.freeze(rows.map((row) => row.ownerUserId))
}
