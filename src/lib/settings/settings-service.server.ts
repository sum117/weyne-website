import {
  businessSettingsSchema,
  settingsUpdateInputSchema,
  type BusinessSettings,
  type SettingsRecord,
} from '@/domain/settings/business-settings'
import { authorize } from '@/lib/auth/capabilities'
import { failure, success, type Result } from '@/lib/domain/result'
import { parseRequest } from '@/lib/server/request.schema'
import type {
  SettingsRepository,
} from './settings-repository.server'

/**
 * Admin-only application service for the canonical `business` settings.
 *
 * Authorization is re-derived on every call: only an authenticated admin may
 * read or update. Payloads are validated with the shared canonical Zod schema
 * before any persistence happens, so a malformed update can never reach the
 * database. Updates run as a compare-and-swap against `expectedVersion`; a
 * stale writer receives a machine-readable conflict carrying the current
 * record, and the last-known valid settings stay intact on every failure path.
 *
 * Issued-document numbering counters are not part of the canonical payload and
 * therefore cannot be changed through this service; nothing here touches
 * VITE/public configuration either — settings live only in PostgreSQL.
 */

export type SettingsActor = Readonly<{
  id: string
  role: 'admin' | 'representative' | 'read_only'
}>

export type SettingsServiceError =
  | Readonly<{ category: 'unauthenticated' }>
  | Readonly<{ category: 'forbidden' }>
  | Readonly<{ category: 'validation'; issues: readonly Readonly<{
      path: readonly (string | number)[]
      message: string
    }>[] }>
  | Readonly<{ category: 'not-found' }>
  | Readonly<{ category: 'conflict'; currentRecord: SettingsRecord | null }>
  | Readonly<{ category: 'unexpected'; cause: unknown }>

export type SettingsResult<T> = Result<T, SettingsServiceError>

export type SettingsAuditSink = Readonly<{
  append(event: SettingsServiceAuditEvent): Promise<void>
}>

export type SettingsServiceAuditEvent = Readonly<{
  action: 'settings.read' | 'settings.update' | 'settings.conflict' | 'settings.denied'
  actorId: string | null
  occurredAt: Date
  outcome: 'succeeded' | 'forbidden' | 'unauthenticated' | 'validation_failed' | 'conflict' | 'failed'
  changedFields?: readonly string[]
  version?: number
  detail?: string
}>

export type SettingsServiceContract = Readonly<{
  getSettings: (actor: SettingsActor | null) => Promise<SettingsResult<SettingsRecord>>
  updateSettings: (
    actor: SettingsActor | null,
    input: unknown,
  ) => Promise<SettingsResult<SettingsRecord>>
}>

export type SettingsServiceDependencies = Readonly<{
  repository: SettingsRepository
  audit: SettingsAuditSink
  logUnexpectedError: (cause: unknown) => void
  createCorrelationId: () => string
  now?: () => Date
}>

async function safely<T>(
  work: () => Promise<SettingsResult<T>>,
  logUnexpectedError: (cause: unknown) => void,
): Promise<SettingsResult<T>> {
  try {
    return await work()
  } catch (cause) {
    logUnexpectedError(cause)
    return failure({ category: 'unexpected' as const, cause })
  }
}

export function createSettingsService(
  dependencies: SettingsServiceDependencies,
): SettingsServiceContract {
  const now = dependencies.now ?? (() => new Date())

  async function record(event: SettingsServiceAuditEvent): Promise<void> {
    try {
      await dependencies.audit.append(event)
    } catch (cause) {
      dependencies.logUnexpectedError(cause)
    }
  }

  function authorizeActor(
    actor: SettingsActor | null,
  ): actor is SettingsActor & { role: 'admin' } {
    return (
      actor !== null && authorize(actor.role, 'settings.read') === 'allow'
    )
  }

  return Object.freeze({
    async getSettings(actor) {
      if (!actor) {
        await record({
          action: 'settings.read',
          actorId: null,
          occurredAt: now(),
          outcome: 'unauthenticated',
        })
        return failure({ category: 'unauthenticated' as const })
      }
      if (!authorizeActor(actor)) {
        await record({
          action: 'settings.denied',
          actorId: actor.id,
          occurredAt: now(),
          outcome: 'forbidden',
        })
        return failure({ category: 'forbidden' as const })
      }
      return safely(async () => {
        const existing = await dependencies.repository.findRecord()
        if (!existing) {
          return failure({ category: 'not-found' as const })
        }
        await record({
          action: 'settings.read',
          actorId: actor.id,
          occurredAt: now(),
          outcome: 'succeeded',
          version: existing.version,
        })
        return success(existing)
      }, dependencies.logUnexpectedError)
    },

    async updateSettings(actor, input) {
      if (!actor) {
        await record({
          action: 'settings.update',
          actorId: null,
          occurredAt: now(),
          outcome: 'unauthenticated',
        })
        return failure({ category: 'unauthenticated' as const })
      }
      if (!authorizeActor(actor)) {
        await record({
          action: 'settings.denied',
          actorId: actor.id,
          occurredAt: now(),
          outcome: 'forbidden',
        })
        return failure({ category: 'forbidden' as const })
      }

      const request = parseRequest(settingsUpdateInputSchema, input)
      if (!request.ok) {
        await record({
          action: 'settings.update',
          actorId: actor.id,
          occurredAt: now(),
          outcome: 'validation_failed',
        })
        return request
      }

      // Re-validate through the canonical schema so defaults are materialized
      // exactly once and the persisted value is always in canonical form.
      let settings: BusinessSettings
      try {
        settings = businessSettingsSchema.parse(request.data.settings)
      } catch (cause) {
        dependencies.logUnexpectedError(cause)
        await record({
          action: 'settings.update',
          actorId: actor.id,
          occurredAt: now(),
          outcome: 'validation_failed',
          detail: 'canonical_reparse_failed',
        })
        return failure({ category: 'unexpected' as const, cause })
      }

      return safely(async () => {
        const result = await dependencies.repository.updateRecord({
          expectedVersion: request.data.expectedVersion,
          settings,
          actorUserId: actor.id,
          occurredAt: now(),
          correlationId: dependencies.createCorrelationId(),
        })

        if (!result.ok) {
          if (result.outcome === 'conflict') {
            const current = await dependencies.repository.findRecord()
            await record({
              action: 'settings.conflict',
              actorId: actor.id,
              occurredAt: now(),
              outcome: 'conflict',
              version: current?.version,
            })
            return failure({ category: 'conflict' as const, currentRecord: current })
          }
          await record({
            action: 'settings.update',
            actorId: actor.id,
            occurredAt: now(),
            outcome: 'failed',
            detail: result.outcome,
          })
          return failure({ category: 'not-found' as const })
        }

        await record({
          action: 'settings.update',
          actorId: actor.id,
          occurredAt: now(),
          outcome: 'succeeded',
          changedFields: result.audit.changedFields,
          version: result.record.version,
        })
        return success(result.record)
      }, dependencies.logUnexpectedError)
    },
  })
}
