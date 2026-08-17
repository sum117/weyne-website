import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const privateObject = pgTable('private_object', {
  id: uuid('id').primaryKey().defaultRandom(),
  objectKey: text('object_key').notNull().unique(),
  ownerUserId: text('owner_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
})
