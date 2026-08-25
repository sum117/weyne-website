import { z } from 'zod'
import {
  failure,
  notFound,
  success,
  unexpected,
  validationFailure,
  type ApplicationError,
  type Result,
} from '@/lib/domain/result'
import { parseRequest } from '@/lib/server/request.schema'
import { serializeDate, serializeNullableDate } from '@/lib/server/serialization'
import { hasCapability, type Capability, type Role } from '@/lib/auth/capabilities'
import type {
  ManagedUser,
  ManagedUserListItem,
  ManagedUserMutationResult,
  ManagedUserPage,
} from './user-management'
import {
  assignUserRoleRequestSchema,
  listManagedUsersRequestSchema,
  managedUserIdRequestSchema,
  setUserActiveRequestSchema,
  type UserManagementRole,
} from './user-management.schema'

/**
 * Admin-only user management over the canonical `users`/`sessions` tables.
 *
 * Every operation re-authenticates at this boundary (fail closed) and denies
 * any non-admin role with an explicit forbidden result before touching the
 * repository. Mutations run inside one transaction that also appends a
 * structured `audit_events` row; deactivation revokes every live session for
 * the target in the same transaction, so a deactivated account can neither
 * keep nor start an authenticated session.
 *
 * Response DTOs are narrow projections (`user-management.ts`) and never
 * include Better Auth credential material: password hashes, session tokens,
 * reset/bootstrap tokens, or `auth_subject`.
 */

export type UserManagementActor = Readonly<{
  id: string
  role: Role
}>

export type UserManagementAuditEvent = Readonly<{
  actorId: string
  actorRole: 'admin' | 'representative' | 'read_only'
  action:
    | 'user.role.assign'
    | 'user.activate'
    | 'user.deactivate'
    | 'user.sessions.revoke'
    | 'user.role.assign.denied'
    | 'user.activate.denied'
    | 'user.deactivate.denied'
    | 'user.sessions.revoke.denied'
  targetUserId: string
  occurredAt: string
  before: Readonly<{ role: UserManagementRole; active: boolean }> | null
  after: Readonly<{ role: UserManagementRole; active: boolean }> | null
  metadata: Readonly<{ revokedSessionCount?: number; reason: string }>
}>

export type UserManagementRepository = Readonly<{
  findUserStateById: (
    id: string,
  ) => Promise<Readonly<{ id: string; role: UserManagementRole; disabledAt: Date | null }> | null>
  findUserDetailById: (
    id: string,
  ) => Promise<Readonly<{
    id: string
    name: string
    email: string
    role: UserManagementRole
    disabledAt: Date | null
    createdAt: Date
  }> | null>
  countActiveAdminsExcluding: (id: string) => Promise<number>
  listUsers: (query: {
    limit: number
    cursor: Readonly<{ createdAt: string; id: string }> | null
    filters: { search?: string; role?: UserManagementRole; active?: boolean }
  }) => Promise<readonly ManagedUserListItem[]>
  setRole: (id: string, role: UserManagementRole, actorId: string, now: Date) => Promise<void>
  setActive: (
    id: string,
    active: boolean,
    actorId: string,
    now: Date,
  ) => Promise<Readonly<{ revokedSessionCount: number }>>
  revokeAllSessions: (id: string) => Promise<Readonly<{ revokedSessionCount: number }>>
  appendAudit: (event: UserManagementAuditEvent) => Promise<void>
}>

export type UserManagementUnitOfWork = Readonly<{
  transaction: <T>(
    work: (repository: UserManagementRepository) => Promise<T>,
  ) => Promise<T>
}>

export type UserManagementServiceError =
  | ApplicationError
  | Readonly<{ category: 'unauthenticated' }>
  | Readonly<{ category: 'forbidden' }>
  | Readonly<{ category: 'self-lockout' }>
  | Readonly<{ category: 'last-admin' }>

export type UserManagementServiceResult<T> = Result<T, UserManagementServiceError>

export type UserManagementServiceContract = Readonly<{
  list: (input: unknown) => Promise<UserManagementServiceResult<ManagedUserPage>>
  getUser: (input: unknown) => Promise<UserManagementServiceResult<ManagedUser>>
  assignRole: (input: unknown) => Promise<UserManagementServiceResult<ManagedUserMutationResult>>
  setActive: (input: unknown) => Promise<UserManagementServiceResult<ManagedUserMutationResult>>
  revokeSessions: (input: unknown) => Promise<UserManagementServiceResult<ManagedUserMutationResult>>
}>

type ServiceDependencies = Readonly<{
  authenticate: () => Promise<UserManagementActor | null>
  repository: UserManagementRepository
  unitOfWork: UserManagementUnitOfWork
  createCorrelationId: () => string
  now: () => Date
}>

function userStateSnapshot(user: {
  role: UserManagementRole
  disabledAt: Date | null
}): Readonly<{ role: UserManagementRole; active: boolean }> {
  return Object.freeze({ role: user.role, active: user.disabledAt === null })
}

function auditEvent(
  actor: UserManagementActor,
  action: UserManagementAuditEvent['action'],
  targetUserId: string,
  occurredAt: Date,
  before: Readonly<{ role: UserManagementRole; active: boolean }> | null,
  after: Readonly<{ role: UserManagementRole; active: boolean }> | null,
  metadata: Readonly<{ revokedSessionCount?: number; reason: string }>,
): UserManagementAuditEvent {
  return Object.freeze({
    actorId: actor.id,
    actorRole: actor.role,
    action,
    targetUserId,
    occurredAt: occurredAt.toISOString(),
    before: before === null ? null : Object.freeze({ ...before }),
    after: after === null ? null : Object.freeze({ ...after }),
    metadata: Object.freeze({ ...metadata }),
  })
}

export function createUserManagementService(
  dependencies: ServiceDependencies,
): UserManagementServiceContract {
  async function authorizeAdmin(capability: Capability): Promise<
    Result<UserManagementActor, UserManagementServiceError>
  > {
    const actor = await dependencies.authenticate()
    if (!actor) return failure({ category: 'unauthenticated' as const })
    if (!hasCapability(actor.role, capability)) return failure({ category: 'forbidden' as const })
    return success(actor)
  }

  async function safely<T>(
    work: () => Promise<UserManagementServiceResult<T>>,
  ): Promise<UserManagementServiceResult<T>> {
    try {
      return await work()
    } catch (cause) {
      return failure(unexpected(cause))
    }
  }

  /**
   * Loads the target inside the caller's transaction with the row locked by
   * the repository (`FOR UPDATE`), then applies the last-active-admin guard.
   * An active administrator is a user whose `role = 'admin'` AND who is not
   * deactivated. The guard runs on the locked row so two concurrent requests
   * serialize: whichever lands second sees the first one's committed state.
   */
  async function loadTargetForMutation(
    repository: UserManagementRepository,
    targetId: string,
  ): Promise<
    Result<
      Readonly<{ id: string; role: UserManagementRole; disabledAt: Date | null }>,
      UserManagementServiceError
    >
  > {
    const target = await repository.findUserStateById(targetId)
    if (target === null) return failure(notFound())
    return success(target)
  }

  async function findUserDetail(
    id: string,
  ): Promise<Readonly<{
    id: string
    name: string
    email: string
    role: UserManagementRole
    disabledAt: Date | null
    createdAt: Date
  }> | null> {
    return dependencies.repository.findUserDetailById(id)
  }

  async function assertNotLastActiveAdmin(
    repository: UserManagementRepository,
    target: Readonly<{ id: string; role: UserManagementRole; disabledAt: Date | null }>,
    next: Readonly<{ role: UserManagementRole; active: boolean }>,
  ): Promise<Result<null, UserManagementServiceError>> {
    const isActiveAdminBefore = target.role === 'admin' && target.disabledAt === null
    const isActiveAdminAfter = next.role === 'admin' && next.active
    if (!isActiveAdminBefore || isActiveAdminAfter) return success(null)

    const remainingActiveAdmins = await repository.countActiveAdminsExcluding(target.id)
    if (remainingActiveAdmins < 1) {
      return failure({
        category: 'last-admin' as const,
      })
    }
    return success(null)
  }

  return Object.freeze({
    async list(input) {
      const actor = await authorizeAdmin('user.update_role')
      if (!actor.ok) return actor
      const request = parseRequest(listManagedUsersRequestSchema, input)
      if (!request.ok) return request

      return safely(async () => {
        let cursor: { createdAt: string; id: string } | null = null
        if (request.data.cursor) {
          try {
            const decoded = JSON.parse(
              Buffer.from(request.data.cursor, 'base64url').toString('utf8'),
            ) as unknown
            const parsed = z
              .strictObject({ createdAt: z.string(), id: z.uuid() })
              .safeParse(decoded)
            if (!parsed.success) {
              return failure(
                validationFailure([{ path: ['cursor'], message: 'Cursor inválido.' }]),
              )
            }
            cursor = parsed.data
          } catch {
            return failure(
              validationFailure([{ path: ['cursor'], message: 'Cursor inválido.' }]),
            )
          }
        }

        const rows = await dependencies.repository.listUsers({
          limit: request.data.limit + 1,
          cursor,
          filters: request.data.filters,
        })
        const pageRows = rows.slice(0, request.data.limit)
        const last = pageRows.at(-1)
        const nextCursor =
          rows.length > request.data.limit && last
            ? Buffer.from(
                JSON.stringify({ createdAt: last.createdAt, id: last.id }),
                'utf8',
              ).toString('base64url')
            : null
        return success({ items: pageRows, nextCursor } satisfies ManagedUserPage)
      })
    },

    async getUser(input) {
      const actor = await authorizeAdmin('user.update_role')
      if (!actor.ok) return actor
      const request = parseRequest(managedUserIdRequestSchema, input)
      if (!request.ok) return request

      return safely(async () => {
        const state = await findUserDetail(request.data.id)
        if (state === null) return failure(notFound())
        // Narrow projection only; the repository never returns credential columns.
        const user: ManagedUser = Object.freeze({
          id: state.id,
          name: state.name,
          email: state.email,
          role: state.role,
          active: state.disabledAt === null,
          createdAt: serializeDate(state.createdAt),
          disabledAt:
            state.disabledAt === null ? null : serializeNullableDate(state.disabledAt),
        })
        return success(user)
      })
    },

    async assignRole(input) {
      const actor = await authorizeAdmin('user.update_role')
      if (!actor.ok) return actor
      const request = parseRequest(assignUserRoleRequestSchema, input)
      if (!request.ok) return request

      return safely(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const target = await loadTargetForMutation(repository, request.data.id)
          if (!target.ok) return target

          const before = userStateSnapshot(target.data)
          const after = Object.freeze({ ...before, role: request.data.role })

          if (target.data.id === actor.data.id && request.data.role !== 'admin') {
            await repository.appendAudit(
              auditEvent(actor.data, 'user.role.assign.denied', target.data.id, dependencies.now(), before, before, {
                reason: 'self-demote',
              }),
            )
            return failure({ category: 'self-lockout' as const })
          }
          const guard = await assertNotLastActiveAdmin(repository, target.data, after)
          if (!guard.ok) {
            await repository.appendAudit(
              auditEvent(actor.data, 'user.role.assign.denied', target.data.id, dependencies.now(), before, before, {
                reason: 'last-active-admin',
              }),
            )
            return guard
          }

          const now = dependencies.now()
          await repository.setRole(target.data.id, request.data.role, actor.data.id, now)
          await repository.appendAudit(
            auditEvent(actor.data, 'user.role.assign', target.data.id, now, before, after, {
              reason: 'role-change',
            }),
          )
          return success({
            user: Object.freeze({
              id: target.data.id,
              name: '',
              email: '',
              role: request.data.role,
              active: before.active,
              createdAt: '',
              disabledAt: before.active ? null : target.data.disabledAt?.toISOString() ?? null,
            }) satisfies ManagedUser,
            revokedSessionCount: null,
          })
        }),
      )
    },

    async setActive(input) {
      const actor = await authorizeAdmin('user.disable')
      if (!actor.ok) return actor
      const request = parseRequest(setUserActiveRequestSchema, input)
      if (!request.ok) return request

      return safely(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const target = await loadTargetForMutation(repository, request.data.id)
          if (!target.ok) return target

          const before = userStateSnapshot(target.data)
          const after = Object.freeze({ ...before, active: request.data.active })

          if (target.data.id === actor.data.id && !request.data.active) {
            await repository.appendAudit(
              auditEvent(actor.data, 'user.deactivate.denied', target.data.id, dependencies.now(), before, before, {
                reason: 'self-deactivate',
              }),
            )
            return failure({ category: 'self-lockout' as const })
          }
          const guard = await assertNotLastActiveAdmin(repository, target.data, after)
          if (!guard.ok) {
            await repository.appendAudit(
              auditEvent(actor.data, 'user.deactivate.denied', target.data.id, dependencies.now(), before, before, {
                reason: 'last-active-admin',
              }),
            )
            return guard
          }

          const now = dependencies.now()
          const outcome = await repository.setActive(
            target.data.id,
            request.data.active,
            actor.data.id,
            now,
          )
          await repository.appendAudit(
            auditEvent(
              actor.data,
              request.data.active ? 'user.activate' : 'user.deactivate',
              target.data.id,
              now,
              before,
              after,
              { revokedSessionCount: outcome.revokedSessionCount, reason: 'account-status' },
            ),
          )
          return success({
            user: Object.freeze({
              id: target.data.id,
              name: '',
              email: '',
              role: before.role,
              active: request.data.active,
              createdAt: '',
              disabledAt: request.data.active ? null : now.toISOString(),
            }) satisfies ManagedUser,
            revokedSessionCount: outcome.revokedSessionCount,
          })
        }),
      )
    },

    async revokeSessions(input) {
      const actor = await authorizeAdmin('user.disable')
      if (!actor.ok) return actor
      const request = parseRequest(managedUserIdRequestSchema, input)
      if (!request.ok) return request

      return safely(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const target = await loadTargetForMutation(repository, request.data.id)
          if (!target.ok) return target

          const before = userStateSnapshot(target.data)
          const now = dependencies.now()
          const outcome = await repository.revokeAllSessions(target.data.id)
          await repository.appendAudit(
            auditEvent(actor.data, 'user.sessions.revoke', target.data.id, now, before, before, {
              revokedSessionCount: outcome.revokedSessionCount,
              reason: 'explicit-revocation',
            }),
          )
          return success({
            user: Object.freeze({
              id: target.data.id,
              name: '',
              email: '',
              role: before.role,
              active: before.active,
              createdAt: '',
              disabledAt: before.active ? null : target.data.disabledAt?.toISOString() ?? null,
            }) satisfies ManagedUser,
            revokedSessionCount: outcome.revokedSessionCount,
          })
        }),
      )
    },
  })
}
