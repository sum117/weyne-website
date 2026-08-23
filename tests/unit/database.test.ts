import { describe, expect, it } from 'vitest'
import { createConnectionManager } from '@/lib/db/connection-manager.server'
import { parseDatabaseConfig } from '@/lib/db/config.server'

describe('parseDatabaseConfig', () => {
  it('accepts a PostgreSQL URL and returns normalized server configuration', () => {
    expect(
      parseDatabaseConfig({
        DATABASE_URL: '  postgresql://user:secret@localhost:5432/weyne  ',
      }),
    ).toEqual({
      url: 'postgresql://user:secret@localhost:5432/weyne',
      pool: {
        max: 10,
        idleTimeoutSeconds: 30,
        connectTimeoutSeconds: 10,
        statementTimeoutMs: 30_000,
        idleInTransactionTimeoutMs: 15_000,
      },
    })
  })

  it.each([
    [{}, 'DATABASE_URL is required'],
    [{ DATABASE_URL: 'mysql://localhost/weyne' }, 'valid PostgreSQL URL'],
    [{ DATABASE_URL: 'postgresql://localhost' }, 'valid PostgreSQL URL'],
  ])('rejects invalid server configuration without exposing values', (env, message) => {
    expect(() => parseDatabaseConfig(env)).toThrow(message)

    try {
      parseDatabaseConfig(env)
    } catch (error) {
      expect(String(error)).not.toContain('mysql://localhost/weyne')
    }
  })

  it.each([
    ['WEYNE_DB_POOL_MAX', '100', 'max'],
    ['WEYNE_DB_IDLE_TIMEOUT_SECONDS', '120', 'idleTimeoutSeconds'],
    ['WEYNE_DB_CONNECT_TIMEOUT_SECONDS', '30', 'connectTimeoutSeconds'],
    ['WEYNE_DB_STATEMENT_TIMEOUT_MS', '60000', 'statementTimeoutMs'],
    [
      'WEYNE_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
      '45000',
      'idleInTransactionTimeoutMs',
    ],
  ])('overrides %s through the environment', (variable, value, key) => {
    const config = parseDatabaseConfig({
      DATABASE_URL: 'postgresql://localhost/weyne',
      [variable]: value,
    })
    expect(config.pool[key as keyof typeof config.pool]).toBe(Number(value))
  })

  it('rejects out-of-range or non-numeric pool settings', () => {
    expect(() =>
      parseDatabaseConfig({
        DATABASE_URL: 'postgresql://localhost/weyne',
        WEYNE_DB_POOL_MAX: '0',
      }),
    ).toThrow('Invalid server database configuration')
    expect(() =>
      parseDatabaseConfig({
        DATABASE_URL: 'postgresql://localhost/weyne',
        WEYNE_DB_STATEMENT_TIMEOUT_MS: '-1',
      }),
    ).toThrow('Invalid server database configuration')
    expect(() =>
      parseDatabaseConfig({
        DATABASE_URL: 'postgresql://localhost/weyne',
        WEYNE_DB_POOL_MAX: 'not-a-number',
      }),
    ).toThrow('Invalid server database configuration')
  })})

describe('createConnectionManager', () => {
  it('reuses one in-flight connection for concurrent callers', async () => {
    let connectionCount = 0
    const database = { kind: 'typed-database' }
    const manager = createConnectionManager({
      loadConfig: () => parseDatabaseConfig({ DATABASE_URL: 'postgresql://localhost/weyne' }),
      connect: async () => {
        connectionCount += 1
        await Promise.resolve()
        return { database, close: async () => undefined }
      },
    })

    const [first, second] = await Promise.all([
      manager.getDatabase(),
      manager.getDatabase(),
    ])

    expect(first).toBe(database)
    expect(second).toBe(database)
    expect(connectionCount).toBe(1)
  })

  it('closes once and creates a fresh connection after shutdown', async () => {
    let connectionCount = 0
    let closeCount = 0
    const manager = createConnectionManager({
      loadConfig: () => parseDatabaseConfig({ DATABASE_URL: 'postgresql://localhost/weyne' }),
      connect: () => {
        connectionCount += 1
        return {
          database: { connection: connectionCount },
          close: async () => {
            closeCount += 1
          },
        }
      },
    })

    expect(await manager.getDatabase()).toEqual({ connection: 1 })
    await Promise.all([manager.close(), manager.close()])
    expect(await manager.getDatabase()).toEqual({ connection: 2 })

    expect(connectionCount).toBe(2)
    expect(closeCount).toBe(1)
  })

  it('allows retry after connection creation fails', async () => {
    let attempts = 0
    const manager = createConnectionManager({
      loadConfig: () => parseDatabaseConfig({ DATABASE_URL: 'postgresql://localhost/weyne' }),
      connect: () => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('database unavailable')
        }
        return { database: 'ready', close: async () => undefined }
      },
    })

    await expect(manager.getDatabase()).rejects.toThrow('database unavailable')
    await expect(manager.getDatabase()).resolves.toBe('ready')
    expect(attempts).toBe(2)
  })
})
