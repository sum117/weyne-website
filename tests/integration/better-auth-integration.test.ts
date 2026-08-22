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
 * Real-PostgreSQL contract for the Better Auth integration over the canonical
 * `users`/`sessions`/`accounts`/`verifications` tables: the Drizzle adapter
 * writes rows the canonical constraints accept, sign-in issues a
 * database-backed session with secure cookie attributes, sign-out revokes it,
 * and Better Auth's own origin/CSRF protections reject cross-site requests.
 *
 * Nothing here reimplements hashing, tokens, or cookie parsing; the test
 * drives `auth.handler(request)` exactly as the route does.
 */

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const baseDatabaseUrl = new URL(databaseUrl)
const isolatedDatabaseName = `better_auth_${randomUUID().replaceAll('-', '')}`
const isolatedDatabaseUrl = new URL(baseDatabaseUrl.toString())
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`

const ORIGIN = 'http://localhost:3000'
const CREDENTIALS = {
  name: 'Representante de teste',
  email: 'Rep.Teste@Example.Test',
  password: 'senha-de-teste-bem-longa',
  role: 'representative',
} as const

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

function authRequest(
  path: string,
  init: Readonly<{
    method?: string
    body?: unknown
    origin?: string | null
    cookie?: string
  }> = {},
): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  const origin = init.origin === undefined ? ORIGIN : init.origin
  if (origin !== null) headers.set('origin', origin)
  if (init.cookie) headers.set('cookie', init.cookie)

  return new Request(`${ORIGIN}${AUTH_BASE_PATH}${path}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

/** Extracts a `name=value` cookie pair from a Set-Cookie header list. */
function cookiePair(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    if (header.startsWith(`${name}=`)) return header.split(';')[0] ?? null
  }
  return null
}

function setCookieHeader(response: Response, name: string): string | null {
  return response.headers.getSetCookie().find((h) => h.startsWith(`${name}=`)) ?? null
}

async function signIn(): Promise<Response> {
  return auth.handler(
    authRequest('/sign-in/email', {
      body: { email: CREDENTIALS.email, password: CREDENTIALS.password },
    }),
  )
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

describe('Better Auth over the canonical PostgreSQL schema', () => {
  it('writes an identity the canonical constraints accept', async () => {
    const [user] = await client<
      {
        email: string
        role: string
        authSubject: string
        emailVerified: boolean
      }[]
    >`
      SELECT email, role, auth_subject AS "authSubject", email_verified AS "emailVerified"
      FROM users
    `

    expect(user).toBeDefined()
    // Better Auth normalizes the email; the canonical unique index is
    // case-insensitive, so the stored value must be the lowercased one.
    expect(user?.email).toBe(CREDENTIALS.email.toLowerCase())
    expect(user?.role).toBe(CREDENTIALS.role)
    expect(user?.emailVerified).toBe(false)
    // NOT NULL with no database default: the adapter must have supplied it.
    expect(user?.authSubject).toMatch(/^better-auth:/)

    const [account] = await client<{ providerId: string; password: string }[]>`
      SELECT provider_id AS "providerId", password FROM accounts
    `
    expect(account?.providerId).toBe('credential')
    // Library-hashed, never the plaintext.
    expect(account?.password).toBeTruthy()
    expect(account?.password).not.toContain(CREDENTIALS.password)
  })

  it('assigns UUID primary keys from the canonical column default', async () => {
    const [user] = await client<{ id: string }[]>`SELECT id FROM users`
    expect(user?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('signs in, persists a database session, and sets a hardened cookie', async () => {
    const response = await signIn()
    expect(response.status).toBe(200)

    const cookie = setCookieHeader(response, 'better-auth.session_token')
    expect(cookie).toBeTruthy()
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    // Plain-http development origin: no Secure. The production origin is https,
    // which flips both the attribute and the __Secure- prefix.
    expect(cookie).not.toContain('Secure')

    const [session] = await client<{ token: string; userId: string }[]>`
      SELECT token, user_id AS "userId" FROM sessions
    `
    expect(session).toBeDefined()
    // Revocable server-side state, not a stateless cookie.
    expect(session?.token).toBeTruthy()
  })

  it('marks the session cookie Secure when the origin is https', async () => {
    const secureAuth = createAuth(
      database,
      parseAuthConfig({ BETTER_AUTH_URL: 'https://weyne.example.test' }),
    )
    const response = await secureAuth.handler(
      new Request('https://weyne.example.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://weyne.example.test',
        },
        body: JSON.stringify({
          email: CREDENTIALS.email,
          password: CREDENTIALS.password,
        }),
      }),
    )

    expect(response.status).toBe(200)
    const cookie = setCookieHeader(response, '__Secure-better-auth.session_token')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
  })

  it('resolves the session from its cookie and rejects a revoked one', async () => {
    const signedIn = await signIn()
    const cookie = cookiePair(signedIn, 'better-auth.session_token')
    expect(cookie).toBeTruthy()

    const session = await auth.handler(
      authRequest('/get-session', { method: 'GET', cookie: cookie! }),
    )
    expect(session.status).toBe(200)
    const payload = (await session.json()) as { user?: { email?: string } } | null
    expect(payload?.user?.email).toBe(CREDENTIALS.email.toLowerCase())

    const signedOut = await auth.handler(
      authRequest('/sign-out', { cookie: cookie! }),
    )
    expect(signedOut.status).toBe(200)
    expect(await client`SELECT 1 FROM sessions`).toHaveLength(0)

    // The old cookie must not regain access after revocation.
    const replay = await auth.handler(
      authRequest('/get-session', { method: 'GET', cookie: cookie! }),
    )
    expect(await replay.json()).toBeNull()
  })

  it('rejects a wrong password without creating a session', async () => {
    const response = await auth.handler(
      authRequest('/sign-in/email', {
        body: { email: CREDENTIALS.email, password: 'senha-completamente-errada' },
      }),
    )

    expect(response.status).toBe(401)
    expect(await client`SELECT 1 FROM sessions`).toHaveLength(0)
  })

  it('refuses public sign-up', async () => {
    const response = await auth.handler(
      authRequest('/sign-up/email', {
        body: {
          name: 'Intruso',
          email: 'intruso@example.test',
          password: 'senha-longa-o-suficiente',
        },
      }),
    )

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(await client<{ email: string }[]>`SELECT email FROM users`).toHaveLength(1)
  })

  it('blocks a cross-site request carrying cookies (origin check)', async () => {
    const signedIn = await signIn()
    const cookie = cookiePair(signedIn, 'better-auth.session_token')!

    const response = await auth.handler(
      authRequest('/sign-out', {
        cookie,
        origin: 'https://attacker.example',
      }),
    )

    expect(response.status).toBe(403)
    // The session survived the rejected cross-site attempt.
    expect(await client`SELECT 1 FROM sessions`).toHaveLength(1)
  })

  it('blocks a cookie-bearing request with no origin or referer', async () => {
    const signedIn = await signIn()
    const cookie = cookiePair(signedIn, 'better-auth.session_token')!

    const response = await auth.handler(
      authRequest('/sign-out', { cookie, origin: null }),
    )

    expect(response.status).toBe(403)
    expect(await client`SELECT 1 FROM sessions`).toHaveLength(1)
  })

  it('never returns the password hash or auth subject in a response body', async () => {
    const signedIn = await signIn()
    const cookie = cookiePair(signedIn, 'better-auth.session_token')!
    const session = await auth.handler(
      authRequest('/get-session', { method: 'GET', cookie }),
    )

    const serialized = JSON.stringify(await session.json())
    expect(serialized).not.toMatch(/authSubject|auth_subject|password/i)
  })
})
