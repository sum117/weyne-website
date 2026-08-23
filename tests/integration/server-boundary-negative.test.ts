import { readdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { H3Event } from 'h3-v2'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Negative integration contract for the server-function boundaries that were
 * still fail-closed stubs (card t_47279c5d): carriers, industries, user
 * management, audit activity, and settings.
 *
 * The TanStack Start compiler plugin (see vitest.integration.config.ts) gives
 * each `createServerFn` its production split-handler module; the tests below
 * invoke that REAL handler with the ambient Start request bound to a
 * synthetic request carrying a controlled cookie. That runs the exact code an
 * HTTP call would run: cookie parse → signed session lookup → session row →
 * role projection → authorization decision. No socket, no shortcut.
 *
 * Acceptance matrix (threat model §7, P0 row 1 — T01/T02/T14):
 * - unauthenticated  → 401 UNAUTHENTICATED;
 * - forged cookie    → 401, indistinguishable from absent;
 * - revoked session  → 401 even though the cookie still parses;
 * - non-admin role   → 403 FORBIDDEN on admin-only commands;
 * - in-scope read    → ok:true for an authorized role (control is positive).
 */

process.env.BETTER_AUTH_URL = 'http://localhost:3000'
// The audit/PDF endpoints resolve their SQL schema explicitly; tests use a
// dedicated schema so they can never touch shared tables.
const schemaName = `boundary_${randomUUID().replaceAll('-', '')}`
process.env.WEYNE_DB_SCHEMA = schemaName

const base = new URL(process.env.TEST_DATABASE_URL!)
const dbName = `boundary_db_${randomUUID().replaceAll('-', '')}`
const dbUrl = new URL(base.toString())
dbUrl.pathname = `/${dbName}`
process.env.DATABASE_URL = dbUrl.toString()

let adminClient: postgres.Sql
let client: postgres.Sql

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
 * The carrier service projects operational contact columns (tax_id,
 * contact_name, ...) that exist in deployed databases as a previous-app
 * expand but are not yet part of the canonical baseline. Mirror that shape so
 * the positive-path read exercises real repository SQL.
 */
async function addLegacyCarrierColumns(sql: postgres.Sql): Promise<void> {
  const legacyColumns = [
    'ADD COLUMN IF NOT EXISTS tax_id text',
    'ADD COLUMN IF NOT EXISTS contact_name text',
    'ADD COLUMN IF NOT EXISTS email text',
    'ADD COLUMN IF NOT EXISTS phone text',
    'ADD COLUMN IF NOT EXISTS street_address text',
    'ADD COLUMN IF NOT EXISTS postal_code text',
    'ADD COLUMN IF NOT EXISTS city text',
    'ADD COLUMN IF NOT EXISTS state text',
  ]
  for (const column of legacyColumns) {
    await sql.unsafe(`ALTER TABLE carriers ${column}`)
  }
}

beforeAll(async () => {
  adminClient = postgres(base.toString(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  })
  await adminClient.unsafe(`CREATE DATABASE ${quoteIdentifier(dbName)}`)
  // Migrations hardcode `"public".` qualifiers for cross-table foreign keys,
  // so the canonical objects live in `public`; the audit/PDF endpoints get a
  // dedicated schema via WEYNE_DB_SCHEMA for their raw-SQL paths.
  await adminClient.unsafe(
    `ALTER DATABASE ${quoteIdentifier(dbName)} SET search_path TO public`,
  )

  client = postgres(dbUrl.toString(), {
    max: 2,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  })
  await client.unsafe(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`)
  await applyCanonicalMigrations(client)
  await addLegacyCarrierColumns(client)
})

afterAll(async () => {
  try {
    await client?.end({ timeout: 5 })
  } finally {
    try {
      await adminClient?.unsafe(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(dbName)} WITH (FORCE)`,
      )
    } finally {
      await adminClient?.end({ timeout: 5 })
    }
  }
})

// ---------------------------------------------------------------------------
// Ambient-request binding.
//
// TanStack Start exposes the current HTTP request to server code through two
// process-global AsyncLocalStorages (the event storage and the start-context
// storage), both created lazily under well-known symbols. Binding them around
// a handler invocation reproduces exactly what the framework's own
// `requestHandler` does when a real HTTP request arrives.
// ---------------------------------------------------------------------------

const EVENT_KEY = Symbol.for('tanstack-start:event-storage')
;(globalThis as never as Record<symbol, unknown>)[EVENT_KEY] ??=
  new AsyncLocalStorage()
const START_KEY = Symbol.for('tanstack-start:start-storage-context')
;(globalThis as never as Record<symbol, unknown>)[START_KEY] ??=
  new AsyncLocalStorage()

type RunFn = (context: unknown, fn: () => Promise<unknown>) => Promise<unknown>

async function withRequestCookie<T>(
  cookie: string | null,
  invoke: () => Promise<T>,
): Promise<T> {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  const req = new Request('http://localhost:3000/app', { headers })
  const event = new H3Event(req)

  const storages = globalThis as never as Record<symbol, unknown>
  const eventStorage = storages[EVENT_KEY]
  const startStorage = storages[START_KEY]
  if (
    !(
      typeof eventStorage === 'object' &&
      eventStorage !== null &&
      'run' in eventStorage &&
      typeof eventStorage.run === 'function'
    ) ||
    !(
      typeof startStorage === 'object' &&
      startStorage !== null &&
      'run' in startStorage &&
      typeof startStorage.run === 'function'
    )
  ) {
    throw new Error(
      'TanStack Start request storages are unavailable; the ambient-request binding cannot run',
    )
  }
  const runEvent = eventStorage.run.bind(eventStorage) as RunFn
  const runStart = startStorage.run.bind(startStorage) as RunFn

  return (await runEvent({ h3Event: event }, () =>
    runStart(
      {
        request: req,
        contextAfterGlobalMiddlewares: {},
        executedRequestMiddlewares: new Set(),
        handlerType: 'serverFn',
      },
      async () => invoke(),
    ),
  )) as T
}

/** Imports the compiled split-handler module for a server-function source. */
async function splitHandler(
  sourcePath: string,
  exportName: string,
): Promise<(ctx: unknown) => Promise<unknown>> {
  const mod = (await import(`${sourcePath}?tss-serverfn-split=negative-test`)) as Record<
    string,
    unknown
  >
  const fn = mod[exportName]
  if (typeof fn !== 'function') {
    throw new Error(`split handler not found for ${sourcePath}#${exportName}`)
  }
  return fn as (ctx: unknown) => Promise<unknown>
}

interface PublicResult {
  readonly ok?: boolean
  readonly error?: Readonly<{ code?: string; status?: number }>
}

const GET = (data?: unknown) => ({ data, context: {}, method: 'GET' })

/** The split handler resolves error ENVELOPES; thrown errors mean the
 * middleware chain rejected a genuine failure. Normalize both shapes. */
async function invokeEnvelope(
  handler: (ctx: unknown) => Promise<unknown>,
  ctx: unknown,
): Promise<PublicResult> {
  try {
    return (await handler(ctx)) as PublicResult
  } catch (error) {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? (error as { status?: number }).status
        : undefined
    return { ok: false, error: { code: 'THROWN', status: status ?? 500 } }
  }
}

// ---------------------------------------------------------------------------
// Fixtures: real Better Auth identities per role.
// ---------------------------------------------------------------------------

const PASSWORD = 'senha-de-teste-bem-longa'

async function createAuthInstance() {
  const { createAuth } = await import('@/lib/auth/auth.server')
  const { parseAuthConfig } = await import('@/lib/auth/config.server')
  const drizzle = await import('drizzle-orm/postgres-js')
  const schema = await import('@/lib/db/schema')
  return createAuth(
    drizzle.drizzle(client, { schema }),
    parseAuthConfig({
      BETTER_AUTH_URL: 'http://localhost:3000',
      NODE_ENV: 'development',
    }),
  )
}

async function signIn(
  auth: Awaited<ReturnType<typeof createAuthInstance>>,
  email: string,
): Promise<string> {
  const { AUTH_BASE_PATH } = await import('@/lib/auth/config.server')
  const response = await auth.handler(
    new Request(`http://localhost:3000${AUTH_BASE_PATH}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  )
  expect(response.status).toBe(200)
  for (const header of response.headers.getSetCookie()) {
    if (header.startsWith('better-auth.session_token=')) {
      return header.split(';')[0] ?? ''
    }
  }
  throw new Error('sign-in did not issue a session cookie')
}

it('denies every newly wired boundary with 401 UNAUTHENTICATED when no cookie is presented', async () => {
  const cases: readonly [string, string][] = [
    ['@/features/app/carriers/carrier.functions', 'listCarriers'],
    ['@/features/app/industries/industry.functions', 'createIndustry'],
    ['@/features/app/users/user-management.functions', 'assignUserRole'],
    ['@/features/app/audit/audit-activity.functions', 'getAuditActivity'],
    ['@/lib/settings/settings.functions', 'getBusinessSettings'],
  ]

  for (const [modulePath, exportName] of cases) {
    const handler = await splitHandler(modulePath, exportName)
    const result = await withRequestCookie(null, () =>
      invokeEnvelope(handler, GET()),
    )
    // Either an explicit envelope or a thrown UnauthenticatedError — both
    // carry status 401 and neither leaks which check failed.
    expect(result.error?.status, modulePath).toBe(401)
  }
})

it('treats a forged cookie exactly like a missing one (no enumeration, no leak)', async () => {
  const listCarriers = await splitHandler(
    '@/features/app/carriers/carrier.functions',
    'listCarriers',
  )
  const result = await withRequestCookie(
    'better-auth.session_token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb',
    () => invokeEnvelope(listCarriers, GET()),
  )
  expect(result.error?.status).toBe(401)
})

it('keeps denying with 401 after the backing session row is deleted (revocation)', async () => {
  const auth = await createAuthInstance()
  const { provisionCredentialUser } = await import('@/lib/auth/provisioning.server')
  await provisionCredentialUser(auth, {
    name: 'Operador Revogado',
    email: 'revoked@boundary.test',
    password: PASSWORD,
    role: 'admin',
  })
  const cookie = await signIn(auth, 'revoked@boundary.test')

  // Kill every live session row out from under the perfectly valid cookie.
  await client`DELETE FROM sessions`

  const getBusinessSettings = await splitHandler(
    '@/lib/settings/settings.functions',
    'getBusinessSettings',
  )
  const result = await withRequestCookie(cookie, () =>
    invokeEnvelope(getBusinessSettings, GET()),
  )
  expect(result.error?.status).toBe(401)
})

it('denies non-admin roles with 403 FORBIDDEN on admin-only commands', async () => {
  const auth = await createAuthInstance()
  const { provisionCredentialUser } = await import('@/lib/auth/provisioning.server')

  await provisionCredentialUser(auth, {
    name: 'Operador Representante',
    email: 'rep@boundary.test',
    password: PASSWORD,
    role: 'representative',
  })
  await provisionCredentialUser(auth, {
    name: 'Operador Leitor',
    email: 'reader@boundary.test',
    password: PASSWORD,
    role: 'read_only',
  })

  const repCookie = await signIn(auth, 'rep@boundary.test')
  const readerCookie = await signIn(auth, 'reader@boundary.test')

  const denials: readonly [string, string, string, string][] = [
    [
      '@/features/app/users/user-management.functions',
      'assignUserRole',
      repCookie,
      'representative → users.assignRole',
    ],
    [
      '@/features/app/audit/audit-activity.functions',
      'getAuditActivity',
      repCookie,
      'representative → audit.view',
    ],
    [
      '@/features/app/carriers/carrier.functions',
      'createCarrier',
      readerCookie,
      'read_only → carriers.create',
    ],
    [
      '@/features/app/industries/industry.functions',
      'archiveIndustry',
      readerCookie,
      'read_only → industries.archive',
    ],
  ]

  for (const [modulePath, exportName, cookie, label] of denials) {
    const handler = await splitHandler(modulePath, exportName)
    const result = await withRequestCookie(cookie, () =>
      invokeEnvelope(handler, GET({ id: crypto.randomUUID() })),
    )
    expect(result.error?.status, label).toBe(403)
  }
})

it('lets an authorized role through (the control is capability-based, not broken)', async () => {
  const auth = await createAuthInstance()
  const { provisionCredentialUser } = await import('@/lib/auth/provisioning.server')
  await provisionCredentialUser(auth, {
    name: 'Operador Leitor Dois',
    email: 'reader2@boundary.test',
    password: PASSWORD,
    role: 'read_only',
  })
  const cookie = await signIn(auth, 'reader2@boundary.test')

  const listCarriers = await splitHandler(
    '@/features/app/carriers/carrier.functions',
    'listCarriers',
  )
  const result = await withRequestCookie(cookie, () =>
    invokeEnvelope(listCarriers, GET({})),
  )
  // The split handler resolves the ENVELOPE for failures; a successful read
  // resolves the payload directly (undefined here would mean the handler
  // shape changed and this contract is stale).
  expect(
    result?.ok,
    `expected carriers read to succeed, got: ${JSON.stringify(result)}`,
  ).toBe(true)
})
