import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type { JsonValue, QuotePdfGenerationErrorCode } from '@/lib/quotes/pdf-artifacts.server'

const auditTimestamp = () =>
  timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow()

/** Immutable render input captured independently from mutable quote rows. */
export const quoteSnapshots = pgTable(
  'quote_snapshots',
  {
    id: uuid().primaryKey().defaultRandom(),
    quoteId: uuid('quote_id').notNull(),
    version: integer().notNull(),
    payload: jsonb().$type<JsonValue>().notNull(),
    sourceChecksum: char('source_checksum', { length: 64 }).notNull(),
    capturedAt: auditTimestamp(),
    capturedBy: text('captured_by').notNull(),
  },
  (table) => [
    unique('quote_snapshots_quote_version_uidx').on(table.quoteId, table.version),
    unique('quote_snapshots_artifact_reference_uidx').on(
      table.quoteId,
      table.id,
      table.version,
    ),
    check('quote_snapshots_version_ck', sql`${table.version} > 0`),
    check(
      'quote_snapshots_source_checksum_ck',
      sql`${table.sourceChecksum} ~ '^[0-9a-f]{64}$'`,
    ),
    check('quote_snapshots_actor_ck', sql`btrim(${table.capturedBy}) <> ''`),
  ],
)

/**
 * Immutable private PDF artifact metadata. The compound unique key is the
 * database concurrency boundary used by atomic generation claims.
 */
export const quotePdfArtifacts = pgTable(
  'quote_pdf_artifacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    quoteId: uuid('quote_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    snapshotVersion: integer('snapshot_version').notNull(),
    templateId: uuid('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    templateVariant: text('template_variant').notNull(),
    sourceChecksum: char('source_checksum', { length: 64 }).notNull(),
    status: text().notNull(),
    objectKey: text('object_key'),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    outputChecksum: char('output_checksum', { length: 64 }),
    pageCount: integer('page_count'),
    attemptCount: integer('attempt_count').notNull().default(1),
    generationStartedAt: auditTimestamp(),
    createdAt: auditTimestamp(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' }),
    errorCode: text('error_code').$type<QuotePdfGenerationErrorCode>(),
    errorMessage: text('error_message'),
    errorDetails: jsonb('error_details').$type<Record<string, number | string>>(),
  },
  (table) => [
    unique('quote_pdf_artifacts_source_uidx').on(
      table.quoteId,
      table.snapshotId,
      table.snapshotVersion,
      table.templateId,
      table.templateVersion,
      table.sourceChecksum,
    ),
    foreignKey({
      name: 'quote_pdf_artifacts_snapshot_fk',
      columns: [table.quoteId, table.snapshotId, table.snapshotVersion],
      foreignColumns: [quoteSnapshots.quoteId, quoteSnapshots.id, quoteSnapshots.version],
    }).onDelete('restrict'),
    index('quote_pdf_artifacts_quote_history_idx').on(
      table.quoteId,
      table.snapshotVersion.desc(),
      table.createdAt.desc(),
    ),
    index('quote_pdf_artifacts_status_idx').on(table.status, table.generationStartedAt),
    check(
      'quote_pdf_artifacts_status_ck',
      sql`${table.status} IN ('generating', 'completed', 'failed')`,
    ),
    check(
      'quote_pdf_artifacts_template_variant_ck',
      sql`${table.templateVariant} IN ('summary', 'commercial')`,
    ),
    check('quote_pdf_artifacts_versions_ck', sql`${table.snapshotVersion} > 0 AND ${table.templateVersion} > 0`),
    check('quote_pdf_artifacts_attempt_count_ck', sql`${table.attemptCount} > 0`),
    check(
      'quote_pdf_artifacts_checksums_ck',
      sql`${table.sourceChecksum} ~ '^[0-9a-f]{64}$'
        AND (${table.outputChecksum} IS NULL OR ${table.outputChecksum} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      'quote_pdf_artifacts_terminal_metadata_ck',
      sql`(
          ${table.status} = 'generating'
          AND ${table.objectKey} IS NULL
          AND ${table.mimeType} IS NULL
          AND ${table.sizeBytes} IS NULL
          AND ${table.outputChecksum} IS NULL
          AND ${table.pageCount} IS NULL
          AND ${table.completedAt} IS NULL
          AND ${table.failedAt} IS NULL
          AND ${table.errorCode} IS NULL
          AND ${table.errorMessage} IS NULL
        ) OR (
          ${table.status} = 'completed'
          AND btrim(${table.objectKey}) <> ''
          AND ${table.mimeType} = 'application/pdf'
          AND ${table.sizeBytes} > 0
          AND ${table.outputChecksum} IS NOT NULL
          AND ${table.pageCount} > 0
          AND ${table.completedAt} IS NOT NULL
          AND ${table.failedAt} IS NULL
          AND ${table.errorCode} IS NULL
          AND ${table.errorMessage} IS NULL
          AND ${table.errorDetails} IS NULL
        ) OR (
          ${table.status} = 'failed'
          AND ${table.objectKey} IS NULL
          AND ${table.mimeType} IS NULL
          AND ${table.sizeBytes} IS NULL
          AND ${table.outputChecksum} IS NULL
          AND ${table.pageCount} IS NULL
          AND ${table.completedAt} IS NULL
          AND ${table.failedAt} IS NOT NULL
          AND btrim(${table.errorCode}) <> ''
          AND btrim(${table.errorMessage}) <> ''
        )`,
    ),
  ],
)
