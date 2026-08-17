import { pgTable, text } from 'drizzle-orm/pg-core'

/** Minimal installation canary; it is not a business-domain table. */
export const migrationSmoke = pgTable('migration_smoke', {
  key: text('key').primaryKey(),
})
