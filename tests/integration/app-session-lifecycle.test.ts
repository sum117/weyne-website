import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAuth } from '@/lib/auth/auth.server'
import { AUTH_BASE_PATH, parseAuthConfig } from '@/lib/auth/config.server'
import { expiredSessionCookieHeaders, sessionCookieNames } from '@/lib/auth/cookie.server'
import { provisionCredentialUser } from '@/lib/auth/provisioning.server'
import type { Database } from '@/lib/db/database.server'
import * as schema from '@/lib/db/schema'

/**
 * Real-PostgreSQL contract for the application session lifecycle built on top
 * of the Better Auth integration: the session projection handed to client
 * code, the persistence of a session across a fresh request, revocation on
 * sign-out, and the refusal of a replayed cookie.
 *
 * The session resolution logic under test lives in
 * `src/lib/auth/session.server.ts`. That module reads the AMBIENT request
 * through `@tanstack/react-start/server`, which only exists inside the Start
 * runtime, so these tests exercise its request-explicit twin plus the exact
 * Better Auth calls it makes. The ambient wiring itself is covered by
 * `scripts/smoke-auth-flow.ts` against a live server.
 */

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const baseDatabaseUrl = new URL(databaseUrl)
const isolatedDatabaseName = `app_session_${randomUUID().replaceAll('-', '')}`
const isolatedDatabaseUrl = new URL(baseDatabaseUrl.toString())
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`

const ORIGIN = 'http://localhost:3000'
const CREDENTIALS = {
  name: 'Ana Gestora',
  email: 'Ana.Gestora@Example.Test',
  password: 'senha-de-teste-bem-longa',
  role: 'admin',
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

/** Mirrors `resolveSessionFromRequest`'s Better Auth call and projection. */
async function resolveSession(cookie: string | null) {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  const payload = await auth.api.getSession({ headers })
  if (!payload) return null
  const { user, session } = payload
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: (user as { role?: string }).role,
    },
    expiresAt: new Date(session.expiresAt).toISOString(),
  }
}

async function signIn(): Promise<Response> {
  return auth.handler(
    new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({
        email: CREDENTIALS.email,
        password: CREDENTIALS.password,
      }),
    }),
  )
}

function cookiePair(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    if (header.startsWith(`${name}=`)) return header.split(';')[0] ?? null
  }
  return null
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

describe('application session lifecycle', () => {
  it('resolves nothing for a request with no cookie', async () => {
    expect(await resolveSession(null)).toBeNull()
  })

  it('resolves nothing for a forged or corrupted cookie', async () => {
    expect(
      await resolveSession('better-auth.session_token=nao-e-um-token-valido'),
    ).toBeNull()
    // A structurally plausible but unsigned token must not resolve either.
    expect(
      await resolveSession(
        'better-auth.session_token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb',
      ),
    ).toBeNull()
  })

  it('projects only the minimal, non-sensitive session fields', async () => {
    const cookie = cookiePair(await signIn(), 'better-auth.session_token')!
    const session = await resolveSession(cookie)

    expect(session).not.toBeNull()
    expect(Object.keys(session!).sort()).toEqual(['expiresAt', 'user'])
    expect(Object.keys(session!.user).sort()).toEqual(['email', 'id', 'name', 'role'])
    expect(session!.user.email).toBe(CREDENTIALS.email.toLowerCase())
    expect(session!.user.role).toBe('admin')

    // The projection carries no session token, no external subject, and no
    // password material.
    const serialized = JSON.stringify(session)
    expect(serialized).not.toMatch(/authSubject|auth_subject|password|token/i)
    const rows = await client<{ token: string }[]>`SELECT token FROM sessions`
    expect(rows).toHaveLength(1)
    expect(serialized).not.toContain(rows[0]!.token)
  })

  it('keeps resolving the session on a later, independent request', async () => {
    const cookie = cookiePair(await signIn(), 'better-auth.session_token')!

    // Two separate resolutions, each starting from only the cookie: this is
    // what a full page reload does.
    const first = await resolveSession(cookie)
    const second = await resolveSession(cookie)

    expect(first?.user.id).toBeDefined()
    expect(second?.user.id).toBe(first?.user.id)
    expect(await client`SELECT 1 FROM sessions`).toHaveLength(1)
  })

  it('stops resolving once the session row is revoked', async () => {
    const signedIn = await signIn()
    const cookie = cookiePair(signedIn, 'better-auth.session_token')!
    expect(await resolveSession(cookie)).not.toBeNull()

    const signedOut = await auth.handler(
      new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-out`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie },
      }),
    )
    expect(signedOut.status).toBe(200)

    // Revoked server-side, not merely cleared in the browser.
    expect(await client`SELECT 1 FROM sessions`).toHaveLength(0)
    expect(await resolveSession(cookie)).toBeNull()
  })

  it('refuses a session whose row was deleted out from under the cookie', async () => {
    const cookie = cookiePair(await signIn(), 'better-auth.session_token')!
    // An administrator revoking sessions writes exactly this.
    await client`DELETE FROM sessions`

    expect(await resolveSession(cookie)).toBeNull()
  })

  it('refuses an expired session without deleting anything first', async () => {
    const cookie = cookiePair(await signIn(), 'better-auth.session_token')!
    await client`UPDATE sessions SET expires_at = now() - interval '1 hour'`

    expect(await resolveSession(cookie)).toBeNull()
  })

  it('issues a second session without invalidating the first', async () => {
    const firstCookie = cookiePair(await signIn(), 'better-auth.session_token')!
    const secondCookie = cookiePair(await signIn(), 'better-auth.session_token')!
    expect(secondCookie).not.toBe(firstCookie)

    // Two devices, two revocable rows: signing in on one must not sign the
    // other out.
    expect(await client`SELECT 1 FROM sessions`).toHaveLength(2)
    expect(await resolveSession(firstCookie)).not.toBeNull()
    expect(await resolveSession(secondCookie)).not.toBeNull()
  })

  it('signs out only the presented session', async () => {
    const firstCookie = cookiePair(await signIn(), 'better-auth.session_token')!
    const secondCookie = cookiePair(await signIn(), 'better-auth.session_token')!

    await auth.handler(
      new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-out`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: firstCookie },
      }),
    )

    expect(await resolveSession(firstCookie)).toBeNull()
    expect(await resolveSession(secondCookie)).not.toBeNull()
  })
})

describe('session cookie clearing fallback', () => {
  it('names the same cookies Better Auth actually sets', async () => {
    const config = parseAuthConfig({ BETTER_AUTH_URL: ORIGIN })
    const issued = new Set(
      (await signIn()).headers
        .getSetCookie()
        .map((header) => header.split('=')[0]!),
    )

    // Every cookie Better Auth issued must be one this module can expire.
    // A drift here would leave a stale cookie in the browser.
    const clearable = new Set(sessionCookieNames(config))
    for (const name of issued) expect(clearable).toContain(name)
  })

  it('expires each cookie with matching attributes', () => {
    const headers = expiredSessionCookieHeaders(
      parseAuthConfig({ BETTER_AUTH_URL: ORIGIN }),
    )
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      expect(header).toContain('Max-Age=0')
      expect(header).toContain('Path=/')
      expect(header).toContain('HttpOnly')
      expect(header).toContain('SameSite=Lax')
      expect(header).not.toContain('Secure')
      // Empty value: nothing resembling a token is ever written back.
      expect(header.split(';')[0]).toMatch(/=$/)
    }
  })

  it('adds Secure and the __Secure- prefix on an https origin', () => {
    const headers = expiredSessionCookieHeaders(
      parseAuthConfig({ BETTER_AUTH_URL: 'https://weyne.example.test' }),
    )
    for (const header of headers) {
      expect(header).toContain('Secure')
      expect(header.startsWith('__Secure-')).toBe(true)
    }
  })
})
