// Dependency readiness probes. Liveness stays in the HTTP handler: the
// process being up is /healthz; its dependencies being usable is /readyz.
//
// Probes are deliberately cheap and read-only: one `SELECT 1` against the
// pooled database connection and one bounded HeadBucket against object
// storage when storage is configured. Failures never surface raw causes —
// driver errors can embed the DATABASE_URL — only machine-readable status.

import { HeadBucketCommand } from '@aws-sdk/client-s3'
import type { S3Client } from '@aws-sdk/client-s3'
import { sql } from 'drizzle-orm'
import { getDatabase } from '@/lib/db/database.server'
import { createS3Client, parseS3Config } from '@/lib/storage/s3.server'

export type DependencyCheck = Readonly<{
  name: 'database' | 'object-storage'
  required: boolean
  status: 'ok' | 'unavailable'
}>

export type ReadinessReport = Readonly<{
  ready: boolean
  checks: readonly DependencyCheck[]
}>

async function probeDatabase(): Promise<boolean> {
  try {
    const database = await getDatabase()
    await database.execute(sql`select 1`)
    return true
  } catch {
    // Swallow the cause on purpose: postgres driver errors embed the
    // connection URL. The status alone is enough for orchestration.
    return false
  }
}

/**
 * Object storage is a required dependency only when the deployment
 * configures it (full S3 credential set present). Absent configuration is
 * "not used", not "broken" — the landing site and smoke paths need none.
 */
export function isStorageConfigured(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return Boolean(
    environment.S3_REGION &&
      environment.S3_BUCKET &&
      environment.S3_ACCESS_KEY_ID &&
      environment.S3_SECRET_ACCESS_KEY,
  )
}

const STORAGE_PROBE_TIMEOUT_MS = 3_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('probe timed out')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (cause) => {
        clearTimeout(timer)
        reject(cause)
      },
    )
  })
}

async function probeObjectStorage(): Promise<boolean> {
  try {
    // A fresh client per probe keeps credentials handling inside parseS3Config
    // and avoids caching a client across credential rotation.
    const config = parseS3Config(process.env)
    const client: S3Client = createS3Client(config)
    await withTimeout(
      client.send(new HeadBucketCommand({ Bucket: config.bucket })),
      STORAGE_PROBE_TIMEOUT_MS,
    )
    try {
      client.destroy()
    } catch {
      // destroy() is best-effort teardown of keep-alive sockets.
    }
    return true
  } catch {
    return false
  }
}

export async function readDependencies(): Promise<ReadinessReport> {
  const storageRequired = isStorageConfigured(process.env)

  const [databaseOk, storageOk] = await Promise.all([
    probeDatabase(),
    storageRequired ? probeObjectStorage() : Promise.resolve(true),
  ])

  const checks: DependencyCheck[] = [
    { name: 'database', required: true, status: databaseOk ? 'ok' : 'unavailable' },
    ...(storageRequired
      ? [
          {
            name: 'object-storage' as const,
            required: true,
            status: storageOk ? ('ok' as const) : ('unavailable' as const),
          },
        ]
      : []),
  ]

  return {
    ready: checks.every((check) => check.status === 'ok'),
    checks,
  }
}
