import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

const auditTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow()

export const referenceRecords = pgTable(
  'reference_records',
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    budget: numeric({ precision: 19, scale: 6 }).notNull(),
    version: bigint({ mode: 'bigint' }).notNull().default(1n),
    createdAt: auditTimestamp('created_at'),
    createdBy: text('created_by').notNull(),
    updatedAt: auditTimestamp('updated_at'),
    updatedBy: text('updated_by').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    archivedBy: text('archived_by'),
  },
  (table) => [
    index('reference_records_active_name_idx')
      .on(sql`lower(${table.name})`, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    index('reference_records_active_created_idx')
      .on(table.createdAt, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    check('reference_records_name_ck', sql`btrim(${table.name}) <> ''`),
    check('reference_records_budget_ck', sql`${table.budget} >= 0`),
    check('reference_records_version_ck', sql`${table.version} > 0`),
    check(
      'reference_records_archive_actor_ck',
      sql`(${table.archivedAt} IS NULL AND ${table.archivedBy} IS NULL)
        OR (${table.archivedAt} IS NOT NULL AND btrim(${table.archivedBy}) <> '')`,
    ),
  ],
)

export const referenceRecordEvents = pgTable(
  'reference_record_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => referenceRecords.id, { onDelete: 'restrict' }),
    operation: text().notNull(),
    actor: text().notNull(),
    version: bigint({ mode: 'bigint' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    index('reference_record_events_record_idx').on(
      table.recordId,
      table.version,
    ),
    check(
      'reference_record_events_operation_ck',
      sql`${table.operation} IN ('created', 'updated', 'archived')`,
    ),
    check('reference_record_events_actor_ck', sql`btrim(${table.actor}) <> ''`),
    check('reference_record_events_version_ck', sql`${table.version} > 0`),
  ],
)
