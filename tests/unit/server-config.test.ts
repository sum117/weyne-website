import { describe, expect, it } from 'vitest'
import { parseServerConfig } from '@/lib/server/config.server'

describe('parseServerConfig', () => {
  it('returns normalized required values with safe network defaults', () => {
    expect(
      parseServerConfig({
        DATABASE_URL: '  postgresql://weyne:secret@database:5432/weyne  ',
      }),
    ).toEqual({
      databaseUrl: 'postgresql://weyne:secret@database:5432/weyne',
      host: '0.0.0.0',
      port: 3000,
    })
  })

  it.each([
    [{}, 'DATABASE_URL is required'],
    [{ DATABASE_URL: 'mysql://database/weyne' }, 'valid PostgreSQL URL'],
    [
      { DATABASE_URL: 'postgresql://database/weyne', PORT: '3000.5' },
      'PORT must be an integer between 1 and 65535',
    ],
    [
      { DATABASE_URL: 'postgresql://database/weyne', PORT: '0' },
      'PORT must be an integer between 1 and 65535',
    ],
    [
      { DATABASE_URL: 'postgresql://database/weyne', HOST: 'not a host!' },
      'HOST must be a valid hostname or IP address',
    ],
  ])('rejects invalid startup configuration without echoing values', (environment, message) => {
    expect(() => parseServerConfig(environment)).toThrow(message)

    try {
      parseServerConfig(environment)
    } catch (error) {
      expect(String(error)).not.toContain('mysql://database/weyne')
      expect(String(error)).not.toContain('not a host!')
    }
  })
})
