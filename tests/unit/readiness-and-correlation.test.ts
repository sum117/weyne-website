import { describe, expect, it, vi } from 'vitest'

const probes = vi.hoisted(() => ({
  database: vi.fn(),
  storageConfigured: true,
  storageProbe: vi.fn(),
}))

vi.mock('@/lib/db/database.server', () => ({
  getDatabase: () =>
    probes.database().then(() => ({
      execute: async () => undefined,
    })),
}))

vi.mock('@/lib/storage/s3.server', () => ({
  parseS3Config: (env: Record<string, string | undefined>) => ({
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: true,
    signedUrlTtlSeconds: 900,
  }),
  createS3Client: () => ({
    send: async () => probes.storageProbe(),
    destroy: async () => undefined,
  }),
}))

import {
  isStorageConfigured,
  readDependencies,
} from '@/lib/server/readiness.server'
import { runWithLogContext } from '@/lib/server/log-context.server'
import {
  logStructuredEvent,
  logUnexpectedError,
  REDACTED,
} from '@/lib/server/log-redaction'

const fullEnvironment = {
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'weyne-staging-private',
  S3_ACCESS_KEY_ID: 'staging-key',
  S3_SECRET_ACCESS_KEY: 'staging-secret',
}

describe('readiness probes', () => {
  it('reports ready when every required dependency answers', async () => {
    probes.database.mockResolvedValue(undefined)
    probes.storageProbe.mockResolvedValue(undefined)

    const report = await withStorageEnv(() => readDependencies())

    expect(report.ready).toBe(true)
    expect(report.checks).toEqual([
      { name: 'database', required: true, status: 'ok' },
      { name: 'object-storage', required: true, status: 'ok' },
    ])
  })

  it('goes not-ready when the database probe fails and never leaks its cause', async () => {
    probes.database.mockRejectedValue(
      new Error('password authentication failed for url postgresql://app:hunter2@db:5432/weyne'),
    )
    probes.storageProbe.mockResolvedValue(undefined)

    const report = await withStorageEnv(() => readDependencies())

    expect(report.ready).toBe(false)
    expect(report.checks[0]).toEqual({
      name: 'database',
      required: true,
      status: 'unavailable',
    })
  })

  it('goes not-ready when object storage fails while configured', async () => {
    probes.database.mockResolvedValue(undefined)
    probes.storageProbe.mockRejectedValue(new Error('bucket unreachable'))

    const report = await withStorageEnv(() => readDependencies())

    expect(report.ready).toBe(false)
    expect(report.checks[1]).toEqual({
      name: 'object-storage',
      required: true,
      status: 'unavailable',
    })
  })

  it('treats absent storage configuration as not-used, not broken', async () => {
    probes.database.mockResolvedValue(undefined)
    expect(isStorageConfigured({})).toBe(false)
    expect(isStorageConfigured({ ...fullEnvironment, S3_BUCKET: '' })).toBe(false)

    const saved: Record<string, string | undefined> = {}
    for (const key of Object.keys(fullEnvironment)) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    try {
      const report = await readDependencies()
      expect(report.ready).toBe(true)
      expect(report.checks.map((check) => check.name)).toEqual(['database'])
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value !== undefined) process.env[key] = value
      }
    }
  })
})

async function withStorageEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(fullEnvironment)) {
    saved[key] = process.env[key]
    process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[key] = value
      else delete process.env[key]
    }
  }
}

describe('request correlation through background work', () => {
  it('propagates the request id across awaits into structured logs', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'info').mockImplementation((line) => {
      lines.push(String(line))
    })

    try {
      await runWithLogContext(
        { requestId: 'req-123' },
        async () => {
          // Background-style hop: the correlation ID must survive awaits.
          await new Promise((resolve) => setTimeout(resolve, 0))
          logStructuredEvent({ kind: 'event', scope: 'test.background' })
        },
      )

      const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
      expect(parsed.requestId).toBe('req-123')
      expect(parsed.kind).toBe('event')
    } finally {
      spy.mockRestore()
    }
  })

  it('omits the request id outside any log context', () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'info').mockImplementation((line) => {
      lines.push(String(line))
    })

    try {
      logStructuredEvent({ kind: 'event', scope: 'test.bare' })
      const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
      expect(parsed.requestId).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })

  it('redacts seeded fake secrets that reach a log payload', () => {
    const lines: string[] = []
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((line) => lines.push(String(line)))

    try {
      runWithLogContext({ requestId: 'req-456' }, () => {
        logUnexpectedError('test.seeded', new Error(
          'failed connecting to postgresql://staging_user:SUPERFAKESECRET123@db:5432/weyne with Authorization: Bearer FAKE.TOKEN.VALUE',
        ))
      })

      const line = lines.join('\n')
      expect(line).toContain('"requestId":"req-456"')
      expect(line).toContain(REDACTED)
      expect(line).not.toContain('SUPERFAKESECRET123')
      expect(line).not.toContain('FAKE.TOKEN.VALUE')
    } finally {
      spy.mockRestore()
    }
  })
})
