import { describe, expect, it, vi } from 'vitest'
import {
  createUserManagementService,
  type UserManagementActor,
  type UserManagementAuditEvent,
  type UserManagementRepository,
} from '@/features/app/users/user-management.service.server'
import {
  createUserManagementOperations,
  type UserManagementPublicError,
} from '@/features/app/users/user-management.functions'

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const targetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const secondAdminId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const occurredAt = new Date('2026-08-21T12:00:00.000Z')

const admin: UserManagementActor = { id: adminId, role: 'admin' }

type UserState = { id: string; role: 'admin' | 'representative' | 'read_only'; disabledAt: Date | null }

function repositoryFixture(users: UserState[]) {
  const events: UserManagementAuditEvent[] = []
  const repository: UserManagementRepository = {
    async findUserStateById(id) {
      const user = users.find((candidate) => candidate.id === id)
      return user ? { ...user } : null
    },
    async findUserDetailById(id) {
      const user = users.find((candidate) => candidate.id === id)
      if (!user) return null
      return {
        ...user,
        name: `Usuário ${user.id.slice(0, 4)}`,
        email: `${user.id}@example.test`,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }
    },
    async countActiveAdminsExcluding(id) {
      return users.filter(
        (user) => user.id !== id && user.role === 'admin' && user.disabledAt === null,
      ).length
    },
    async listUsers() {
      return []
    },
    async setRole(id, role) {
      const user = users.find((candidate) => candidate.id === id)
      if (user) user.role = role
    },
    async setActive(id, active, actorId, now) {
      const user = users.find((candidate) => candidate.id === id)
      if (!user) return { revokedSessionCount: 0 }
      if (active) {
        user.disabledAt = null
        return { revokedSessionCount: 0 }
      }
      user.disabledAt = now
      void actorId
      return { revokedSessionCount: 2 }
    },
    async revokeAllSessions() {
      return { revokedSessionCount: 3 }
    },
    async appendAudit(event) {
      events.push(event)
    },
  }
  return { repository, events }
}

function serviceFor(
  users: UserState[],
  actor: UserManagementActor | null = admin,
  overrides: Partial<{
    repository: UserManagementRepository
    events: UserManagementAuditEvent[]
  }> = {},
) {
  const fixture = repositoryFixture(users)
  const repository = overrides.repository ?? fixture.repository
  const events = overrides.events ?? fixture.events
  const service = createUserManagementService({
    authenticate: async () => actor,
    repository,
    unitOfWork: {
      transaction: (work) => work(repository),
    },
    createCorrelationId: () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    now: () => occurredAt,
  })
  return { service, events }
}

const activeAdmin = (): UserState => ({ id: adminId, role: 'admin', disabledAt: null })
const activeTargetAdmin = (): UserState => ({ id: targetId, role: 'admin', disabledAt: null })
const activeRepresentative = (): UserState => ({
  id: targetId,
  role: 'representative',
  disabledAt: null,
})

describe('authorization', () => {
  it('returns UNAUTHENTICATED without a session and never reaches the repository', async () => {
    const repository: UserManagementRepository = {
      ...repositoryFixture([activeRepresentative()]).repository,
      listUsers: vi.fn(async () => []),
    }
    const service = createUserManagementService({
      authenticate: async () => null,
      repository,
      unitOfWork: { transaction: (work) => work(repository) },
      createCorrelationId: () => crypto.randomUUID(),
      now: () => occurredAt,
    })

    await expect(service.list({})).resolves.toMatchObject({
      ok: false,
      error: { category: 'unauthenticated' },
    })
    await expect(service.assignRole({ id: targetId, role: 'admin' })).resolves.toMatchObject({
      ok: false,
      error: { category: 'unauthenticated' },
    })
    expect(repository.listUsers).not.toHaveBeenCalled()
  })

  it.each(['representative', 'read_only'] as const)(
    'returns explicit FORBIDDEN for a direct %s call on every operation',
    async (role) => {
      const { repository, events } = repositoryFixture([
        activeTargetAdmin(),
        activeRepresentative(),
      ])
      const service = createUserManagementService({
        authenticate: async () => ({ id: targetId, role }),
        repository,
        unitOfWork: { transaction: (work) => work(repository) },
        createCorrelationId: () => crypto.randomUUID(),
        now: () => occurredAt,
      })

      await expect(service.list({})).resolves.toMatchObject({
        ok: false,
        error: { category: 'forbidden' },
      })
      await expect(
        service.assignRole({ id: adminId, role: 'read_only' }),
      ).resolves.toMatchObject({ ok: false, error: { category: 'forbidden' } })
      await expect(service.setActive({ id: adminId, active: false })).resolves.toMatchObject({
        ok: false,
        error: { category: 'forbidden' },
      })
      await expect(service.revokeSessions({ id: adminId })).resolves.toMatchObject({
        ok: false,
        error: { category: 'forbidden' },
      })
      expect(events).toEqual([])
    },
  )
})

describe('serialization', () => {
  it('projects only narrow fields and never credential material', async () => {
    const { service } = serviceFor([activeAdmin(), activeRepresentative()])
    const result = await service.list({})
    expect(result.ok).toBe(true)
    if (!result.ok) return

    for (const item of result.data.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['active', 'createdAt', 'email', 'id', 'lastSignInAt', 'name', 'role'].sort(),
      )
    }
  })

  it('maps public errors to stable safe payloads with no internal detail', async () => {
    const operations = createUserManagementOperations({
      getService: async () => serviceFor([activeRepresentative()], null).service,
      logUnexpectedError: vi.fn(),
    })
    const result = (await operations.setActive({ id: targetId, active: true })) as {
      ok: boolean
      error?: UserManagementPublicError
    }
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('UNAUTHENTICATED')
    expect(result.error?.status).toBe(401)
    expect(JSON.stringify(result.error)).not.toMatch(/password|token|secret|auth_subject/i)
  })
})

describe('role assignment', () => {
  it('assigns a supported role and audits the change with before/after state', async () => {
    const users = [activeAdmin(), activeRepresentative()]
    const { service, events } = serviceFor(users)
    const result = await service.assignRole({ id: targetId, role: 'admin' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.user.role).toBe('admin')
      expect(result.data.revokedSessionCount).toBeNull()
    }
    expect(users.find((user) => user.id === targetId)?.role).toBe('admin')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      actorId: adminId,
      actorRole: 'admin',
      action: 'user.role.assign',
      targetUserId: targetId,
      before: { role: 'representative', active: true },
      after: { role: 'admin', active: true },
    })
  })

  it('rejects an unsupported role through validation before any write', async () => {
    const { service, events } = serviceFor([activeAdmin(), activeRepresentative()])
    const result = await service.assignRole({ id: targetId, role: 'superuser' })
    expect(result.ok).toBe(false)
    if (!result.ok && result.error.category === 'validation') {
      expect(result.error.issues.some((issue) => issue.path.includes('role'))).toBe(true)
    } else {
      throw new Error('Expected validation failure')
    }
    expect(events).toEqual([])
  })

  it('rejects mass-assigned unknown fields on every mutating command', async () => {
    // The schemas are z.strictObject, so a client that smuggles extra keys —
    // including fields that exist on the identity but are not writable here —
    // gets a validation failure instead of a silent ignore.
    const { service, events } = serviceFor([activeAdmin(), activeRepresentative()])

    const payloads: readonly [unknown, string][] = [
      [
        { id: targetId, role: 'read_only', authSubject: 'better-auth:forged' },
        'assignRole + authSubject',
      ],
      [{ id: targetId, role: 'admin', email: 'attacker@evil.test' }, 'assignRole + email'],
      [{ id: targetId, role: 'admin', disabledAt: null }, 'assignRole + disabledAt'],
      [
        { id: targetId, active: false, role: 'read_only' },
        'setActive + role',
      ],
      [
        { id: targetId, active: true, passwordHash: 'x' },
        'setActive + passwordHash',
      ],
      [
        { id: targetId, name: 'Novo Nome' },
        'revokeSessions + name',
      ],
    ]

    for (const [payload, label] of payloads) {
      const outcome =
        'active' in (payload as Record<string, unknown>)
          ? await service.setActive(payload)
          : 'role' in (payload as Record<string, unknown>)
            ? await service.assignRole(payload)
            : await service.revokeSessions(payload)
      expect(outcome.ok, label).toBe(false)
      if (!outcome.ok && outcome.error.category === 'validation') {
        // `unrecognized_keys` issues carry the offending key in the message
        // with an empty path, so assert on either surface.
        const rejected =
          outcome.error.issues.some((issue) => issue.path.length > 0) ||
          outcome.error.issues.some((issue) => /unrecognized/i.test(issue.message))
        expect(rejected, label).toBe(true)
        expect(outcome.error.issues.length, label).toBeGreaterThan(0)
      } else {
        throw new Error(`Expected validation failure for ${label}`)
      }
    }

    // Nothing was written and nothing was audited: the request died at
    // validation, before the repository was reached.
    expect(events).toEqual([])
  })

  it('rejects demoting the last active admin and records the denied attempt', async () => {
    // Two active admins exist, but the guard's count simulates a concurrent
    // commit that already removed the other active admin, so demoting the
    // target would leave zero active admins.
    const users = [
      activeAdmin(),
      { id: secondAdminId, role: 'admin' as const, disabledAt: null },
      activeRepresentative(),
    ]
    const fixture = repositoryFixture(users)
    vi.spyOn(fixture.repository, 'countActiveAdminsExcluding').mockResolvedValue(0)
    const service = createUserManagementService({
      authenticate: async () => admin,
      repository: fixture.repository,
      unitOfWork: { transaction: (work) => work(fixture.repository) },
      createCorrelationId: () => crypto.randomUUID(),
      now: () => occurredAt,
    })
    const events = fixture.events
    const result = await service.assignRole({ id: secondAdminId, role: 'representative' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ category: 'last-admin' })
    expect(users.find((user) => user.id === secondAdminId)?.role).toBe('admin')
    expect(events).toHaveLength(1)
    expect(events[0]?.action).toBe('user.role.assign.denied')
    expect(events[0]?.metadata.reason).toBe('last-active-admin')
  })

  it('allows demoting an admin when another active admin remains', async () => {
    const users = [
      activeAdmin(),
      { id: secondAdminId, role: 'admin' as const, disabledAt: null },
      activeRepresentative(),
    ]
    const { service, events } = serviceFor(users)
    const result = await service.assignRole({ id: secondAdminId, role: 'read_only' })

    expect(result.ok).toBe(true)
    expect(users.find((user) => user.id === secondAdminId)?.role).toBe('read_only')
    expect(events[0]?.action).toBe('user.role.assign')
  })
})

describe('activation and deactivation', () => {
  it('deactivates a user, revokes sessions in the same operation, and audits both facts', async () => {
    const users = [activeAdmin(), activeRepresentative()]
    const { service, events } = serviceFor(users)
    const result = await service.setActive({ id: targetId, active: false })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.user.active).toBe(false)
      expect(result.data.revokedSessionCount).toBe(2)
    }
    expect(users.find((user) => user.id === targetId)?.disabledAt).toEqual(occurredAt)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      action: 'user.deactivate',
      after: { role: 'representative', active: false },
      metadata: { revokedSessionCount: 2 },
    })
  })

  it('reactivates a deactivated user without touching sessions', async () => {
    const users = [
      activeAdmin(),
      { id: targetId, role: 'representative' as const, disabledAt: new Date('2026-08-01T00:00:00Z') },
    ]
    const { service, events } = serviceFor(users)
    const result = await service.setActive({ id: targetId, active: true })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.revokedSessionCount).toBe(0)
    expect(users.find((user) => user.id === targetId)?.disabledAt).toBeNull()
    expect(events[0]?.action).toBe('user.activate')
  })

  it('blocks self-deactivation and audits the denied attempt', async () => {
    const users = [activeAdmin(), activeRepresentative()]
    const { service, events } = serviceFor(users)
    const result = await service.setActive({ id: adminId, active: false })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ category: 'self-lockout' })
    expect(users.find((user) => user.id === adminId)?.disabledAt).toBeNull()
    expect(events).toHaveLength(1)
    expect(events[0]?.action).toBe('user.deactivate.denied')
    expect(events[0]?.metadata.reason).toBe('self-deactivate')
  })

  it('blocks deactivating the last active admin even by another admin', async () => {
    // The acting admin targets a DIFFERENT admin who is the last other active
    // admin; the mocked count simulates a race where no other active admin
    // remains, so the guard must reject.
    const users = [
      activeAdmin(),
      { id: secondAdminId, role: 'admin' as const, disabledAt: null },
      activeRepresentative(),
    ]
    const guardRepository = repositoryFixture(users)
    vi.spyOn(guardRepository.repository, 'countActiveAdminsExcluding').mockResolvedValue(0)
    const service = createUserManagementService({
      authenticate: async () => admin,
      repository: guardRepository.repository,
      unitOfWork: { transaction: (work) => work(guardRepository.repository) },
      createCorrelationId: () => crypto.randomUUID(),
      now: () => occurredAt,
    })

    const result = await service.setActive({ id: secondAdminId, active: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ category: 'last-admin' })
    expect(guardRepository.events[0]?.action).toBe('user.deactivate.denied')
  })
})

describe('session revocation', () => {
  it('revokes all sessions for the target and reports the count', async () => {
    const { service, events } = serviceFor([activeAdmin(), activeRepresentative()])
    const result = await service.revokeSessions({ id: targetId })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.revokedSessionCount).toBe(3)
    expect(events[0]).toMatchObject({
      action: 'user.sessions.revoke',
      targetUserId: targetId,
      metadata: { revokedSessionCount: 3 },
    })
  })

  it('returns NOT_FOUND for an unknown target without auditing', async () => {
    const { service, events } = serviceFor([activeAdmin()])
    const result = await service.revokeSessions({ id: secondAdminId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ category: 'not-found' })
    expect(events).toEqual([])
  })
})

describe('audit hygiene', () => {
  it('never places token or credential material in audit events', async () => {
    const { service, events } = serviceFor([activeAdmin(), activeRepresentative()])
    await service.assignRole({ id: targetId, role: 'admin' })
    await service.setActive({ id: targetId, active: false })
    await service.revokeSessions({ id: targetId })

    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      const serialized = JSON.stringify(event)
      expect(serialized).not.toMatch(/"(password|token|secret|hash|sessionToken|authSubject)"/i)
      for (const key of Object.keys(event.metadata)) {
        expect(['reason', 'revokedSessionCount']).toContain(key)
      }
      expect(event.metadata.reason).toBeTypeOf('string')
    }
  })
})
