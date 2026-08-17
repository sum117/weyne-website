import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { orders } from './orders'

const auditTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow()

/** Mutable attachment metadata; order and order-line commercial snapshots stay untouched. */
export const orderAttachments = pgTable(
  'order_attachments',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    label: text().notNull(),
    originalFilename: text('original_filename').notNull(),
    objectKey: text('object_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    validatedMimeType: text('validated_mime_type').notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: auditTimestamp('created_at'),
    updatedAt: auditTimestamp('updated_at'),
    deletedBy: uuid('deleted_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    state: text().notNull().default('pending'),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    deleteIdempotencyKey: text('delete_idempotency_key'),
  },
  (table) => [
    uniqueIndex('order_attachments_object_key_uidx').on(table.objectKey),
    unique('order_attachments_upload_idempotency_uidx').on(
      table.orderId,
      table.createdBy,
      table.idempotencyKey,
    ),
    index('order_attachments_active_order_idx')
      .on(table.orderId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.state} IN ('pending', 'ready', 'deleting')`),
    check(
      'order_attachments_state_ck',
      sql`${table.state} IN ('pending', 'ready', 'deleting', 'deleted', 'failed')`,
    ),
    check('order_attachments_size_ck', sql`${table.sizeBytes} > 0`),
    check(
      'order_attachments_text_ck',
      sql`btrim(${table.label}) <> ''
        AND btrim(${table.originalFilename}) <> ''
        AND btrim(${table.objectKey}) <> ''
        AND btrim(${table.validatedMimeType}) <> ''
        AND btrim(${table.checksumSha256}) <> ''
        AND btrim(${table.idempotencyKey}) <> ''
        AND btrim(${table.payloadHash}) <> ''`,
    ),
    check(
      'order_attachments_delete_metadata_ck',
      sql`(${table.state} = 'deleted'
          AND ${table.deletedAt} IS NOT NULL
          AND ${table.deletedBy} IS NOT NULL
          AND ${table.deleteIdempotencyKey} IS NOT NULL)
        OR (${table.state} <> 'deleted')`,
    ),
  ],
)

/** Append-only safe events; storage keys, URLs, tokens, and credentials have no columns. */
export const orderAttachmentAudit = pgTable(
  'order_attachment_audit',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => orderAttachments.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    actorId: uuid('actor_id').notNull(),
    occurredAt: auditTimestamp('occurred_at'),
    label: text().notNull(),
  },
  (table) => [
    index('order_attachment_audit_history_idx').on(
      table.orderId,
      table.occurredAt,
      table.id,
    ),
    check(
      'order_attachment_audit_event_ck',
      sql`${table.eventType} IN ('order.attachment.uploaded', 'order.attachment.deleted')`,
    ),
    check('order_attachment_audit_label_ck', sql`btrim(${table.label}) <> ''`),
  ],
)
