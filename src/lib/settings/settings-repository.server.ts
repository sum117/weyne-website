import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type {
  BusinessSettings,
  SettingsRecord,
} from '@/domain/settings/business-settings'
import { settingsRecordSchema } from '@/domain/settings/business-settings'
import type * as databaseSchema from '@/lib/db/schema'
import { auditEvents, settings, users } from '@/lib/db/schema/canonical'
import { serializeDate } from '@/lib/server/serialization'

/**
 * PostgreSQL persistence for the canonical `business` settings record.
 *
 * The write path is a single compare-and-swap transaction: the current row is
 * locked `FOR UPDATE`, the expected version is checked inside that lock, and
 * the new value plus audit event commit atomically or not at all. A stale
 * `expectedVersion` (or a missing row) leaves the last-known valid record
 * untouched and surfaces as a typed conflict instead of an exception.
 */

export const BUSINESS_SETTINGS_KEY = 'business' as const

export type SettingsAuditEvent = Readonly<{
  actorUserId: string
  actorRole: 'admin'
  action: 'settings.update'
  occurredAt: Date
  correlationId: string
  before: BusinessSettings | null
  after: BusinessSettings
  changedFields: readonly string[]
  previousVersion: number | null
  nextVersion: number
}>

export type SettingsRepository = Readonly<{
  findRecord: () => Promise<SettingsRecord | null>
  updateRecord: (input: Readonly<{
    expectedVersion: number
    settings: BusinessSettings
    actorUserId: string
    occurredAt: Date
    correlationId: string
  }>) => Promise<
    | Readonly<{ ok: true; record: SettingsRecord; audit: SettingsAuditEvent }>
    | Readonly<{ ok: false; outcome: 'not-found' | 'conflict' }>
  >
  appendAudit: (event: SettingsAuditEvent) => Promise<void>
}>

type Database = PostgresJsDatabase<typeof databaseSchema>
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type Executor = Database | Transaction

type SettingsRow = typeof settings.$inferSelect

function mapRecord(row: SettingsRow): SettingsRecord {
  return settingsRecordSchema.parse({
    settings: row.value,
    version: row.version,
    updatedAt: serializeDate(row.updatedAt),
    updatedByUserId: row.updatedByUserId,
  })
}

function safeAuditState(value: BusinessSettings): Record<string, unknown> {
  // The canonical payload is already free of secrets/counters; freeze a plain
  // copy so the jsonb snapshot cannot be mutated through cached references.
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

export function createPostgresSettingsRepository(
  database: Executor,
): SettingsRepository {
  async function loadRow(executor: Executor): Promise<SettingsRow | null> {
    const rows = await executor
      .select()
      .from(settings)
      .where(eq(settings.key, BUSINESS_SETTINGS_KEY))
      .limit(1)
    return rows[0] ?? null
  }

  return Object.freeze({
    async findRecord() {
      const row = await loadRow(database)
      return row === null ? null : mapRecord(row)
    },

    async updateRecord(input) {
      return database.transaction(async (transaction) => {
        const locked = await transaction
          .select()
          .from(settings)
          .where(eq(settings.key, BUSINESS_SETTINGS_KEY))
          .for('update')
          .limit(1)
        const current = locked[0]
        if (!current) {
          return { ok: false as const, outcome: 'not-found' as const }
        }
        if (current.version !== input.expectedVersion) {
          return { ok: false as const, outcome: 'conflict' as const }
        }

        const nextVersion = current.version + 1
        const updatedRows = await transaction
          .update(settings)
          .set({
            value: input.settings,
            version: nextVersion,
            updatedAt: input.occurredAt,
            updatedByUserId: input.actorUserId,
          })
          .where(eq(settings.key, BUSINESS_SETTINGS_KEY))
          .returning()
        const updated = updatedRows[0]
        if (!updated) {
          throw new Error('Settings update returned no row')
        }

        const audit: SettingsAuditEvent = Object.freeze({
          actorUserId: input.actorUserId,
          actorRole: 'admin',
          action: 'settings.update',
          occurredAt: input.occurredAt,
          correlationId: input.correlationId,
          before: current.value,
          after: input.settings,
          changedFields: diffChangedFields(current.value, input.settings),
          previousVersion: current.version,
          nextVersion,
        })

        await transaction.insert(auditEvents).values({
          actorUserId: audit.actorUserId,
          actorRole: audit.actorRole,
          action: audit.action,
          entityType: 'settings',
          entityId: updated.id,
          occurredAt: audit.occurredAt,
          correlationId: audit.correlationId,
          before: audit.before === null ? null : safeAuditState(audit.before),
          after: safeAuditState(audit.after),
          metadata: {
            changedFields: [...audit.changedFields],
            previousVersion: audit.previousVersion,
            nextVersion: audit.nextVersion,
          },
        })

        return { ok: true as const, record: mapRecord(updated), audit }
      })
    },

    async appendAudit(event) {
      // entityId is NOT NULL uuid; the single business record owns it.
      const row = await loadRow(database)
      if (!row) {
        throw new Error('Cannot append settings audit without a settings row')
      }
      await database.insert(auditEvents).values({
        actorUserId: event.actorUserId,
        actorRole: event.actorRole,
        action: event.action,
        entityType: 'settings',
        entityId: row.id,
        occurredAt: event.occurredAt,
        correlationId: event.correlationId,
        before: event.before === null ? null : safeAuditState(event.before),
        after: safeAuditState(event.after),
        metadata: {
          changedFields: [...event.changedFields],
          previousVersion: event.previousVersion,
          nextVersion: event.nextVersion,
        },
      })
    },
  })
}

/** Top-level dotted paths whose values differ between two canonical payloads. */
export function diffChangedFields(
  before: BusinessSettings,
  after: BusinessSettings,
): readonly string[] {
  const changed: string[] = []
  const walk = (
    prefix: string,
    left: unknown,
    right: unknown,
  ): void => {
    if (left === right) return
    if (
      typeof left === 'object' &&
      left !== null &&
      typeof right === 'object' &&
      right !== null &&
      !Array.isArray(left) === !Array.isArray(right)
    ) {
      const keys = new Set([
        ...Object.keys(left as Record<string, unknown>),
        ...Object.keys(right as Record<string, unknown>),
      ])
      for (const key of [...keys].sort()) {
        walk(prefix === '' ? key : `${prefix}.${key}`, (left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])
      }
      return
    }
    if (JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)) {
      changed.push(prefix)
    }
  }
  walk('', before, after)
  return Object.freeze(changed)
}

/** Resolves the display name of an actor for audit consumers, if needed later. */
export function createSettingsActorLookup(database: Database) {
  return async (actorIds: readonly string[]): Promise<ReadonlyMap<string, string>> => {
    if (actorIds.length === 0) return new Map()
    const rows = await database
      .select({ id: users.id, name: users.name })
      .from(users)
    return new Map(rows.map((row) => [row.id, row.name]))
  }
}
