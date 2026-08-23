import { logUnexpectedError } from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import { createUserManagementPersistence } from '@/features/app/users/user-management.repository.server'
import { getAppSession } from '@/lib/auth/session.server'
import {
  createUserManagementService,
  type UserManagementServiceContract,
  type UserManagementServiceError,
  type UserManagementServiceResult,
} from '@/features/app/users/user-management.service.server'
import { getDatabase } from '@/lib/db/database.server'
import type { Result } from '@/lib/domain/result'

/**
 * Admin-only user-management server functions for
 * `/app/configuracoes/usuarios`. Every operation re-authorizes on the server
 * (fail closed): no session resolves to `UNAUTHENTICATED` (401) and any
 * non-admin role resolves to an explicit `FORBIDDEN` (403) before the service
 * or repository is reached. The UI never decides authorization.
 *
 * Authentication fails closed until the authenticated app session adapter is
 * connected, matching order/carrier/report functions. The full composition
 * below is exercised by tests and becomes live the moment `authenticate`
 * resolves a real actor.
 */

export type { UserManagementServiceContract } from '@/features/app/users/user-management.service.server'

export type UserManagementPublicError =
  | Readonly<{
      code: 'VALIDATION_FAILED'
      status: 400
      message: 'Os dados informados são inválidos.'
      issues: readonly Readonly<{ path: readonly (string | number)[]; message: string }>[]
    }>
  | Readonly<{ code: 'UNAUTHENTICATED'; status: 401; message: 'Autenticação necessária.' }>
  | Readonly<{
      code: 'FORBIDDEN'
      status: 403
      message: 'Apenas administradores podem gerenciar usuários.'
    }>
  | Readonly<{ code: 'NOT_FOUND'; status: 404; message: 'Usuário não encontrado.' }>
  | Readonly<{
      code: 'SELF_LOCKOUT'
      status: 409
      message: 'Esta operação removeria seu próprio acesso de administrador.'
    }>
  | Readonly<{
      code: 'LAST_ACTIVE_ADMIN'
      status: 409
      message: 'É necessário manter pelo menos um administrador ativo.'
    }>
  | Readonly<{ code: 'INTERNAL_ERROR'; status: 500; message: 'Não foi possível concluir a operação.' }>

export type UserManagementPublicResult<T> = Result<T, UserManagementPublicError>

function toPublicError(error: UserManagementServiceError): UserManagementPublicError {
  switch (error.category) {
    case 'validation':
      return {
        code: 'VALIDATION_FAILED',
        status: 400,
        message: 'Os dados informados são inválidos.',
        issues: error.issues.map(({ path, message }) => ({ path, message })),
      }
    case 'unauthenticated':
      return {
        code: 'UNAUTHENTICATED',
        status: 401,
        message: 'Autenticação necessária.',
      }
    case 'forbidden':
      return {
        code: 'FORBIDDEN',
        status: 403,
        message: 'Apenas administradores podem gerenciar usuários.',
      }
    case 'not-found':
      return { code: 'NOT_FOUND', status: 404, message: 'Usuário não encontrado.' }
    case 'conflict':
      return {
        code: 'LAST_ACTIVE_ADMIN',
        status: 409,
        message: 'É necessário manter pelo menos um administrador ativo.',
      }
    case 'self-lockout':
      return {
        code: 'SELF_LOCKOUT',
        status: 409,
        message: 'Esta operação removeria seu próprio acesso de administrador.',
      }
    case 'last-admin':
      return {
        code: 'LAST_ACTIVE_ADMIN',
        status: 409,
        message: 'É necessário manter pelo menos um administrador ativo.',
      }
    case 'unexpected':
      return {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Não foi possível concluir a operação.',
      }
  }
}

function publicResult<T>(
  result: UserManagementServiceResult<T>,
  logUnexpectedError: (cause: unknown) => void,
): UserManagementPublicResult<T> {
  if (!result.ok && result.error.category === 'unexpected') {
    logUnexpectedError(result.error.cause)
  }
  return result.ok ? result : { ok: false, error: toPublicError(result.error) }
}

export function createUserManagementOperations(dependencies: Readonly<{
  getService: () => Promise<UserManagementServiceContract>
  logUnexpectedError: (cause: unknown) => void
}>) {
  const invoke = async <T>(
    operation: (
      service: UserManagementServiceContract,
    ) => Promise<UserManagementServiceResult<T>>,
  ): Promise<UserManagementPublicResult<T>> => {
    try {
      const service = await dependencies.getService()
      return publicResult(await operation(service), dependencies.logUnexpectedError)
    } catch (cause) {
      dependencies.logUnexpectedError(cause)
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          status: 500,
          message: 'Não foi possível concluir a operação.',
        },
      }
    }
  }

  return Object.freeze({
    list: (input: unknown) => invoke((service) => service.list(input)),
    getUser: (input: unknown) => invoke((service) => service.getUser(input)),
    assignRole: (input: unknown) => invoke((service) => service.assignRole(input)),
    setActive: (input: unknown) => invoke((service) => service.setActive(input)),
    revokeSessions: (input: unknown) => invoke((service) => service.revokeSessions(input)),
  })
}

async function getUserManagementService(): Promise<UserManagementServiceContract> {
  const database = await getDatabase()
  const persistence = createUserManagementPersistence(database)
  return createUserManagementService({
    ...persistence,
    // The actor is re-derived from the Better Auth request cookie on every
    // call; the service denies any non-admin before the repository is
    // reached, so a forged payload can never supply an identity.
    authenticate: async () => {
      const session = await getAppSession()
      return session ? { id: session.user.id, role: session.user.role } : null
    },
    createCorrelationId: () => crypto.randomUUID(),
    now: () => new Date(),
  })
}

const userManagementOperations = createUserManagementOperations({
  getService: getUserManagementService,
  logUnexpectedError: (cause) => {
    logUnexpectedError('user.management', cause)
  },
})

const acceptUnknownInput = (input: unknown) => input

export const listManagedUsers = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => userManagementOperations.list(data))

export const getManagedUser = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => userManagementOperations.getUser(data))

export const assignUserRole = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => userManagementOperations.assignRole(data))

export const setUserActive = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => userManagementOperations.setActive(data))

export const revokeUserSessions = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => userManagementOperations.revokeSessions(data))
