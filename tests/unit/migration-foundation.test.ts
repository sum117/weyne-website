import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMigrationRunner } from '@/lib/db/migrate.server'

describe('database migration foundation', () => {
  it('closes the database connection after a successful migration', async () => {
    const database = { kind: 'database' }
    const getDatabase = vi.fn(async () => database)
    const applyMigrations = vi.fn(async () => undefined)
    const closeDatabase = vi.fn(async () => undefined)
    const runMigrations = createMigrationRunner({
      getDatabase,
      applyMigrations,
      closeDatabase,
    })

    await runMigrations('drizzle')

    expect(applyMigrations).toHaveBeenCalledWith(database, 'drizzle')
    expect(closeDatabase).toHaveBeenCalledOnce()
  })

  it('closes the database connection when migration application fails', async () => {
    const migrationError = new Error('migration failed')
    const closeDatabase = vi.fn(async () => undefined)
    const runMigrations = createMigrationRunner({
      getDatabase: async () => ({ kind: 'database' }),
      applyMigrations: async () => {
        throw migrationError
      },
      closeDatabase,
    })

    await expect(runMigrations('drizzle')).rejects.toBe(migrationError)
    expect(closeDatabase).toHaveBeenCalledOnce()
  })

  it('commits deterministic Drizzle migration metadata for the canonical schema', () => {
    const config = readFileSync(resolve(process.cwd(), 'drizzle.config.ts'), 'utf8')
    const journal = readFileSync(
      resolve(process.cwd(), 'drizzle/canonical/meta/_journal.json'),
      'utf8',
    )
    const canonicalMigration = readFileSync(
      resolve(process.cwd(), 'drizzle/canonical/0000_canonical_schema.sql'),
      'utf8',
    )

    expect(config).toContain("schema: './src/lib/db/schema/canonical.ts'")
    expect(config).toContain("out: './drizzle/canonical'")
    const metadata = JSON.parse(journal) as {
      dialect: string
      entries: { idx: number; when: number; tag: string }[]
    }
    expect(metadata.dialect).toBe('postgresql')
    expect(metadata.entries[0]).toMatchObject({
      idx: 0,
      when: 0,
      tag: '0000_canonical_schema',
    })
    expect(metadata.entries.map(({ idx, when }) => ({ idx, when }))).toEqual(
      metadata.entries.map((_, index) => ({ idx: index, when: index })),
    )

    expect(canonicalMigration).toContain('CREATE TABLE "users"')
    expect(canonicalMigration).toContain('CREATE TABLE "industries"')
    expect(canonicalMigration).toContain('CREATE TABLE "price_lists"')
    expect(canonicalMigration).not.toContain('CREATE TABLE "migration_smoke"')
  })
})
