import { logStructuredEvent, logUnexpectedError } from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import { getDatabase } from '@/lib/db/database.server'
import { getAppSession } from '@/lib/auth/session.server'
import type { Result } from '@/lib/domain/result'
import {
  createPostgresSettingsRepository,
} from './settings-repository.server'
import {
  createSettingsService,
  type SettingsActor,
  type SettingsServiceContract,
  type SettingsServiceError,
} from './settings-service.server'
import type { SettingsRecord } from '@/domain/settings/business-settings'

/**
 * Authorized admin endpoints for the canonical business/document settings.
 *
 * Every call re-derives the actor server-side from the Better Auth request
 * cookie (`getAppSession`); authorization is never decided by the client.
 * Authorization decisions consult the centralized RBAC matrix through the
 * settings service, so a non-admin is denied and audited before any payload
 * validation or persistence happens.
 *
 * Settings are sourced from PostgreSQL only. Nothing in this module reads or
 * emits `VITE_*`/public configuration, and issued-document numbering counters
 * are not addressable through these endpoints — the canonical payload schema
 * rejects unknown keys, so counters cannot be smuggled in.
 */

export type SettingsPublicErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'

export type SettingsPublicError =
  | Readonly<{
      code: 'VALIDATION_FAILED'
      status: 400
      issues: readonly Readonly<{ path: readonly (string | number)[]; message: string }>[]
    }>
  | Readonly<{ code: 'UNAUTHENTICATED'; status: 401 }>
  | Readonly<{ code: 'FORBIDDEN'; status: 403 }>
  | Readonly<{ code: 'NOT_FOUND'; status: 404 }>
  | Readonly<{
      code: 'CONFLICT'
      status: 409
      currentRecord: SettingsRecord | null
    }>
  | Readonly<{ code: 'INTERNAL_ERROR'; status: 500 }>

export type SettingsReadResult = Result<SettingsRecord, SettingsPublicError>
export type SettingsUpdateResult = Result<SettingsRecord, SettingsPublicError>

function toPublicError(error: SettingsServiceError): SettingsPublicError {
  switch (error.category) {
    case 'validation':
      return {
        code: 'VALIDATION_FAILED',
        status: 400,
        issues: error.issues.map(({ path, message }) => ({ path, message })),
      }
    case 'unauthenticated':
      return { code: 'UNAUTHENTICATED', status: 401 }
    case 'forbidden':
      return { code: 'FORBIDDEN', status: 403 }
    case 'not-found':
      return { code: 'NOT_FOUND', status: 404 }
    case 'conflict':
      // The current valid record travels back so a client can rebase without
      // losing its own edits; it is the canonical record, safe to expose to an
      // authenticated admin who just failed a stale write.
      return {
        code: 'CONFLICT',
        status: 409,
        currentRecord: error.currentRecord,
      }
    case 'unexpected':
      return { code: 'INTERNAL_ERROR', status: 500 }
  }
}

function publicResult<T>(
  result: Result<T, SettingsServiceError>,
  logUnexpectedError: (cause: unknown) => void,
): Result<T, SettingsPublicError> {
  if (result.ok) return result
  if (result.error.category === 'unexpected') {
    logUnexpectedError(result.error.cause)
  }
  return { ok: false, error: toPublicError(result.error) }
}

export function createSettingsOperations(dependencies: Readonly<{
  getService: () => Promise<SettingsServiceContract>
  logUnexpectedError: (cause: unknown) => void
}>) {
  const invoke = async <T>(
    operation: (service: SettingsServiceContract) => Promise<Result<T, SettingsServiceError>>,
  ): Promise<Result<T, SettingsPublicError>> => {
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
        },
      }
    }
  }

  return Object.freeze({
    read: (actor: SettingsActor | null) =>
      invoke((service) => service.getSettings(actor)),
    update: (actor: SettingsActor | null, input: unknown) =>
      invoke((service) => service.updateSettings(actor, input)),
  })
}

async function getSettingsService(): Promise<SettingsServiceContract> {
  const database = await getDatabase()
  return createSettingsService({
    repository: createPostgresSettingsRepository(database),
    audit: {
      async append(event) {
        // Actor id, action, outcome, changed fields, version, timestamp.
        // No settings values, no contact data, no secrets.
        logStructuredEvent({
          kind: 'audit',
          action: event.action,
          actorId: event.actorId,
          outcome: event.outcome,
          ...(event.changedFields ? { changedFields: event.changedFields } : {}),
          ...(event.version !== undefined ? { version: event.version } : {}),
          ...(event.detail ? { detail: event.detail } : {}),
          occurredAt: event.occurredAt.toISOString(),
        })
      },
    },
    createCorrelationId: () => crypto.randomUUID(),
    now: () => new Date(),
    logUnexpectedError: () => undefined,
  })
}

const settingsOperations = createSettingsOperations({
  getService: getSettingsService,
  logUnexpectedError: (cause) => {
    logUnexpectedError('settings.server', cause)
  },
})

/**
 * Resolves the caller from the request cookie through the Better Auth session
 * adapter. Authorization itself stays in the settings service, which consults
 * the centralized RBAC matrix (`settings.read`/`settings.update` are
 * admin-only) so a denial is audited with the actor who attempted it.
 */
async function authenticate(): Promise<SettingsActor | null> {
  const session = await getAppSession()
  if (!session) return null
  return { id: session.user.id, role: session.user.role }
}

const acceptUnknownInput = (input: unknown) => input

export const getBusinessSettings = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async (): Promise<SettingsReadResult> => {
    const actor = await authenticate()
    return settingsOperations.read(actor)
  })

export const updateBusinessSettings = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }): Promise<SettingsUpdateResult> => {
    const actor = await authenticate()
    return settingsOperations.update(actor, data)
  })
