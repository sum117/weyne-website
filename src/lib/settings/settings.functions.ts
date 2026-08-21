import { logStructuredEvent, logUnexpectedError } from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import { getDatabase } from '@/lib/db/database.server'
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
 * Every call re-derives the actor server-side; authorization is never decided
 * by the client. Authentication fails closed until the authenticated app
 * session adapter is connected, matching the established posture of the
 * report-export, order, and industry functions.
 *
 * Settings are sourced from PostgreSQL only. Nothing in this module reads or
 * emits `VITE_*`/public configuration, and issued-document numbering counters
 * are not addressable through these endpoints — the canonical payload schema
 * rejects unknown keys, so counters cannot be smuggled in.
 */

export type SettingsPublicError =
  | Readonly<{
      code: 'VALIDATION_FAILED'
      status: 400
      message: 'Os dados informados são inválidos.'
      issues: readonly Readonly<{ path: readonly (string | number)[]; message: string }>[]
    }>
  | Readonly<{ code: 'UNAUTHENTICATED'; status: 401; message: 'Autenticação necessária.' }>
  | Readonly<{ code: 'FORBIDDEN'; status: 403; message: 'Você não tem permissão para realizar esta operação.' }>
  | Readonly<{ code: 'NOT_FOUND'; status: 404; message: 'Configurações ainda não inicializadas.' }>
  | Readonly<{
      code: 'CONFLICT'
      status: 409
      message: 'As configurações foram alteradas por outra pessoa. Recarregue e tente novamente.'
      currentRecord: SettingsRecord | null
    }>
  | Readonly<{ code: 'INTERNAL_ERROR'; status: 500; message: 'Não foi possível concluir a operação.' }>

export type SettingsReadResult = Result<SettingsRecord, SettingsPublicError>
export type SettingsUpdateResult = Result<SettingsRecord, SettingsPublicError>

function toPublicError(error: SettingsServiceError): SettingsPublicError {
  switch (error.category) {
    case 'validation':
      return {
        code: 'VALIDATION_FAILED',
        status: 400,
        message: 'Os dados informados são inválidos.',
        issues: error.issues.map(({ path, message }) => ({ path, message })),
      }
    case 'unauthenticated':
      return { code: 'UNAUTHENTICATED', status: 401, message: 'Autenticação necessária.' }
    case 'forbidden':
      return {
        code: 'FORBIDDEN',
        status: 403,
        message: 'Você não tem permissão para realizar esta operação.',
      }
    case 'not-found':
      return { code: 'NOT_FOUND', status: 404, message: 'Configurações ainda não inicializadas.' }
    case 'conflict':
      // The current valid record travels back so a client can rebase without
      // losing its own edits; it is the canonical record, safe to expose to an
      // authenticated admin who just failed a stale write.
      return {
        code: 'CONFLICT',
        status: 409,
        message: 'As configurações foram alteradas por outra pessoa. Recarregue e tente novamente.',
        currentRecord: error.currentRecord,
      }
    case 'unexpected':
      return { code: 'INTERNAL_ERROR', status: 500, message: 'Não foi possível concluir a operação.' }
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
          message: 'Não foi possível concluir a operação.',
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
    authenticateRole: async () => null,
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

/** Fails closed until the authenticated session adapter exists. */
async function authenticate(): Promise<SettingsActor | null> {
  return null
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
