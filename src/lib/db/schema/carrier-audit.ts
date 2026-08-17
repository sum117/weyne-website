import { sql } from 'drizzle-orm'
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { carriers } from './carriers'

export const carrierAudit = pgTable(
  'carrier_audit',
  {
    id: uuid().primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').notNull(),
    actorRole: text('actor_role').notNull(),
    carrierId: uuid('carrier_id')
      .notNull()
      .references(() => carriers.id, { onDelete: 'restrict' }),
    action: text().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    metadata: jsonb().$type<Readonly<{ changedFields: readonly string[] }>>().notNull(),
  },
  (table) => [
    index('carrier_audit_carrier_idx').on(
      table.carrierId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index('carrier_audit_actor_idx').on(table.actorUserId, table.occurredAt.desc()),
    check(
      'carrier_audit_role_ck',
      sql`${table.actorRole} IN ('admin', 'representative', 'read_only')`,
    ),
    check(
      'carrier_audit_action_ck',
      sql`${table.action} IN ('carrier.create', 'carrier.update', 'carrier.archive')`,
    ),
    check('carrier_audit_metadata_ck', sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
)
