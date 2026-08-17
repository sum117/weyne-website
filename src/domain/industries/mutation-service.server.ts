import type {
  IndustryCreate,
  IndustryDetail,
  IndustryUpdate,
} from '@/domain/industries/contracts'
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
import {
  industryArchiveInputSchema,
  industryCreateInputSchema,
  industryUpdateInputSchema,
} from './contracts'

type IndustryAuditState = Readonly<{
  legalName: string
  tradeName: string
  defaultCommissionPercentage: string
  archived: boolean
}>

export type IndustryAuditEvent = Readonly<{
  actor: CatalogActor
  industryId: string
  action: 'industry.create' | 'industry.update' | 'industry.archive'
  occurredAt: string
  before: IndustryAuditState | null
  after: IndustryAuditState
  metadata: Readonly<{ changedFields: readonly string[] }>
}>

type WriteMetadata = Readonly<{ actorUserId: string; occurredAt: Date }>

export type IndustryMutationRepository = Readonly<{
  findById: (id: string) => Promise<IndustryDetail | null>
  findByCnpj: (cnpj: string) => Promise<IndustryDetail | null>
  create: (
    input: IndustryCreate,
    metadata: WriteMetadata & Readonly<{ id: string }>,
  ) => Promise<IndustryDetail>
  update: (
    input: IndustryUpdate,
    metadata: WriteMetadata,
  ) => Promise<IndustryDetail | null>
  archive: (
    id: string,
    metadata: WriteMetadata,
  ) => Promise<IndustryDetail | null>
  appendAudit: (event: IndustryAuditEvent) => Promise<void>
}>

export type IndustryUnitOfWork = Readonly<{
  transaction: <T>(
    work: (repository: IndustryMutationRepository) => Promise<T>,
  ) => Promise<T>
}>

export type IndustryMutationError =
  | ApplicationError
  | Readonly<{ category: 'unauthenticated' }>
  | Readonly<{ category: 'forbidden' }>

export type IndustryMutationResult<T> = Result<T, IndustryMutationError>

export type IndustryMutationServiceContract = Readonly<{
  create: (input: unknown) => Promise<IndustryMutationResult<IndustryDetail>>
  update: (input: unknown) => Promise<IndustryMutationResult<IndustryDetail>>
  archive: (input: unknown) => Promise<IndustryMutationResult<IndustryDetail>>
}>

type IndustryMutationDependencies = Readonly<{
  authenticate: () => Promise<CatalogActor | null>
  repository: IndustryMutationRepository
  unitOfWork: IndustryUnitOfWork
  createId: () => string
  now: () => Date
}>

const duplicateCnpjError = () =>
  validationFailure([
    {
      path: ['cnpj'],
      message: 'Já existe uma indústria cadastrada com este CNPJ.',
    },
  ])

function databaseProperty(cause: unknown, property: 'code' | 'constraint'): unknown {
  if (typeof cause !== 'object' || cause === null) return undefined
  if (property in cause) return (cause as Record<string, unknown>)[property]
  if ('cause' in cause) return databaseProperty(cause.cause, property)
  return undefined
}

const commissionValidationError = () =>
  validationFailure([
    {
      path: ['defaultCommissionPercentage'],
      message: 'Informe uma porcentagem entre 0 e 100 com até 6 casas decimais',
    },
  ])

function databaseError(cause: unknown): IndustryMutationError {
  const code = databaseProperty(cause, 'code')
  const constraint = databaseProperty(cause, 'constraint')
  if (code === '23505') return duplicateCnpjError()
  if (
    code === '23514' &&
    constraint === 'industries_default_commission_ck'
  ) {
    return commissionValidationError()
  }
  return unexpected(cause)
}

function safeAuditState(industry: IndustryDetail): IndustryAuditState {
  return Object.freeze({
    legalName: industry.legalName,
    tradeName: industry.tradeName,
    defaultCommissionPercentage: industry.defaultCommissionPercentage,
    archived: industry.archivedAt !== null,
  })
}

function changedFields(input: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.freeze(
    Object.keys(input)
      .filter((field) => field !== 'id' && input[field] !== undefined)
      .sort((left, right) => left.localeCompare(right, 'en-US')),
  )
}

function auditEvent(
  actor: CatalogActor,
  industry: IndustryDetail,
  action: IndustryAuditEvent['action'],
  occurredAt: Date,
  before: IndustryDetail | null,
  fields: readonly string[],
): IndustryAuditEvent {
  return Object.freeze({
    actor: Object.freeze({ ...actor }),
    industryId: industry.id,
    action,
    occurredAt: occurredAt.toISOString(),
    before: before === null ? null : safeAuditState(before),
    after: safeAuditState(industry),
    metadata: Object.freeze({ changedFields: Object.freeze([...fields]) }),
  })
}

export function createIndustryMutationService(
  dependencies: IndustryMutationDependencies,
): IndustryMutationServiceContract {
  async function authorize(
    action: CatalogAction,
  ): Promise<Result<CatalogActor, IndustryMutationError>> {
    const actor = await dependencies.authenticate()
    if (!actor) return failure({ category: 'unauthenticated' as const })
    return authorizeCatalogAction(actor, action) === 'allow'
      ? { ok: true, data: actor }
      : failure({ category: 'forbidden' as const })
  }

  async function safely<T>(
    work: () => Promise<IndustryMutationResult<T>>,
  ): Promise<IndustryMutationResult<T>> {
    try {
      return await work()
    } catch (cause) {
      return failure(databaseError(cause))
    }
  }

  return Object.freeze({
    async create(input: unknown): Promise<IndustryMutationResult<IndustryDetail>> {
      const actor = await authorize('industry.create')
      if (!actor.ok) return actor
      const request = parseRequest(industryCreateInputSchema, input)
      if (!request.ok) return request
      return safely(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          if ((await repository.findByCnpj(request.data.cnpj)) !== null) {
            return failure(duplicateCnpjError())
          }
          const now = dependencies.now()
          const industry = await repository.create(request.data, {
            id: dependencies.createId(),
            actorUserId: actor.data.id,
            occurredAt: now,
          })
          await repository.appendAudit(
            auditEvent(
              actor.data,
              industry,
              'industry.create',
              now,
              null,
              changedFields(request.data),
            ),
          )
          return success(industry)
        }),
      )
    },
    async update(input: unknown): Promise<IndustryMutationResult<IndustryDetail>> {
      const actor = await authorize('industry.update')
      if (!actor.ok) return actor
      const request = parseRequest(industryUpdateInputSchema, input)
      if (!request.ok) return request
      return safely(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const before = await repository.findById(request.data.id)
          if (before === null) return failure(notFound())
          if (before.archivedAt !== null) return failure(conflict())
          if (request.data.cnpj !== undefined) {
            const duplicate = await repository.findByCnpj(request.data.cnpj)
            if (duplicate !== null && duplicate.id !== request.data.id) {
              return failure(duplicateCnpjError())
            }
          }
          const now = dependencies.now()
          const industry = await repository.update(request.data, {
            actorUserId: actor.data.id,
            occurredAt: now,
          })
          if (industry === null) return failure(conflict())
          await repository.appendAudit(
            auditEvent(
              actor.data,
              industry,
              'industry.update',
              now,
              before,
              changedFields(request.data),
            ),
          )
          return success(industry)
        }),
      )
    },
    async archive(input: unknown): Promise<IndustryMutationResult<IndustryDetail>> {
      const actor = await authorize('industry.archive')
      if (!actor.ok) return actor
      const request = parseRequest(industryArchiveInputSchema, input)
      if (!request.ok) return request
      return safely(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const before = await repository.findById(request.data.id)
          if (before === null) return failure(notFound())
          if (before.archivedAt !== null) return failure(conflict())
          const now = dependencies.now()
          const industry = await repository.archive(request.data.id, {
            actorUserId: actor.data.id,
            occurredAt: now,
          })
          if (industry === null) return failure(conflict())
          await repository.appendAudit(
            auditEvent(
              actor.data,
              industry,
              'industry.archive',
              now,
              before,
              ['archivedAt'],
            ),
          )
          return success(industry)
        }),
      )
    },
  })
}