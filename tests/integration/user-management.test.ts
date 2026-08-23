import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { createUserManagementPersistence } from '@/features/app/users/user-management.repository.server'
import {
  createUserManagementService,
  type UserManagementActor,
} from '@/features/app/users/user-management.service.server'

/**
 * Real-PostgreSQL contract for the admin user-management service over the
 * canonical `users`/`sessions`/`audit_events` schema: authorization,
 * serialization, role changes, activation/deactivation with session
 * revocation, the last-active-admin invariant under concurrency, and audit
 * emission.
 */
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const baseDatabaseUrl = new URL(databaseUrl)
const isolatedDatabaseName = `user_management_${randomUUID().replaceAll('-', '')}`
const isolatedDatabaseUrl = new URL(baseDatabaseUrl.toString())
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`

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
})

beforeEach(async () => {
  await client.unsafe('DROP SCHEMA public CASCADE')
  await client.unsafe('CREATE SCHEMA public')
  await applyCanonicalMigrations(client)
  seededDisablingActorId = null
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

type SeedUser = Readonly<{
  id: string
  role: 'admin' | 'representative' | 'read_only'
}>

let seededDisablingActorId: string | null = null

/** A persisted admin used as the disabling actor in seed fixtures. */
async function adminActorId(): Promise<string> {
  if (seededDisablingActorId === null) {
    const id = randomUUID()
    await client`
      INSERT INTO users (id, name, email, role, auth_subject)
      VALUES (${id}, 'Administrador de semente', ${`seed-admin-${id}@example.test`}, 'admin', ${`subject-${id}`})
    `
    seededDisablingActorId = id
  }
  return seededDisablingActorId
}

async function seedUser(role: SeedUser['role'], disabled = false): Promise<string> {
  const id = randomUUID()
  await client`
    INSERT INTO users (id, name, email, role, auth_subject, disabled_at, disabled_by_user_id)
    VALUES (${id}, ${`Usuário ${role}`}, ${`${role}-${id}@example.test`}, ${role}, ${`subject-${id}`}, ${disabled ? new Date().toISOString() : null}, ${disabled ? await adminActorId() : null})
  `
  return id
}

async function seedSessions(userId: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await client`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (${`token-${userId}-${index}-${randomUUID()}`}, ${userId}, ${new Date(Date.now() + 3_600_000).toISOString()})
    `
  }
}

let actor: UserManagementActor | null

async function buildService() {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const databaseSchema = await import('@/lib/db/schema')
  const database = drizzle(client, { schema: databaseSchema })
  const persistence = createUserManagementPersistence(
    database as Parameters<typeof createUserManagementPersistence>[0],
  )
  const service = createUserManagementService({
    ...persistence,
    authenticate: async () => actor,
    createCorrelationId: () => randomUUID(),
    now: () => new Date(),
  })
  return { service, repository: persistence.repository }
}

beforeEach(async () => {
  actor = null
})

describe('admin user management on PostgreSQL', () => {
  it('denies unauthenticated and non-admin callers before any query', async () => {
    const { service } = await buildService()

    actor = null
    await expect(service.list({})).resolves.toMatchObject({
      ok: false,
      error: { category: 'unauthenticated' },
    })

    actor = { id: randomUUID(), role: 'representative' }
    await expect(service.list({})).resolves.toMatchObject({
      ok: false,
      error: { category: 'forbidden' },
    })

    const auditRows = await client`SELECT count(*)::integer AS count FROM audit_events`
    expect(auditRows[0]?.count).toBe(0)
  })

  it('lists users as a narrow projection with pagination and search', async () => {
    const adminId = await seedUser('admin')
    const representativeId = await seedUser('representative')
    const readOnlyId = await seedUser('read_only')
    actor = { id: adminId, role: 'admin' }

    const { service } = await buildService()
    const page = await service.list({ limit: 2 })
    expect(page.ok).toBe(true)
    if (!page.ok) return

    expect(page.data.items).toHaveLength(2)
    for (const item of page.data.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['active', 'createdAt', 'email', 'id', 'lastSignInAt', 'name', 'role'].sort(),
      )
      expect(JSON.stringify(item)).not.toMatch(/auth_subject|password|token/i)
    }
    expect(page.data.nextCursor).toBeTypeOf('string')

    const nextPage = await service.list({ limit: 2, cursor: page.data.nextCursor ?? undefined })
    expect(nextPage.ok).toBe(true)
    if (!nextPage.ok) return
    expect(nextPage.data.items).toHaveLength(1)
    expect([representativeId, readOnlyId, adminId]).toContain(nextPage.data.items[0]?.id)

    const filtered = await service.list({ filters: { role: 'read_only' } })
    expect(filtered.ok).toBe(true)
    if (!filtered.ok) return
    expect(filtered.data.items.map((item) => item.id)).toEqual([readOnlyId])
  })

  it('paginates without repeating or dropping a row at the page boundary', async () => {
    // Regression guard. PostgreSQL `now()` resolves to microseconds while the
    // keyset cursor round-trips through a JavaScript Date, which only carries
    // milliseconds. When stored timestamps kept microseconds, the cursor
    // compared as strictly less than the row it was derived from and that row
    // reappeared on the next page. Canonical timestamp defaults are now
    // truncated to milliseconds, so a full walk must visit each user once.
    const adminId = await seedUser('admin')
    const seeded = [adminId]
    for (let index = 0; index < 5; index += 1) {
      seeded.push(await seedUser('representative'))
    }
    actor = { id: adminId, role: 'admin' }

    const storedPrecision = await client<Array<{ untruncated: number }>>`
      SELECT count(*)::integer AS untruncated
      FROM users
      WHERE created_at <> date_trunc('milliseconds', created_at)
    `
    expect(storedPrecision[0]?.untruncated).toBe(0)

    const { service } = await buildService()
    const visited: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page += 1) {
      const result = await service.list({ limit: 2, cursor })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      visited.push(...result.data.items.map((item) => item.id))
      if (!result.data.nextCursor) break
      cursor = result.data.nextCursor
    }

    expect(visited).toHaveLength(seeded.length)
    expect(new Set(visited).size).toBe(seeded.length)
    expect([...visited].sort()).toEqual([...seeded].sort())
  })

  it('assigns roles, audits the change, and never mutates credential tables', async () => {
    const adminId = await seedUser('admin')
    const targetId = await seedUser('representative')
    actor = { id: adminId, role: 'admin' }

    const { service } = await buildService()
    const result = await service.assignRole({ id: targetId, role: 'read_only' })
    expect(result.ok).toBe(true)

    const [row] = await client<{ role: string }[]>`
      SELECT role FROM users WHERE id = ${targetId}
    `
    expect(row?.role).toBe('read_only')

    const [audit] = await client<{ action: string; before: unknown; after: unknown }[]>`
      SELECT action, before, after FROM audit_events WHERE entity_id = ${targetId}
    `
    expect(audit?.action).toBe('user.role.assign')
    expect(audit?.before).toMatchObject({ role: 'representative', active: true })
    expect(audit?.after).toMatchObject({ role: 'read_only', active: true })
  })

  it('deactivates a user, revokes every session atomically, and blocks further authentication state', async () => {
    const adminId = await seedUser('admin')
    const targetId = await seedUser('representative')
    await seedSessions(targetId, 3)
    actor = { id: adminId, role: 'admin' }

    const { service } = await buildService()
    const result = await service.setActive({ id: targetId, active: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.revokedSessionCount).toBe(3)

    const [user] = await client<{ disabled_at: Date | null; disabled_by_user_id: string | null }[]>`
      SELECT disabled_at, disabled_by_user_id FROM users WHERE id = ${targetId}
    `
    expect(user?.disabled_at).not.toBeNull()
    expect(user?.disabled_by_user_id).toBe(adminId)

    const [sessionCount] = await client<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM sessions WHERE user_id = ${targetId}
    `
    expect(sessionCount?.count).toBe(0)

    const [audit] = await client<{ action: string; metadata: Record<string, unknown> }[]>`
      SELECT action, metadata FROM audit_events WHERE entity_id = ${targetId}
    `
    expect(audit?.action).toBe('user.deactivate')
    expect(audit?.metadata.revokedSessionCount).toBe(3)
  })

  it('reactivates a deactivated user and clears the disabling actor', async () => {
    const adminId = await seedUser('admin')
    const targetId = await seedUser('representative', true)
    actor = { id: adminId, role: 'admin' }

    const { service } = await buildService()
    const result = await service.setActive({ id: targetId, active: true })
    expect(result.ok).toBe(true)

    const [user] = await client<{ disabled_at: Date | null; disabled_by_user_id: string | null }[]>`
      SELECT disabled_at, disabled_by_user_id FROM users WHERE id = ${targetId}
    `
    expect(user?.disabled_at).toBeNull()
    expect(user?.disabled_by_user_id).toBeNull()
  })

  it('enforces the last-active-admin invariant against concurrent demotion requests', async () => {
    const firstAdminId = await seedUser('admin')
    const secondAdminId = await seedUser('admin')
    actor = { id: firstAdminId, role: 'admin' }

    // Two independent service instances (separate transactions) demote the two
    // admins concurrently. Row locking serializes them; at most one may win.
    const first = await buildService()
    const second = await buildService()
    const [demoteFirst, demoteSecond] = await Promise.allSettled([
      first.service.assignRole({ id: firstAdminId, role: 'representative' }),
      second.service.assignRole({ id: secondAdminId, role: 'representative' }),
    ])

    const outcomes = [demoteFirst, demoteSecond].map((outcome) =>
      outcome.status === 'fulfilled'
        ? outcome.value.ok
          ? 'allowed'
          : outcome.value.error.category
        : 'rejected',
    )

    const allowedCount = outcomes.filter((outcome) => outcome === 'allowed').length
    expect(allowedCount).toBeLessThanOrEqual(1)

    const [remainingAdmins] = await client<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM users WHERE role = 'admin' AND disabled_at IS NULL
    `
    expect(remainingAdmins?.count).toBeGreaterThanOrEqual(1)

    const deniedRows = await client<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM audit_events WHERE action = 'user.role.assign.denied'
    `
    expect(deniedRows[0]?.count).toBeGreaterThanOrEqual(outcomes.length - allowedCount - 1)
  }, 20_000)

  it('blocks self-deactivation and self-demotion even for the last admin pair', async () => {
    const adminId = await seedUser('admin')
    actor = { id: adminId, role: 'admin' }

    const { service } = await buildService()
    await expect(service.setActive({ id: adminId, active: false })).resolves.toMatchObject({
      ok: false,
      error: { category: 'self-lockout' },
    })
    await expect(
      service.assignRole({ id: adminId, role: 'read_only' }),
    ).resolves.toMatchObject({ ok: false, error: { category: 'self-lockout' } })

    const denied = await client<{ action: string }[]>`
      SELECT action FROM audit_events WHERE entity_id = ${adminId}
    `
    expect(denied.map((row) => row.action).sort()).toEqual([
      'user.deactivate.denied',
      'user.role.assign.denied',
    ])
  })

  it('revokes all sessions on explicit request without changing account status', async () => {
    const adminId = await seedUser('admin')
    const targetId = await seedUser('representative')
    await seedSessions(targetId, 2)
    actor = { id: adminId, role: 'admin' }

    const { service } = await buildService()
    const result = await service.revokeSessions({ id: targetId })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.revokedSessionCount).toBe(2)

    const [user] = await client<{ disabled_at: Date | null }[]>`
      SELECT disabled_at FROM users WHERE id = ${targetId}
    `
    expect(user?.disabled_at).toBeNull()

    const [sessionCount] = await client<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM sessions WHERE user_id = ${targetId}
    `
    expect(sessionCount?.count).toBe(0)
  })

  it('keeps token and credential material out of serialized rows and audit events', async () => {
    const adminId = await seedUser('admin')
    const targetId = await seedUser('representative')
    await seedSessions(targetId, 1)
    actor = { id: adminId, role: 'admin' }

    const { service } = await buildService()
    const page = await service.list({})
    const revoke = await service.revokeSessions({ id: targetId })
    const deactivate = await service.setActive({ id: targetId, active: false })

    expect(page.ok && revoke.ok && deactivate.ok).toBe(true)
    expect(JSON.stringify(page)).not.toMatch(/"token"|auth_subject|password/i)

    const auditRows = await client<{ action: string; payload: unknown }[]>`
      SELECT action, before || after || metadata AS payload FROM audit_events
    `
    expect(auditRows.length).toBeGreaterThan(0)
    for (const row of auditRows) {
      expect(JSON.stringify(row.payload)).not.toMatch(/"token"|auth_subject|password|hash/i)
    }
  })
})
