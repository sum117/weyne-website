import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { closeDatabase, getDatabase, type Database } from './database.server'
import { parseDatabaseConfig } from './config.server'
import { logStructuredEvent } from '@/lib/server/log-redaction'

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/
const MIGRATION_HEADER_PATTERN = /^-- weyne:migration compatibility=(expand|contract) previous-app-compatible=(true|false)$/m
const INCOMPATIBLE_EXPAND_SQL = /\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA)|RENAME\s+(?:COLUMN|TABLE)|ALTER\s+COLUMN\s+[^;]+\s+TYPE|ALTER\s+COLUMN\s+[^;]+\s+SET\s+NOT\s+NULL)\b|^\s*TRUNCATE\b/im
const MIGRATION_LOCK_KEY = 1_469_719_606

export type Migration = Readonly<{
  id: string
  ordinal: number
  sql: string
  checksum: string
  compatibility: 'expand' | 'contract'
  previousAppCompatible: boolean
}>

export type AppliedMigration = Readonly<{
  id: string
  checksum: string
}>

type PreflightResult = Readonly<{
  database: string
  user: string
  version: string
}>

export type MigrationSession = Readonly<{
  preflight: () => Promise<PreflightResult>
  tryAcquireLock: () => Promise<boolean>
  readAppliedMigrations: () => Promise<readonly AppliedMigration[]>
  applyMigration: (migration: Migration) => Promise<void>
  releaseLock: () => Promise<void>
  close: () => Promise<void>
}>

type MigrationLog = Readonly<{
  event: string
  migration?: string
  pending?: number
  database?: string
  user?: string
  version?: string
}>

type SafeMigrationRunnerDependencies = Readonly<{
  openSession: () => Promise<MigrationSession>
  logger?: (entry: MigrationLog) => void
  cleanupRelease?: string
}>

type MigrationRunnerDependencies<TDatabase> = Readonly<{
  getDatabase: () => Promise<TDatabase>
  applyMigrations: (database: TDatabase, migrationsFolder: string) => Promise<void>
  closeDatabase: () => Promise<void>
}>

export async function loadMigrationPlan(
  migrationsFolder: string,
  options: Readonly<{ cleanupRelease?: string }> = {},
): Promise<readonly Migration[]> {
  const names = (await readdir(migrationsFolder))
    .filter((name) => name.endsWith('.sql'))
    .sort()

  if (names.length === 0) {
    throw new Error(`No SQL migrations found in ${migrationsFolder}`)
  }

  const migrations = await Promise.all(names.map(async (name, ordinal) => {
    const match = MIGRATION_FILE_PATTERN.exec(name)
    if (!match) {
      throw new Error(`Migration filename ${name} must match NNNN_lowercase_name.sql`)
    }

    const sql = await readFile(resolve(migrationsFolder, name), 'utf8')
    const header = MIGRATION_HEADER_PATTERN.exec(sql)
    if (!header) {
      throw new Error(`Migration ${name} is missing its Weyne compatibility header`)
    }

    const compatibility = header[1] as Migration['compatibility']
    const previousAppCompatible = header[2] === 'true'
    const id = name.slice(0, -4)
    if (compatibility === 'expand' && !previousAppCompatible) {
      throw new Error(`Expand migration ${id} must remain compatible with the previous app image`)
    }
    if (compatibility === 'expand' && INCOMPATIBLE_EXPAND_SQL.test(stripSqlComments(sql))) {
      throw new Error(`Expand migration contains incompatible SQL: ${id}`)
    }
    if (compatibility === 'contract' && options.cleanupRelease !== id) {
      throw new Error(`Contract migration ${id} requires MIGRATION_CLEANUP_RELEASE=${id}`)
    }

    return Object.freeze({
      id,
      ordinal,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
      compatibility,
      previousAppCompatible,
    })
  }))

  return Object.freeze(migrations)
}

export function createSafeMigrationRunner(
  dependencies: SafeMigrationRunnerDependencies,
): (migrationsFolder: string) => Promise<void> {
  const logger = dependencies.logger ?? (() => undefined)

  return async (migrationsFolder) => {
    const plan = await loadMigrationPlan(migrationsFolder, {
      cleanupRelease: dependencies.cleanupRelease,
    })
    const session = await dependencies.openSession()
    let lockAcquired = false

    try {
      let preflight: PreflightResult
      try {
        preflight = await session.preflight()
      } catch (error) {
        throw new Error(`Migration preflight failed: ${safeErrorMessage(error)}`, { cause: error })
      }
      logger({ event: 'migration.preflight_succeeded', ...preflight })

      lockAcquired = await session.tryAcquireLock()
      if (!lockAcquired) {
        throw new Error('Unable to acquire the production migration lock; another deploy is migrating')
      }
      logger({ event: 'migration.lock_acquired' })

      const applied = await session.readAppliedMigrations()
      assertAppliedPrefix(plan, applied)
      const pending = plan.slice(applied.length)
      logger({ event: 'migration.plan_validated', pending: pending.length })

      for (const migration of pending) {
        logger({ event: 'migration.started', migration: migration.id })
        await session.applyMigration(migration)
        logger({ event: 'migration.succeeded', migration: migration.id })
      }
      logger({ event: 'migration.completed', pending: pending.length })
    } finally {
      try {
        if (lockAcquired) await session.releaseLock()
      } finally {
        await session.close()
      }
    }
  }
}

export function createMigrationRunner<TDatabase>(
  dependencies: MigrationRunnerDependencies<TDatabase>,
): (migrationsFolder: string) => Promise<void> {
  return async (migrationsFolder) => {
    const database = await dependencies.getDatabase()

    try {
      await dependencies.applyMigrations(database, migrationsFolder)
    } finally {
      await dependencies.closeDatabase()
    }
  }
}

const runDrizzleMigrations = createMigrationRunner<Database>({
  getDatabase,
  applyMigrations: (database, migrationsFolder) => migrate(database, { migrationsFolder }),
  closeDatabase,
})

export async function migrateDatabase(
  migrationsFolder = 'drizzle/canonical',
): Promise<void> {
  const config = parseDatabaseConfig(process.env)
  const run = createSafeMigrationRunner({
    openSession: () => openPostgresMigrationSession(config.url),
    cleanupRelease: process.env.MIGRATION_CLEANUP_RELEASE,
    logger: (entry) => logStructuredEvent({ kind: 'migration', ...entry }),
  })

  await run(migrationsFolder)
}

/** Kept for local Drizzle tooling; production deploys must use migrateDatabase. */
export async function migrateDatabaseWithDrizzle(
  migrationsFolder = 'drizzle/canonical',
): Promise<void> {
  await runDrizzleMigrations(migrationsFolder)
}

async function openPostgresMigrationSession(databaseUrl: string): Promise<MigrationSession> {
  const client = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  })
  const expectedUser = decodeURIComponent(new URL(databaseUrl).username)

  return {
    preflight: async () => {
      const [row] = await client<{
        database: string
        user: string
        version: string
        canConnect: boolean
        canMigrate: boolean
      }[]>`
        SELECT current_database() AS database,
               current_user AS user,
               current_setting('server_version_num') AS version,
               has_database_privilege(current_user, current_database(), 'CONNECT') AS "canConnect",
               has_schema_privilege(current_user, 'public', 'USAGE,CREATE') AS "canMigrate"
      `
      if (!row || row.user !== expectedUser || !row.canConnect || !row.canMigrate) {
        throw new Error('database identity or migration privileges do not match the configured credentials')
      }
      return { database: row.database, user: row.user, version: row.version }
    },
    tryAcquireLock: async () => {
      const [row] = await client<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS acquired
      `
      return row?.acquired === true
    },
    readAppliedMigrations: async () => {
      const [exists] = await client<{ ledger: string | null }[]>`
        SELECT to_regclass('public.weyne_schema_migrations')::text AS ledger
      `
      if (!exists?.ledger) return []
      return client<AppliedMigration[]>`
        SELECT id, checksum
        FROM public.weyne_schema_migrations
        ORDER BY ordinal
      `
    },
    applyMigration: async (migration) => {
      await client.begin(async (transaction) => {
        await transaction`
          CREATE TABLE IF NOT EXISTS public.weyne_schema_migrations (
            ordinal integer PRIMARY KEY,
            id text NOT NULL UNIQUE,
            checksum char(64) NOT NULL,
            compatibility text NOT NULL CHECK (compatibility IN ('expand', 'contract')),
            previous_app_compatible boolean NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
          )
        `
        await transaction.unsafe(migration.sql)
        await transaction`
          INSERT INTO public.weyne_schema_migrations
            (ordinal, id, checksum, compatibility, previous_app_compatible)
          VALUES
            (${migration.ordinal}, ${migration.id}, ${migration.checksum}, ${migration.compatibility}, ${migration.previousAppCompatible})
        `
      })
    },
    releaseLock: async () => {
      await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`
    },
    close: async () => {
      await client.end({ timeout: 5 })
    },
  }
}

function assertAppliedPrefix(
  plan: readonly Migration[],
  applied: readonly AppliedMigration[],
): void {
  if (applied.length > plan.length) {
    throw new Error('Database schema is newer than this immutable application image')
  }

  applied.forEach((record, index) => {
    const expected = plan[index]
    if (record.id !== expected?.id) {
      throw new Error(`Applied migration ordering mismatch at ordinal ${index}`)
    }
    if (record.checksum !== expected.checksum) {
      throw new Error(`Applied migration checksum mismatch for ${record.id}`)
    }
  })
}

function stripSqlComments(sql: string): string {
  return sql.replaceAll(/--.*$/gm, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown database error'
  return error.message.replaceAll(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
}