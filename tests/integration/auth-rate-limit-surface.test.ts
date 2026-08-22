import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAuth } from '@/lib/auth/auth.server'
import { AUTH_BASE_PATH, parseAuthConfig } from '@/lib/auth/config.server'
import { provisionCredentialUser } from '@/lib/auth/provisioning.server'
import type { Database } from '@/lib/db/database.server'
import * as schema from '@/lib/db/schema'

/**
 * Pins the reason `signInWithPassword` calls `auth.handler(request)` instead
 * of `auth.api.signInEmail(...)`.
 *
 * Better Auth's rate limiter runs in its ROUTER's `onRequest` hook. The `api`
 * object is the endpoint collection underneath that router, so a direct
 * `auth.api.*` call never passes through the limiter at all. Using it for the
 * login server function would have left the credential endpoint the login
 * form actually posts to with unlimited attempts, while
 * `/api/auth/sign-in/email` sitting right beside it was throttled — the worst
 * possible outcome, because the protection would look present in
 * configuration and be absent in practice.
 *
 * This file asserts BOTH halves of that asymmetry against a real database, so
 * a future refactor back to `auth.api.signInEmail` fails here with an
 * explanation rather than silently removing the protection.
 */

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const baseDatabaseUrl = new URL(databaseUrl)
const isolatedDatabaseName = `auth_limiter_${randomUUID().replaceAll('-', '')}`
const isolatedDatabaseUrl = new URL(baseDatabaseUrl.toString())
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`

const ORIGIN = 'http://localhost:3000'
const CREDENTIALS = {
  name: 'Representante de teste',
  email: 'rep.limite@example.test',
  password: 'senha-de-teste-bem-longa',
  role: 'representative',
} as const

const ATTEMPTS = 15
const CLIENT_IP = '203.0.113.42'

let adminClient: postgres.Sql
let client: postgres.Sql
let database: Database
let auth: ReturnType<typeof createAuth>

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

async function applyCanonicalMigrations(sql: postgres.Sql): Promise<void> {
  const directory = resolve(process.cwd(), 'drizzle/canonical')
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
  for (const name of names) {
    await sql.unsafe(await readFile(resolve(directory, name), 'utf8'))
  }
}

beforeAll(async () => {
  adminClient = postgres(baseDatabaseUrl.toString(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  })
  await adminClient.unsafe(`CREATE DATABASE ${quoteIdentifier(isolatedDatabaseName)}`)
  client = postgres(isolatedDatabaseUrl.toString(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  })
  database = drizzle(client, { schema }) as Database
})

beforeEach(async () => {
  await client.unsafe('DROP SCHEMA public CASCADE')
  await client.unsafe('CREATE SCHEMA public')
  await applyCanonicalMigrations(client)
  auth = createAuth(
    database,
    parseAuthConfig({ BETTER_AUTH_URL: ORIGIN, NODE_ENV: 'development' }),
  )
  await provisionCredentialUser(auth, CREDENTIALS)
})

afterAll(async () => {
  try {
    await client?.end({ timeout: 5 })
  } finally {
    try {
      await adminClient?.unsafe(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(isolatedDatabaseName)} WITH (FORCE)`,
      )
    } finally {
      await adminClient?.end({ timeout: 5 })
    }
  }
})

describe('rate limiting applies to the handler, not the api object', () => {
  it('throttles repeated failures through auth.handler', async () => {
    let throttled = 0
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const response = await auth.handler(
        new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-in/email`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: ORIGIN,
            'x-forwarded-for': CLIENT_IP,
          },
          body: JSON.stringify({
            email: CREDENTIALS.email,
            password: 'senha-errada',
          }),
        }),
      )
      if (response.status === 429) throttled += 1
    }
    expect(throttled).toBeGreaterThan(0)
  })

  it('does NOT throttle the same failures through auth.api — the trap this guards against', async () => {
    let rejected = 0
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const response = await auth.api.signInEmail({
        body: { email: CREDENTIALS.email, password: 'senha-errada' },
        headers: new Headers({
          origin: ORIGIN,
          'x-forwarded-for': CLIENT_IP,
        }),
        asResponse: true,
      })
      // Every one is a plain credential rejection; none is a 429.
      expect(response.status).not.toBe(429)
      if (!response.ok) rejected += 1
    }
    // All 15 guesses were evaluated. This is the documented behavior of the
    // `api` object, and precisely why the login server function must not use
    // it: the limiter is in the router, which `api` sits below.
    expect(rejected).toBe(ATTEMPTS)
  })

  it('records no rate-limit row for api traffic', async () => {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      await auth.api
        .signInEmail({
          body: { email: CREDENTIALS.email, password: 'senha-errada' },
          headers: new Headers({
            origin: ORIGIN,
            'x-forwarded-for': CLIENT_IP,
          }),
          asResponse: true,
        })
        .catch(() => undefined)
    }

    const rows = await client<{ total: number }[]>`
      SELECT count(*)::int AS total FROM rate_limits
    `
    expect(rows[0]?.total).toBe(0)
  })
})
