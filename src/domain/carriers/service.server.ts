import type { z } from 'zod'
import type {
  CarrierCreate,
  CarrierDetail,
  CarrierListOutput,
  CarrierListQuery,
  CarrierUpdate,
} from '@/domain/carriers/contracts'
import {
  carrierArchiveInputSchema,
  carrierCreateInputSchema,
  carrierDetailInputSchema,
  carrierListInputSchema,
  carrierUpdateInputSchema,
} from '@/domain/carriers/contracts'
import {
  authorizeCatalogAction,
  type CatalogAction,
  type CatalogActor,
} from '@/lib/catalog/authorization.server'
import {
  conflict,
  failure,
  notFound,
  success,
  unexpected,
  validationFailure,
  type ApplicationError,
  type Result,
} from '@/lib/domain/result'
import { parseRequest } from '@/lib/server/request.schema'

export type CarrierAuditEvent = Readonly<{
  actor: CatalogActor
  carrierId: string
  action: 'carrier.create' | 'carrier.update' | 'carrier.archive'
  occurredAt: string
  metadata: Readonly<{
    changedFields: readonly string[]
  }>
}>

export type CarrierRepository = Readonly<{
  findById: (id: string) => Promise<CarrierDetail | null>
  findActiveById: (id: string) => Promise<CarrierDetail | null>
  list: (query: CarrierListQuery) => Promise<CarrierListOutput>
  create: (
    input: CarrierCreate,
    metadata: Readonly<{ id: string; actorUserId: string; occurredAt: Date }>,
  ) => Promise<CarrierDetail>
  update: (
    input: CarrierUpdate,
    metadata: Readonly<{ actorUserId: string; occurredAt: Date }>,
  ) => Promise<CarrierDetail | null>
  archive: (
    id: string,
    metadata: Readonly<{ actorUserId: string; occurredAt: Date }>,
  ) => Promise<CarrierDetail | null>
  appendAudit: (event: CarrierAuditEvent) => Promise<void>
}>

export type CarrierUnitOfWork = Readonly<{
  transaction: <T>(work: (repository: CarrierRepository) => Promise<T>) => Promise<T>
}>

export type CarrierServiceError =
  | ApplicationError
  | Readonly<{ category: 'unauthenticated' }>
  | Readonly<{ category: 'forbidden' }>
  | Readonly<{ category: 'reference' }>

export type CarrierServiceResult<T> = Result<T, CarrierServiceError>

export type CarrierServiceContract = Readonly<{
  list: (input: unknown) => Promise<CarrierServiceResult<CarrierListOutput>>
  detail: (input: unknown) => Promise<CarrierServiceResult<CarrierDetail>>
  resolveActive: (input: unknown) => Promise<CarrierServiceResult<CarrierDetail>>
  create: (input: unknown) => Promise<CarrierServiceResult<CarrierDetail>>
  update: (input: unknown) => Promise<CarrierServiceResult<CarrierDetail>>
  archive: (input: unknown) => Promise<CarrierServiceResult<CarrierDetail>>
}>

type CarrierServiceDependencies = Readonly<{
  authenticate: () => Promise<CatalogActor | null>
  repository: CarrierRepository
  unitOfWork: CarrierUnitOfWork
  createId: () => string
  now: () => Date
}>

function databaseError(cause: unknown): CarrierServiceError {
  const directCode =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? cause.code
      : undefined
  const nestedCode =
    typeof cause === 'object' &&
    cause !== null &&
    'cause' in cause &&
    typeof cause.cause === 'object' &&
    cause.cause !== null &&
    'code' in cause.cause
      ? cause.cause.code
      : undefined
  return directCode === '23505' || nestedCode === '23505'
    ? conflict()
    : unexpected(cause)
}

function carrierListError(cause: unknown): CarrierServiceError {
  return cause instanceof RangeError
    ? validationFailure([{ path: ['cursor'], message: 'Cursor inválido.' }])
    : databaseError(cause)
}

function changedFields(input: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.keys(input)
    .filter((field) => field !== 'id' && input[field] !== undefined)
    .sort((left, right) => left.localeCompare(right, 'en-US'))
}

function auditEvent(
  actor: CatalogActor,
  carrierId: string,
  action: CarrierAuditEvent['action'],
  occurredAt: Date,
  fields: readonly string[],
): CarrierAuditEvent {
  return Object.freeze({
    actor: Object.freeze({ ...actor }),
    carrierId,
    action,
    occurredAt: occurredAt.toISOString(),
    metadata: Object.freeze({ changedFields: Object.freeze([...fields]) }),
  })
}

function parse<TSchema extends z.ZodType>(schema: TSchema, input: unknown) {
  return parseRequest(schema, input) as Result<z.output<TSchema>, Extract<ApplicationError, { category: 'validation' }>>
}

export function createCarrierService(
  dependencies: CarrierServiceDependencies,
): CarrierServiceContract {
  async function authorize(action: CatalogAction): Promise<Result<CatalogActor, CarrierServiceError>> {
    const actor = await dependencies.authenticate()
    if (!actor) return failure({ category: 'unauthenticated' as const })
    return authorizeCatalogAction(actor, action) === 'allow'
      ? success(actor)
      : failure({ category: 'forbidden' as const })
  }

  async function safely<T>(
    work: () => Promise<CarrierServiceResult<T>>,
    errorForCause: (cause: unknown) => CarrierServiceError = databaseError,
  ): Promise<CarrierServiceResult<T>> {
    try {
      return await work()
    } catch (cause) {
      return failure(errorForCause(cause))
    }
  }

  return Object.freeze({
    async list(input) {
      const actor = await authorize('carrier.search')
      if (!actor.ok) return actor
      const request = parse(carrierListInputSchema, input)
      if (!request.ok) return request
      return safely(
        async () => success(await dependencies.repository.list(request.data)),
        carrierListError,
      )
    },

    async detail(input) {
      const actor = await authorize('carrier.read')
      if (!actor.ok) return actor
      const request = parse(carrierDetailInputSchema, input)
      if (!request.ok) return request
      return safely(async () => {
        const carrier = await dependencies.repository.findById(request.data.id)
        return carrier === null ? failure(notFound()) : success(carrier)
      })
    },

    async resolveActive(input) {
      const actor = await authorize('carrier.read')
      if (!actor.ok) return actor
      const request = parse(carrierDetailInputSchema, input)
      if (!request.ok) return request
      return safely(async () => {
        const active = await dependencies.repository.findActiveById(request.data.id)
        if (active !== null) return success(active)
        const historical = await dependencies.repository.findById(request.data.id)
        return historical === null
          ? failure(notFound())
          : failure({ category: 'reference' as const })
      })
    },

    async create(input) {
      const actor = await authorize('carrier.create')
      if (!actor.ok) return actor
      const request = parse(carrierCreateInputSchema, input)
      if (!request.ok) return request
      return safely(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const now = dependencies.now()
          const carrier = await repository.create(request.data, {
            id: dependencies.createId(),
            actorUserId: actor.data.id,
            occurredAt: now,
          })
          await repository.appendAudit(
            auditEvent(
              actor.data,
              carrier.id,
              'carrier.create',
              now,
              changedFields(request.data),
            ),
          )
          return success(carrier)
        }),
      )
    },

    async update(input) {
      const actor = await authorize('carrier.update')
      if (!actor.ok) return actor
      const request = parse(carrierUpdateInputSchema, input)
      if (!request.ok) return request
      return safely(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const now = dependencies.now()
          const carrier = await repository.update(request.data, {
            actorUserId: actor.data.id,
            occurredAt: now,
          })
          if (carrier === null) {
            const historical = await repository.findById(request.data.id)
            return historical === null ? failure(notFound()) : failure(conflict())
          }
          await repository.appendAudit(
            auditEvent(
              actor.data,
              carrier.id,
              'carrier.update',
              now,
              changedFields(request.data),
            ),
          )
          return success(carrier)
        }),
      )
    },

    async archive(input) {
      const actor = await authorize('carrier.archive')
      if (!actor.ok) return actor
      const request = parse(carrierArchiveInputSchema, input)
      if (!request.ok) return request
      return safely(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const now = dependencies.now()
          const carrier = await repository.archive(request.data.id, {
            actorUserId: actor.data.id,
            occurredAt: now,
          })
          if (carrier === null) {
            const historical = await repository.findById(request.data.id)
            return historical === null ? failure(notFound()) : failure(conflict())
          }
          await repository.appendAudit(
            auditEvent(actor.data, carrier.id, 'carrier.archive', now, ['archivedAt']),
          )
          return success(carrier)
        }),
      )
    },
  })
}
