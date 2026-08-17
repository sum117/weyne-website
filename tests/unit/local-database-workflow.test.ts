import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSeedRunner } from '@/lib/db/seed.server'

const root = resolve(import.meta.dirname, '../..')

async function readProjectFile(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8')
}

describe('local PostgreSQL workflow', () => {
  it('pins a healthy persistent development database on a predictable port', async () => {
    const compose = await readProjectFile('deploy/docker-compose.database.yml')

    expect(compose).toContain('image: postgres:17.6-bookworm')
    expect(compose).toContain('${WEYNE_DATABASE_PORT:-5432}:5432')
    expect(compose).toContain('POSTGRES_DB: weyne_dev')
    expect(compose).toContain('POSTGRES_USER: weyne_dev')
    expect(compose).toContain('POSTGRES_HOST_AUTH_METHOD: trust')
    expect(compose).not.toContain('POSTGRES_PASSWORD:')
    expect(compose).toContain('pg_isready -U weyne_dev -d weyne_dev')
    expect(compose).toContain('postgres-data:/var/lib/postgresql/data')
  })

  it('exposes start, wait, migrate, seed, setup, and destructive reset commands', async () => {
    const packageJson = JSON.parse(await readProjectFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['db:up']).toBe('bun scripts/local-database.ts up')
    expect(packageJson.scripts['db:wait']).toBe('bun scripts/local-database.ts wait')
    expect(packageJson.scripts['db:migrate:local']).toBe('bun scripts/local-database.ts migrate')
    expect(packageJson.scripts['db:seed']).toBe('bun scripts/local-database.ts seed')
    expect(packageJson.scripts['db:setup']).toBe('bun scripts/local-database.ts setup')
    expect(packageJson.scripts['db:reset']).toBe('bun scripts/local-database.ts reset')
  })

  it('closes the database connection after deterministic seeding', async () => {
    const seedDatabase = vi.fn(async () => undefined)
    const closeDatabase = vi.fn(async () => undefined)
    const runSeed = createSeedRunner({ seedDatabase, closeDatabase })

    await runSeed()

    expect(seedDatabase).toHaveBeenCalledOnce()
    expect(closeDatabase).toHaveBeenCalledOnce()
  })

  it('closes the database connection when seeding fails', async () => {
    const seedError = new Error('seed failed')
    const closeDatabase = vi.fn(async () => undefined)
    const runSeed = createSeedRunner({
      seedDatabase: async () => {
        throw seedError
      },
      closeDatabase,
    })

    await expect(runSeed()).rejects.toBe(seedError)
    expect(closeDatabase).toHaveBeenCalledOnce()
  })
})
