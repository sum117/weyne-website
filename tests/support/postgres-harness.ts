import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from '@/lib/db/schema'

const TEST_DATABASE_ENVIRONMENT_KEY = 'TEST_DATABASE_URL'
const SAFE_DATABASE_NAME = /(^test([_-]|$)|([_-])test([_-]|$)|([_-])tests?$|testing)/i

type TestSchema = typeof schema

export type PostgresTestHarness = Readonly<{
  database: PostgresJsDatabase<TestSchema>
  sql: Sql
  schemaName: string
  reset: () => Promise<void>
  close: () => Promise<void>
}>

type HarnessOptions = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>
  migrationsDirectory?: string
  migrationNames?: readonly string[]
  schemaPrefix?: string
}>

export async function createPostgresTestHarness(
  options: HarnessOptions = {},
): Promise<PostgresTestHarness> {
  const databaseUrl = resolveTestDatabaseUrl(options.environment ?? process.env)
  const migrationsDirectory = options.migrationsDirectory ?? resolve(process.cwd(), 'drizzle')
  const schemaName = createSchemaName(options.schemaPrefix)
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  })
  const database = drizzle(client, { schema })
  let closed = false

  const reset = async () => {
    if (closed) {
      throw new Error('PostgreSQL test harness is already closed')
    }

    try {
      await recreateSchema(client, schemaName)
      await applyMigrations(
        client,
        migrationsDirectory,
        databaseUrl,
        options.migrationNames,
      )
    } catch (error) {
      throw new Error(
        `Unable to reset isolated PostgreSQL schema ${schemaName} on ${redactDatabaseUrl(databaseUrl)}: ${sanitizeError(error, databaseUrl)}`,
        { cause: error },
      )
    }
  }

  const close = async () => {
    if (closed) return
    closed = true

    let teardownError: unknown
    try {
      await client`SET search_path TO public`
      await client.unsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`)
    } catch (error) {
      teardownError = error
    } finally {
      await client.end({ timeout: 5 })
    }

    if (teardownError) {
      throw new Error(
        `Unable to remove isolated PostgreSQL schema ${schemaName} on ${redactDatabaseUrl(databaseUrl)}: ${sanitizeError(teardownError, databaseUrl)}`,
        { cause: teardownError },
      )
    }
  }

  try {
    await reset()
  } catch (error) {
    try {
      await close()
    } catch {
      // Preserve the migration/reset failure, which carries the useful diagnostic.
    }
    throw error
  }

  return Object.freeze({ database, sql: client, schemaName, reset, close })
}

export function resolveTestDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const value = environment[TEST_DATABASE_ENVIRONMENT_KEY]?.trim()
  if (!value) {
    throw new Error(
      `${TEST_DATABASE_ENVIRONMENT_KEY} is required; integration tests never read DATABASE_URL or production credentials`,
    )
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${TEST_DATABASE_ENVIRONMENT_KEY} must be a valid PostgreSQL URL`)
  }

  const databaseName = decodeURIComponent(parsed.pathname.slice(1))
  const validProtocol = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:'
  if (!validProtocol || !parsed.hostname || !databaseName) {
    throw new Error(`${TEST_DATABASE_ENVIRONMENT_KEY} must be a valid PostgreSQL URL`)
  }

  if (!SAFE_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      `${TEST_DATABASE_ENVIRONMENT_KEY} must name an explicitly test-scoped database (received database ${JSON.stringify(databaseName)})`,
    )
  }

  return value
}

export function redactDatabaseUrl(value: string): string {
  try {
    const parsed = new URL(value)
    if (parsed.password) parsed.password = 'REDACTED'
    return parsed.toString()
  } catch {
    return '<invalid PostgreSQL URL>'
  }
}

async function recreateSchema(client: Sql, schemaName: string): Promise<void> {
  const identifier = quoteIdentifier(schemaName)
  await client`SET search_path TO public`
  await client.unsafe(`DROP SCHEMA IF EXISTS ${identifier} CASCADE`)
  await client.unsafe(`CREATE SCHEMA ${identifier}`)
  await client.unsafe(`SET search_path TO ${identifier}, public`)
}

async function applyMigrations(
  client: Sql,
  migrationsDirectory: string,
  databaseUrl: string,
  selectedMigrationNames?: readonly string[],
): Promise<void> {
  let migrationNames: string[]
  try {
    const availableMigrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort()
    migrationNames = selectedMigrationNames
      ? selectedMigrationNames.map((name) => {
          if (!availableMigrationNames.includes(name)) {
            throw new Error(`Selected migration ${name} does not exist`)
          }
          return name
        })
      : availableMigrationNames
  } catch (error) {
    throw new Error(
      `Unable to read migrations from ${migrationsDirectory}: ${sanitizeError(error, databaseUrl)}`,
      { cause: error },
    )
  }

  if (migrationNames.length === 0) {
    throw new Error(`No .sql migrations found in ${migrationsDirectory}`)
  }

  for (const migrationName of migrationNames) {
    try {
      const migration = await readFile(resolve(migrationsDirectory, migrationName), 'utf8')
      await client.unsafe(migration)
    } catch (error) {
      throw new Error(
        `Migration ${migrationName} failed: ${sanitizeError(error, databaseUrl)}`,
        { cause: error },
      )
    }
  }
}

function createSchemaName(prefix = 'weyne_test'): string {
  const safePrefix = prefix.toLowerCase().replaceAll(/[^a-z0-9_]/g, '_').slice(0, 30)
  return `${safePrefix}_${randomUUID().replaceAll('-', '')}`
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function sanitizeError(error: unknown, databaseUrl: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const parsed = new URL(databaseUrl)
  const secrets = [databaseUrl, parsed.password, decodeURIComponent(parsed.password)].filter(Boolean)

  return secrets.reduce(
    (sanitized, secret) => sanitized.replaceAll(secret, '[REDACTED]'),
    message,
  )
}
