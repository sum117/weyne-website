import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAuth } from '@/lib/auth/auth.server'
import { AUTH_BASE_PATH, parseAuthConfig } from '@/lib/auth/config.server'
import {
  assertSafeBootstrapCredential,
  bootstrapAdministrator,
  MINIMUM_BOOTSTRAP_PASSWORD_LENGTH,
} from '@/lib/auth/bootstrap.server'
import { issuePasswordResetLink } from '@/lib/auth/password-reset.server'
import { provisionCredentialUser } from '@/lib/auth/provisioning.server'
import type { Database } from '@/lib/db/database.server'
import * as schema from '@/lib/db/schema'

/**
 * Real-PostgreSQL security contract for the account-lifecycle surfaces that
 * sit around sign-in: brute-force rate limiting, the one-time administrator
 * bootstrap, and the operator-issued password reset / invitation flow.
 *
 * Every assertion drives the real Better Auth instance against a real
 * database. Nothing here reimplements hashing, tokens, or cookie parsing, and
 * nothing asserts on an in-memory double: the whole point of these three
 * surfaces is what they do to persistent state.
 */

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const baseDatabaseUrl = new URL(databaseUrl)
const isolatedDatabaseName = `auth_lifecycle_${randomUUID().replaceAll('-', '')}`
const isolatedDatabaseUrl = new URL(baseDatabaseUrl.toString())
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`

const ORIGIN = 'http://localhost:3000'
const CREDENTIALS = {
  name: 'Representante de teste',
  email: 'rep.teste@example.test',
  password: 'senha-de-teste-bem-longa',
  role: 'representative',
} as const

const STRONG_PASSWORD = 'jXq7-vt2Lr9_Kd4Zs6Nb'

let adminClient: postgres.Sql
let client: postgres.Sql
let database: Database
let auth: ReturnType<typeof createAuth>

const authConfig = parseAuthConfig({
  BETTER_AUTH_URL: ORIGIN,
  NODE_ENV: 'development',
})

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

/**
 * Builds a Better Auth protocol request.
 *
 * `x-forwarded-for` is set because the rate limiter keys on client address:
 * without it every request in the suite would share one bucket and the tests
 * would interfere with each other.
 */
function authRequest(
  path: string,
  init: Readonly<{
    method?: string
    body?: unknown
    clientIp?: string
  }> = {},
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    origin: ORIGIN,
  })
  if (init.clientIp) headers.set('x-forwarded-for', init.clientIp)

  return new Request(`${ORIGIN}${AUTH_BASE_PATH}${path}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

/** A unique client address per test, so buckets never collide across tests. */
function uniqueClientIp(): string {
  const octet = () => 1 + Math.floor(Math.random() * 254)
  return `198.51.${octet()}.${octet()}`
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

  // A fresh instance per test: Better Auth caches its context, and each test
  // starts from an empty schema.
  auth = createAuth(database, authConfig)
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

describe('credential rate limiting', () => {
  beforeEach(async () => {
    await provisionCredentialUser(auth, CREDENTIALS)
  })

  it('throttles repeated failed sign-in attempts from one client', async () => {
    const clientIp = uniqueClientIp()
    const statuses: number[] = []

    // The configured rule is 10 per 60s; 12 attempts must cross it.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await auth.handler(
        authRequest('/sign-in/email', {
          clientIp,
          body: { email: CREDENTIALS.email, password: 'senha-completamente-errada' },
        }),
      )
      statuses.push(response.status)
    }

    expect(statuses).toContain(429)
    // The first attempt must be evaluated, not thrown away: a limiter that
    // rejected from the very first request would be a broken login page.
    expect(statuses[0]).not.toBe(429)
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0)
    expect(statuses.filter((status) => status !== 429).length).toBeLessThanOrEqual(10)
  })

  it('still refuses the correct password once the limit is reached', async () => {
    const clientIp = uniqueClientIp()

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await auth.handler(
        authRequest('/sign-in/email', {
          clientIp,
          body: { email: CREDENTIALS.email, password: 'senha-completamente-errada' },
        }),
      )
    }

    // The whole point of the limit: a throttled attacker cannot simply
    // continue guessing, and a correct guess arriving mid-lockout is refused
    // without issuing a session.
    const response = await auth.handler(
      authRequest('/sign-in/email', {
        clientIp,
        body: { email: CREDENTIALS.email, password: CREDENTIALS.password },
      }),
    )
    expect(response.status).toBe(429)
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })

  it('keys the limit by client address, so one attacker cannot lock out everyone', async () => {
    const attackerIp = uniqueClientIp()
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await auth.handler(
        authRequest('/sign-in/email', {
          clientIp: attackerIp,
          body: { email: CREDENTIALS.email, password: 'senha-completamente-errada' },
        }),
      )
    }

    const victim = await auth.handler(
      authRequest('/sign-in/email', {
        clientIp: uniqueClientIp(),
        body: { email: CREDENTIALS.email, password: CREDENTIALS.password },
      }),
    )
    expect(victim.status).toBe(200)
  })

  it('persists the counters in PostgreSQL rather than process memory', async () => {
    const clientIp = uniqueClientIp()
    await auth.handler(
      authRequest('/sign-in/email', {
        clientIp,
        body: { email: CREDENTIALS.email, password: 'senha-errada' },
      }),
    )

    const rows = await client<{ key: string; count: number; last_request: string }[]>`
      SELECT key, count, last_request FROM rate_limits
    `
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((row) => row.key.includes(clientIp))).toBe(true)

    // A brand-new instance shares no memory with the one above; the limit
    // must survive it, which is exactly what a container restart does.
    const restarted = createAuth(database, authConfig)
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await restarted.handler(
        authRequest('/sign-in/email', {
          clientIp,
          body: { email: CREDENTIALS.email, password: 'senha-errada' },
        }),
      )
    }
    const afterRestart = await restarted.handler(
      authRequest('/sign-in/email', {
        clientIp,
        body: { email: CREDENTIALS.email, password: CREDENTIALS.password },
      }),
    )
    expect(afterRestart.status).toBe(429)
  })
})

describe('administrator bootstrap', () => {
  const ADMIN = {
    name: 'Administradora Inicial',
    email: 'admin@weyne.test',
    password: STRONG_PASSWORD,
  } as const
  const SAFE_ENVIRONMENT = { isProduction: false, passwordFromArgv: false } as const

  it('creates exactly one administrator on an empty database', async () => {
    const outcome = await bootstrapAdministrator(auth, database, ADMIN, SAFE_ENVIRONMENT)

    expect(outcome.status).toBe('created')
    const rows = await client<{ email: string; role: string }[]>`
      SELECT email, role FROM users
    `
    expect(rows).toEqual([{ email: ADMIN.email, role: 'admin' }])
  })

  it('is idempotent: a second run neither duplicates nor overwrites', async () => {
    await bootstrapAdministrator(auth, database, ADMIN, SAFE_ENVIRONMENT)
    const [before] = await client<{ password: string }[]>`
      SELECT password FROM accounts WHERE provider_id = 'credential'
    `

    const second = await bootstrapAdministrator(
      auth,
      database,
      { ...ADMIN, password: 'Qz8-mR4tW6bK2vLp9dHs' },
      SAFE_ENVIRONMENT,
    )

    expect(second.status).toBe('already_bootstrapped')
    const rows = await client<{ id: string }[]>`SELECT id FROM users WHERE role = 'admin'`
    expect(rows).toHaveLength(1)

    // The critical property: an idempotent command that silently rewrote the
    // credential would be a backdoor, not a bootstrap.
    const [after] = await client<{ password: string }[]>`
      SELECT password FROM accounts WHERE provider_id = 'credential'
    `
    expect(after?.password).toBe(before?.password)
  })

  it('bootstraps a database that has non-administrator identities', async () => {
    await provisionCredentialUser(auth, CREDENTIALS)

    const outcome = await bootstrapAdministrator(auth, database, ADMIN, SAFE_ENVIRONMENT)

    expect(outcome.status).toBe('created')
    const rows = await client<{ total: number }[]>`
      SELECT count(*)::int AS total FROM users WHERE role = 'admin'
    `
    expect(rows[0]?.total).toBe(1)
  })

  it('issues a working credential', async () => {
    await bootstrapAdministrator(auth, database, ADMIN, SAFE_ENVIRONMENT)

    const response = await auth.handler(
      authRequest('/sign-in/email', {
        clientIp: uniqueClientIp(),
        body: { email: ADMIN.email, password: ADMIN.password },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0)
  })

  it.each([
    ['a short password', { ...ADMIN, password: 'Curta-1' }],
    ['a placeholder password', { ...ADMIN, password: 'changeme-changeme-1' }],
    ['a password containing the product name', { ...ADMIN, password: 'weyne-2026-acesso!' }],
    ['a blank name', { ...ADMIN, name: '   ' }],
    ['an invalid email', { ...ADMIN, email: 'nao-e-um-email' }],
  ])('refuses %s', async (_label, input) => {
    await expect(
      bootstrapAdministrator(auth, database, input, SAFE_ENVIRONMENT),
    ).rejects.toThrow()

    const rows = await client<{ total: number }[]>`SELECT count(*)::int AS total FROM users`
    expect(rows[0]?.total).toBe(0)
  })

  it('never echoes the rejected password in the error message', () => {
    const secret = 'changeme-do-not-leak-me'
    let message = ''
    try {
      assertSafeBootstrapCredential(
        { ...ADMIN, password: secret },
        SAFE_ENVIRONMENT,
      )
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).not.toBe('')
    expect(message).not.toContain(secret)
  })

  it('refuses a command-line password in production', () => {
    expect(() =>
      assertSafeBootstrapCredential(ADMIN, {
        isProduction: true,
        passwordFromArgv: true,
      }),
    ).toThrow(/command-line argument/i)

    // The same credential from the environment is accepted.
    expect(() =>
      assertSafeBootstrapCredential(ADMIN, {
        isProduction: true,
        passwordFromArgv: false,
      }),
    ).not.toThrow()
  })

  it('enforces a minimum length above Better Auth own floor', () => {
    expect(MINIMUM_BOOTSTRAP_PASSWORD_LENGTH).toBeGreaterThan(12)
  })
})

describe('operator-issued password reset and invitation', () => {
  beforeEach(async () => {
    await provisionCredentialUser(auth, CREDENTIALS)
  })

  it('issues a link that sets a new password and lets the owner sign in', async () => {
    const outcome = await issuePasswordResetLink(database, authConfig, CREDENTIALS.email)
    expect(outcome.status).toBe('issued')
    if (outcome.status !== 'issued') return

    const token = outcome.url.split('/').at(-1)
    expect(token).toBeTruthy()

    const reset = await auth.handler(
      authRequest('/reset-password', {
        clientIp: uniqueClientIp(),
        body: { token, newPassword: STRONG_PASSWORD },
      }),
    )
    expect(reset.status).toBe(200)

    const signIn = await auth.handler(
      authRequest('/sign-in/email', {
        clientIp: uniqueClientIp(),
        body: { email: CREDENTIALS.email, password: STRONG_PASSWORD },
      }),
    )
    expect(signIn.status).toBe(200)

    // The old password must stop working the moment the new one is set.
    const stale = await auth.handler(
      authRequest('/sign-in/email', {
        clientIp: uniqueClientIp(),
        body: { email: CREDENTIALS.email, password: CREDENTIALS.password },
      }),
    )
    expect(stale.status).not.toBe(200)
  })

  it('burns the token after one use', async () => {
    const outcome = await issuePasswordResetLink(database, authConfig, CREDENTIALS.email)
    if (outcome.status !== 'issued') throw new Error('expected an issued link')
    const token = outcome.url.split('/').at(-1)

    const first = await auth.handler(
      authRequest('/reset-password', {
        clientIp: uniqueClientIp(),
        body: { token, newPassword: STRONG_PASSWORD },
      }),
    )
    expect(first.status).toBe(200)

    const replay = await auth.handler(
      authRequest('/reset-password', {
        clientIp: uniqueClientIp(),
        body: { token, newPassword: 'mais-uma-senha-diferente-42' },
      }),
    )
    expect(replay.status).not.toBe(200)

    // And the replayed password must not have been set.
    const signIn = await auth.handler(
      authRequest('/sign-in/email', {
        clientIp: uniqueClientIp(),
        body: { email: CREDENTIALS.email, password: 'mais-uma-senha-diferente-42' },
      }),
    )
    expect(signIn.status).not.toBe(200)
  })

  it('revokes every existing session when the password is reset', async () => {
    const signIn = await auth.handler(
      authRequest('/sign-in/email', {
        clientIp: uniqueClientIp(),
        body: { email: CREDENTIALS.email, password: CREDENTIALS.password },
      }),
    )
    expect(signIn.status).toBe(200)
    const before = await client<{ total: number }[]>`
      SELECT count(*)::int AS total FROM sessions
    `
    expect(before[0]?.total).toBe(1)

    const outcome = await issuePasswordResetLink(database, authConfig, CREDENTIALS.email)
    if (outcome.status !== 'issued') throw new Error('expected an issued link')

    await auth.handler(
      authRequest('/reset-password', {
        clientIp: uniqueClientIp(),
        body: { token: outcome.url.split('/').at(-1), newPassword: STRONG_PASSWORD },
      }),
    )

    // If the password was reset because it was compromised, the attacker's
    // live session must not outlive the reset.
    const after = await client<{ total: number }[]>`
      SELECT count(*)::int AS total FROM sessions
    `
    expect(after[0]?.total).toBe(0)
  })

  it('rejects a forged token', async () => {
    const response = await auth.handler(
      authRequest('/reset-password', {
        clientIp: uniqueClientIp(),
        body: { token: randomUUID(), newPassword: STRONG_PASSWORD },
      }),
    )
    expect(response.status).not.toBe(200)
  })

  it('rejects a new password shorter than the configured minimum', async () => {
    const outcome = await issuePasswordResetLink(database, authConfig, CREDENTIALS.email)
    if (outcome.status !== 'issued') throw new Error('expected an issued link')

    const response = await auth.handler(
      authRequest('/reset-password', {
        clientIp: uniqueClientIp(),
        body: { token: outcome.url.split('/').at(-1), newPassword: 'curta' },
      }),
    )
    expect(response.status).not.toBe(200)
  })

  it('reports an unknown address to the operator without creating anything', async () => {
    const outcome = await issuePasswordResetLink(
      database,
      authConfig,
      'ninguem@example.test',
    )
    expect(outcome.status).toBe('unknown_identity')

    const rows = await client<{ total: number }[]>`
      SELECT count(*)::int AS total FROM verifications
    `
    expect(rows[0]?.total).toBe(0)
  })

  it('does not leak whether an address exists over the public endpoint', async () => {
    const known = await auth.handler(
      authRequest('/request-password-reset', {
        clientIp: uniqueClientIp(),
        body: { email: CREDENTIALS.email },
      }),
    )
    const unknown = await auth.handler(
      authRequest('/request-password-reset', {
        clientIp: uniqueClientIp(),
        body: { email: 'ninguem@example.test' },
      }),
    )

    expect(known.status).toBe(unknown.status)
    expect(await known.text()).toBe(await unknown.text())
  })

  it('throttles reset requests', async () => {
    const clientIp = uniqueClientIp()
    const statuses: number[] = []
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await auth.handler(
        authRequest('/request-password-reset', {
          clientIp,
          body: { email: CREDENTIALS.email },
        }),
      )
      statuses.push(response.status)
    }
    expect(statuses).toContain(429)
  })
})
