import { logStructuredEvent } from '@/lib/server/log-redaction'
import { and, eq, lt } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as databaseSchema from '@/lib/db/schema'
import { auditEvents, documentLogoAssets, settings } from '@/lib/db/schema/canonical'
import { BUSINESS_SETTINGS_KEY } from '@/lib/settings/settings-repository.server'
import type {
  DocumentLogoActivationTransaction,
  DocumentLogoAuditEvent,
  DocumentLogoAuditSink,
  DocumentLogoRecord,
  DocumentLogoRepository,
  DocumentLogoSettingsReader,
} from '@/lib/settings/document-logo-service.server'

/**
 * PostgreSQL persistence for the document logo pipeline.
 *
 * `createPostgresDocumentLogoActivation` is the atomic swap: it locks the
 * settings row, CAS-checks the expected version, writes the caller-built next
 * payload with the new logo id, flips the staged asset to `active`, and
 * appends the audit event — one transaction, all or nothing. The database
 * trigger `settings_logo_asset_active_trg` backstops the invariant that
 * settings may only ever reference an active asset.
 */

type Database = PostgresJsDatabase<typeof databaseSchema>
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type Executor = Database | Transaction

type DocumentLogoRow = typeof documentLogoAssets.$inferSelect

export function mapDocumentLogoRow(row: DocumentLogoRow): DocumentLogoRecord {
  return Object.freeze({
    id: row.id,
    status: row.status,
    objectKey: row.objectKey,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
    createdByUserId: row.createdByUserId,
  })
}

export function createPostgresDocumentLogoRepository(
  database: Executor,
): DocumentLogoRepository {
  return Object.freeze({
    async findById(assetId: string) {
      const rows = await database
        .select()
        .from(documentLogoAssets)
        .where(eq(documentLogoAssets.id, assetId))
        .limit(1)
      return rows[0] ? mapDocumentLogoRow(rows[0]) : null
    },

    async findStagedByChecksum(actorId: string, checksumSha256: string) {
      const hex = Buffer.from(checksumSha256, 'base64').toString('hex')
      const rows = await database
        .select()
        .from(documentLogoAssets)
        .where(
          and(
            eq(documentLogoAssets.status, 'staged'),
            eq(documentLogoAssets.createdByUserId, actorId),
            eq(documentLogoAssets.checksumSha256, hex),
          ),
        )
        .limit(1)
      return rows[0] ? mapDocumentLogoRow(rows[0]) : null
    },

    async insert(asset: DocumentLogoRecord) {
      await database
        .insert(documentLogoAssets)
        .values({
          id: asset.id,
          status: asset.status,
          objectKey: asset.objectKey,
          originalFilename: asset.originalFilename,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          checksumSha256: asset.checksumSha256,
          width: asset.width,
          height: asset.height,
          createdAt: asset.createdAt,
          createdByUserId: asset.createdByUserId,
        })
        .onConflictDoUpdate({
          target: documentLogoAssets.id,
          set: {
            width: asset.width,
            height: asset.height,
          },
        })
    },

    async markPurged(assetId: string, actorId: string, occurredAt: Date) {
      await database
        .update(documentLogoAssets)
        .set({
          status: 'purged',
          purgedAt: occurredAt,
          purgedByUserId: actorId,
        })
        .where(eq(documentLogoAssets.id, assetId))
    },

    async listStagedOlderThan(cutoff: Date) {
      const rows = await database
        .select()
        .from(documentLogoAssets)
        .where(
          and(
            eq(documentLogoAssets.status, 'staged'),
            lt(documentLogoAssets.createdAt, cutoff),
          ),
        )
      return rows.map(mapDocumentLogoRow)
    },
  })
}

/**
 * Builds the atomic activation transaction. `buildNextValue` receives the
 * current canonical settings payload (already validated on write) and must
 * return the next payload with the new `documents.logoAssetId` applied.
 */
export function createPostgresDocumentLogoActivation(database: Database): Readonly<{
  activate: DocumentLogoActivationTransaction
  buildNextValue: <T extends Record<string, unknown>>(
    currentValue: T,
    logoAssetId: string | null,
  ) => T
}> {
  return Object.freeze({
    activate(input) {
      return database.transaction(async (transaction): Promise<
        | Readonly<{ ok: true; version: number }>
        | Readonly<{ ok: false; outcome: 'not-found' | 'conflict' }>
      > => {
        const locked = await transaction
          .select()
          .from(settings)
          .where(eq(settings.key, BUSINESS_SETTINGS_KEY))
          .for('update')
          .limit(1)
        const current = locked[0]
        if (!current) return { ok: false as const, outcome: 'not-found' as const }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, outcome: 'conflict' as const }
        }

        const nextVersion = input.expectedVersion + 1
        const currentValue = current.value as Record<string, unknown>
        const documents = {
          ...(currentValue.documents as Record<string, unknown>),
          logoAssetId: input.assetId,
        }
        const updatedRows = await transaction
          .update(settings)
          .set({
            value: { ...currentValue, documents } as typeof current.value,
            version: nextVersion,
            updatedAt: input.occurredAt,
            updatedByUserId: input.actorUserId,
          })
          .where(eq(settings.key, BUSINESS_SETTINGS_KEY))
          .returning({ id: settings.id })
        if (!updatedRows[0]) {
          throw new Error('Settings update returned no row during logo activation')
        }

        await transaction
          .update(documentLogoAssets)
          .set({
            status: 'active',
            activatedAt: input.occurredAt,
            activatedByUserId: input.actorUserId,
          })
          .where(eq(documentLogoAssets.id, input.assetId))

        await transaction.insert(auditEvents).values({
          actorUserId: input.actorUserId,
          actorRole: 'admin',
          action: 'settings.update',
          entityType: 'settings',
          entityId: updatedRows[0].id,
          occurredAt: input.occurredAt,
          correlationId: input.correlationId,
          before: null,
          after: null,
          metadata: {
            changedFields: ['documents.logoAssetId'],
            previousVersion: input.expectedVersion,
            nextVersion,
            logoAssetId: input.assetId,
          },
        })

        return { ok: true as const, version: nextVersion }
      })
    },

    buildNextValue(currentValue, logoAssetId) {
      return {
        ...currentValue,
        documents: {
          ...(currentValue.documents as Record<string, unknown> | undefined),
          logoAssetId,
        },
      } as typeof currentValue
    },
  })
}

export function createPostgresDocumentLogoSettingsReader(
  database: Executor,
): DocumentLogoSettingsReader {
  return Object.freeze({
    async currentVersion() {
      const rows = await database
        .select({ version: settings.version })
        .from(settings)
        .where(eq(settings.key, BUSINESS_SETTINGS_KEY))
        .limit(1)
      return rows[0]?.version ?? null
    },
    async currentLogoAssetId() {
      const rows = await database
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, BUSINESS_SETTINGS_KEY))
        .limit(1)
      const value = rows[0]?.value as
        | { documents?: { logoAssetId?: string | null } }
        | undefined
      return value?.documents?.logoAssetId ?? null
    },
  })
}

/**
 * Console audit sink mirroring the settings/quote-PDF posture: actor, asset,
 * action, outcome, timestamp. Never logs object keys, signed URLs, or bytes.
 */
export function createConsoleDocumentLogoAuditSink(): DocumentLogoAuditSink {
  return {
    async append(event: DocumentLogoAuditEvent) {
      logStructuredEvent({
        kind: 'audit',
        action: event.action,
        actorId: event.actorId,
        assetId: event.assetId,
        outcome: event.outcome,
        ...(event.detail ? { detail: event.detail } : {}),
        occurredAt: event.occurredAt.toISOString(),
      })
    },
  }
}
