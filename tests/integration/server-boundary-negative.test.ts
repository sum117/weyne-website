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
  await sql`
    CREATE TABLE IF NOT EXISTS carrier_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      actor_role text NOT NULL CHECK (actor_role IN ('admin', 'representative', 'read_only')),
      carrier_id uuid NOT NULL REFERENCES carriers(id) ON DELETE RESTRICT,
      action text NOT NULL CHECK (action IN ('carrier.create', 'carrier.update', 'carrier.archive')),
      occurred_at timestamptz NOT NULL DEFAULT now(),
      metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object')
    )
  `
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
  readonly error?: Readonly<{ code?: string; status?: number; message?: string }>
}

const GET = (data?: unknown) => ({ data, context: {}, method: 'GET' })
const POST = (data?: unknown) => ({ data, context: {}, method: 'POST' })

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

it('denies every protected server-function boundary with 401 before payload processing', async () => {
  const id = '019c6d9a-3d70-7f51-a273-8ca76ff952bc'
  const dateFilters = {
    from: '2026-01-01',
    to: '2026-12-31',
    statuses: [] as string[],
    representativeIds: [] as string[],
  }
  const quotePdfIdentity = {
    quoteId: id,
    snapshotId: id,
    snapshotVersion: 1,
    templateId: id,
    templateVersion: 1,
  }
  const cases: readonly Readonly<{
    modulePath: string
    exportName: string
    data?: unknown
  }>[] = [
    // Master data and user/settings administration.
    { modulePath: '@/features/app/carriers/carrier.functions', exportName: 'listCarriers' },
    { modulePath: '@/features/app/carriers/carrier.functions', exportName: 'getCarrierDetail', data: { id } },
    { modulePath: '@/features/app/carriers/carrier.functions', exportName: 'resolveActiveCarrier', data: { id } },
    { modulePath: '@/features/app/carriers/carrier.functions', exportName: 'createCarrier', data: {} },
    { modulePath: '@/features/app/carriers/carrier.functions', exportName: 'updateCarrier', data: { id } },
    { modulePath: '@/features/app/carriers/carrier.functions', exportName: 'archiveCarrier', data: { id } },
    { modulePath: '@/features/app/industries/industry.functions', exportName: 'createIndustry', data: {} },
    { modulePath: '@/features/app/industries/industry.functions', exportName: 'updateIndustry', data: { id } },
    { modulePath: '@/features/app/industries/industry.functions', exportName: 'archiveIndustry', data: { id } },
    { modulePath: '@/features/app/users/user-management.functions', exportName: 'listManagedUsers' },
    { modulePath: '@/features/app/users/user-management.functions', exportName: 'getManagedUser', data: { id } },
    { modulePath: '@/features/app/users/user-management.functions', exportName: 'assignUserRole', data: { id } },
    { modulePath: '@/features/app/users/user-management.functions', exportName: 'setUserActive', data: { id } },
    { modulePath: '@/features/app/users/user-management.functions', exportName: 'revokeUserSessions', data: { id } },
    { modulePath: '@/lib/settings/settings.functions', exportName: 'getBusinessSettings' },
    { modulePath: '@/lib/settings/settings.functions', exportName: 'updateBusinessSettings', data: {} },
    { modulePath: '@/lib/settings/document-logo.functions', exportName: 'initiateDocumentLogoUpload', data: {} },
    { modulePath: '@/lib/settings/document-logo.functions', exportName: 'finalizeDocumentLogoUpload', data: { assetId: id } },
    { modulePath: '@/lib/settings/document-logo.functions', exportName: 'activateDocumentLogo', data: { assetId: id, expectedVersion: 1 } },
    { modulePath: '@/lib/settings/document-logo.functions', exportName: 'previewDocumentLogo', data: { assetId: id } },
    { modulePath: '@/lib/settings/document-logo.functions', exportName: 'purgeAbandonedDocumentLogos' },
    { modulePath: '@/features/app/audit/audit-activity.functions', exportName: 'getAuditActivity' },

    // Commercial reads, attachments, PDF variants, report views, and Phase-1 exports.
    { modulePath: '@/features/app/orders/order.functions', exportName: 'listOrders', data: {} },
    { modulePath: '@/features/app/orders/order.functions', exportName: 'getOrderDetail', data: { id } },
    { modulePath: '@/features/app/orders/order-attachment.functions', exportName: 'listOrderAttachments', data: { orderId: id } },
    { modulePath: '@/features/app/orders/order-attachment.functions', exportName: 'uploadOrderAttachment', data: { orderId: id } },
    { modulePath: '@/features/app/orders/order-attachment.functions', exportName: 'downloadOrderAttachment', data: { orderId: id, attachmentId: id } },
    { modulePath: '@/features/app/orders/order-attachment.functions', exportName: 'deleteOrderAttachment', data: { orderId: id, attachmentId: id } },
    { modulePath: '@/features/app/quotes/quote-pdf.functions', exportName: 'requestQuotePdfGeneration', data: { identity: quotePdfIdentity } },
    { modulePath: '@/features/app/quotes/quote-pdf.functions', exportName: 'pollQuotePdfStatus', data: { identity: quotePdfIdentity } },
    { modulePath: '@/features/app/quotes/quote-pdf.functions', exportName: 'previewQuotePdf', data: { identity: quotePdfIdentity } },
    { modulePath: '@/features/app/quotes/quote-pdf.functions', exportName: 'downloadQuotePdf', data: { identity: quotePdfIdentity } },
    { modulePath: '@/features/app/reports/report.functions', exportName: 'loadReportPage', data: { grouping: 'clientes', offset: 0, limit: 1, sort: null, filters: dateFilters } },
    { modulePath: '@/features/app/reports/commission-report.functions', exportName: 'getCommissionReport', data: {} },
    { modulePath: '@/features/app/reports/report-export.functions', exportName: 'exportSalesReport', data: { reportId: 'clientes', filters: dateFilters } },
    { modulePath: '@/features/app/reports/report-export.functions', exportName: 'exportCommissionsReport', data: { sort: null, filters: dateFilters } },
  ]

  for (const { modulePath, exportName, data } of cases) {
    const handler = await splitHandler(modulePath, exportName)
    const result = await withRequestCookie(null, () =>
      invokeEnvelope(handler, GET(data)),
    )
    // This invokes the production split handler rather than a component or
    // service seam. Payloads deliberately resemble direct-ID and alternate
    // action attempts, proving no handler parses/loads sensitive state first.
    // Some older Start split handlers surface UnauthenticatedError as a
    // thrown response rather than serializing an envelope. The observable
    // HTTP contract is still exactly the safe 401 status; neither form
    // reveals whether the direct ID/action exists or was otherwise valid.
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

it('lets an authorized role mutate through the real split-handler boundary', async () => {
  const auth = await createAuthInstance()
  const { provisionCredentialUser } = await import('@/lib/auth/provisioning.server')
  await provisionCredentialUser(auth, {
    name: 'Operador Administrador Dois',
    email: 'admin2@boundary.test',
    password: PASSWORD,
    role: 'admin',
  })
  const cookie = await signIn(auth, 'admin2@boundary.test')

  const createCarrier = await splitHandler(
    '@/features/app/carriers/carrier.functions',
    'createCarrier',
  )
  const result = await withRequestCookie(cookie, () =>
    invokeEnvelope(createCarrier, POST({ name: 'Transportadora Controle Positivo' })),
  )
  expect(result?.error?.status).toBeUndefined()

  // The split-handler success payload is framework-private in this runtime;
  // the persisted row is the positive control proving the real handler ran
  // with the authenticated cookie, ambient request binding, and authorization.
  const rows = await client<{ name: string }[]>`
    SELECT name FROM carriers WHERE name = 'Transportadora Controle Positivo'
  `
  expect(rows).toEqual([{ name: 'Transportadora Controle Positivo' }])
})
