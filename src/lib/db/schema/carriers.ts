import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const auditTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow()

export const carriers = pgTable(
  'carriers',
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    taxId: text('tax_id'),
    contactName: text('contact_name'),
    email: text(),
    phone: text(),
    streetAddress: text('street_address'),
    postalCode: text('postal_code'),
    city: text(),
    state: text(),
    notes: text(),
    createdAt: auditTimestamp('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    updatedAt: auditTimestamp('updated_at'),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    archivedByUserId: uuid('archived_by_user_id'),
  },
  (table) => [
    uniqueIndex('carriers_tax_id_uidx')
      .on(table.taxId)
      .where(sql`${table.taxId} IS NOT NULL`),
    index('carriers_name_idx').on(sql`lower(${table.name})`, table.id),
    index('carriers_created_idx').on(table.createdAt, table.id),
    index('carriers_updated_idx').on(table.updatedAt, table.id),
    index('carriers_archive_idx').on(table.archivedAt, table.id),
    check('carriers_name_ck', sql`btrim(${table.name}) <> ''`),
    check(
      'carriers_tax_id_ck',
      sql`${table.taxId} IS NULL OR ${table.taxId} ~ '^[0-9]{14}$'`,
    ),
    check(
      'carriers_postal_code_ck',
      sql`${table.postalCode} IS NULL OR ${table.postalCode} ~ '^[0-9]{8}$'`,
    ),
    check(
      'carriers_state_ck',
      sql`${table.state} IS NULL OR ${table.state} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'carriers_archive_actor_ck',
      sql`(${table.archivedAt} IS NULL AND ${table.archivedByUserId} IS NULL)
        OR (${table.archivedAt} IS NOT NULL AND ${table.archivedByUserId} IS NOT NULL)`,
    ),
  ],
)
