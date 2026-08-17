import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSafeMigrationRunner,
  loadMigrationPlan,
  type AppliedMigration,
  type MigrationSession,
} from '@/lib/db/migrate.server'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })))
})

async function migrationDirectory(files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'weyne-migrations-'))
  temporaryDirectories.push(directory)
  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(directory, name), content)))
  return directory
}

function migrationSql(sql: string, compatibility = 'expand'): string {
  return `-- weyne:migration compatibility=${compatibility} previous-app-compatible=${compatibility === 'expand'}\n${sql}\n`
}

function session(overrides: Partial<MigrationSession> = {}): MigrationSession {
  return {
    preflight: vi.fn(async () => ({ database: 'weyne', user: 'deploy', version: '170000' })),
    tryAcquireLock: vi.fn(async () => true),
    readAppliedMigrations: vi.fn(async () => []),
    applyMigration: vi.fn(async () => undefined),
    releaseLock: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('safe production migrations', () => {
  it('rejects invalid migration filenames before reaching the database', async () => {
    const directory = await migrationDirectory({
      '0000_initial.sql': migrationSql('CREATE TABLE initial (id integer);'),
      '2_invalid.sql': migrationSql('CREATE TABLE gap (id integer);'),
    })

    await expect(loadMigrationPlan(directory)).rejects.toThrow('must match NNNN_lowercase_name.sql')
  })

  it('rejects destructive SQL disguised as an expand migration', async () => {
    const directory = await migrationDirectory({
      '0000_bad.sql': migrationSql('ALTER TABLE clients DROP COLUMN phone;'),
    })

    await expect(loadMigrationPlan(directory)).rejects.toThrow('Expand migration contains incompatible SQL')
  })

  it('fails closed when database preflight fails without acquiring the lock or applying data', async () => {
    const directory = await migrationDirectory({
      '0000_initial.sql': migrationSql('CREATE TABLE initial (id integer);'),
    })
    const database = session({
      preflight: vi.fn(async () => {
        throw new Error('permission denied for schema public')
      }),
    })
    const runner = createSafeMigrationRunner({
      openSession: async () => database,
      logger: vi.fn(),
    })

    await expect(runner(directory)).rejects.toThrow('Migration preflight failed')
    expect(database.tryAcquireLock).not.toHaveBeenCalled()
    expect(database.applyMigration).not.toHaveBeenCalled()
    expect(database.close).toHaveBeenCalledOnce()
  })

  it('serializes execution and refuses to continue when another deploy owns the lock', async () => {
    const directory = await migrationDirectory({
      '0000_initial.sql': migrationSql('CREATE TABLE initial (id integer);'),
    })
    const database = session({ tryAcquireLock: vi.fn(async () => false) })
    const runner = createSafeMigrationRunner({ openSession: async () => database, logger: vi.fn() })

    await expect(runner(directory)).rejects.toThrow('migration lock')
    expect(database.applyMigration).not.toHaveBeenCalled()
    expect(database.releaseLock).not.toHaveBeenCalled()
  })

  it('closes the database session even when advisory lock release fails', async () => {
    const directory = await migrationDirectory({
      '0000_initial.sql': migrationSql('CREATE TABLE initial (id integer);'),
    })
    const database = session({
      releaseLock: vi.fn(async () => {
        throw new Error('lock connection failed')
      }),
    })
    const runner = createSafeMigrationRunner({ openSession: async () => database, logger: vi.fn() })

    await expect(runner(directory)).rejects.toThrow('lock connection failed')
    expect(database.close).toHaveBeenCalledOnce()
  })

  it('applies only the pending suffix and is idempotent on repeated invocation', async () => {
    const directory = await migrationDirectory({
      '0000_initial.sql': migrationSql('CREATE TABLE initial (id integer);'),
      '0001_additive.sql': migrationSql('ALTER TABLE initial ADD COLUMN label text;'),
    })
    const plan = await loadMigrationPlan(directory)
    const applied: AppliedMigration[] = [
      { id: plan[0]!.id, checksum: plan[0]!.checksum },
    ]
    const applyMigration = vi.fn(async (migration: (typeof plan)[number]) => {
      applied.push({ id: migration.id, checksum: migration.checksum })
    })
    const openSession = vi.fn(async () => session({
      readAppliedMigrations: vi.fn(async () => [...applied]),
      applyMigration,
    }))
    const runner = createSafeMigrationRunner({ openSession, logger: vi.fn() })

    await runner(directory)
    await runner(directory)

    expect(applyMigration).toHaveBeenCalledOnce()
    expect(applyMigration).toHaveBeenCalledWith(expect.objectContaining({ id: '0001_additive' }))
  })

  it('rejects an applied history that is not an exact prefix of the immutable local plan', async () => {
    const directory = await migrationDirectory({
      '0000_initial.sql': migrationSql('CREATE TABLE initial (id integer);'),
    })
    const database = session({
      readAppliedMigrations: vi.fn(async () => [{ id: '0000_initial', checksum: 'tampered' }]),
    })
    const runner = createSafeMigrationRunner({ openSession: async () => database, logger: vi.fn() })

    await expect(runner(directory)).rejects.toThrow('checksum mismatch')
    expect(database.applyMigration).not.toHaveBeenCalled()
  })

  it('requires an explicit named cleanup release for contract migrations', async () => {
    const directory = await migrationDirectory({
      '0000_cleanup.sql': migrationSql('ALTER TABLE clients DROP COLUMN legacy;', 'contract'),
    })

    await expect(loadMigrationPlan(directory)).rejects.toThrow('MIGRATION_CLEANUP_RELEASE=0000_cleanup')
    await expect(loadMigrationPlan(directory, { cleanupRelease: '0000_cleanup' })).resolves.toHaveLength(1)
  })
})
