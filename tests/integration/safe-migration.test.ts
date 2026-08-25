import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadMigrationPlan, migrateDatabase } from '@/lib/db/migrate.server'
import { resolveTestDatabaseUrl } from '../support/postgres-harness'

let databaseUrl: string
let databaseName: string
let maintenanceClient: Sql
let previousReleaseDirectory: string

beforeAll(async () => {
  const sourceDatabaseUrl = resolveTestDatabaseUrl(process.env)
  databaseName = `weyne_migration_${randomUUID().replaceAll('-', '')}`
  const maintenanceUrl = new URL(sourceDatabaseUrl)
  maintenanceUrl.pathname = '/postgres'
  maintenanceClient = postgres(maintenanceUrl.toString(), { max: 1 })
  await maintenanceClient.unsafe(`CREATE DATABASE "${databaseName}"`)

  const isolatedDatabaseUrl = new URL(sourceDatabaseUrl)
  isolatedDatabaseUrl.pathname = `/${databaseName}`
  databaseUrl = isolatedDatabaseUrl.toString()
  previousReleaseDirectory = await mkdtemp(join(tmpdir(), 'weyne-previous-release-'))
  await cp(
    resolve(process.cwd(), 'drizzle/0000_migration_smoke.sql'),
    join(previousReleaseDirectory, '0000_migration_smoke.sql'),
  )
})

afterAll(async () => {
  try {
    if (maintenanceClient && databaseName) {
      await maintenanceClient.unsafe(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      )
    }
  } finally {
    if (maintenanceClient) await maintenanceClient.end({ timeout: 5 })
    await rm(previousReleaseDirectory, { force: true, recursive: true })
  }
})

describe('production migration rehearsal', () => {
  it('creates a fresh prior schema, upgrades, repeats safely, and preserves the prior app contract', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = databaseUrl
    const client = postgres(databaseUrl, { max: 1 })

    try {
      await migrateDatabase(previousReleaseDirectory)
      await client`INSERT INTO migration_smoke (key) VALUES ('previous-image')`

      await migrateDatabase(resolve(process.cwd(), 'drizzle'))
      await migrateDatabase(resolve(process.cwd(), 'drizzle'))

      const [previousAppProbe] = await client<{ key: string }[]>`
        SELECT key FROM migration_smoke WHERE key = 'previous-image'
      `
      const [migrationCount] = await client<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM public.weyne_schema_migrations
      `
      const plan = await loadMigrationPlan(resolve(process.cwd(), 'drizzle'))

      expect(previousAppProbe?.key).toBe('previous-image')
      expect(migrationCount?.count).toBe(plan.length)
    } finally {
      await client.end({ timeout: 5 })
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
    }
  })
})
