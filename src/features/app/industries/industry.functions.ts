import { logUnexpectedError } from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import { createPostgresIndustryPersistence } from '@/domain/industries/repository.server'
import {
  createIndustryMutationService,
  type IndustryMutationError,
  type IndustryMutationResult,
  type IndustryMutationServiceContract,
} from '@/domain/industries/mutation-service.server'
import { getDatabase } from '@/lib/db/database.server'
import type { Result } from '@/lib/domain/result'

export type { IndustryMutationServiceContract } from '@/domain/industries/mutation-service.server'

export type IndustryMutationPublicError =
  | Readonly<{
      code: 'VALIDATION_FAILED'
      status: 400
      message: 'Os dados informados são inválidos.'
      issues: readonly Readonly<{
        path: readonly (string | number)[]
        message: string
      }>[]
    }>
  | Readonly<{
      code: 'UNAUTHENTICATED'
      status: 401
      message: 'Autenticação necessária.'
    }>
  | Readonly<{
      code: 'FORBIDDEN'
      status: 403
      message: 'Você não tem permissão para realizar esta operação.'
    }>
  | Readonly<{
      code: 'NOT_FOUND'
      status: 404
      message: 'Indústria não encontrada.'
    }>
  | Readonly<{
      code: 'CONFLICT'
      status: 409
      message: 'A operação conflita com o estado atual da indústria.'
    }>
  | Readonly<{
      code: 'INTERNAL_ERROR'
      status: 500
      message: 'Não foi possível concluir a operação.'
    }>

export type IndustryMutationPublicResult<T> = Result<T, IndustryMutationPublicError>

type OperationDependencies = Readonly<{
  getService: () => Promise<IndustryMutationServiceContract>
  logUnexpectedError: (cause: unknown) => void
}>

function toPublicError(error: IndustryMutationError): IndustryMutationPublicError {
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
        message: 'Você não tem permissão para realizar esta operação.',
      }
    case 'not-found':
      return {
        code: 'NOT_FOUND',
        status: 404,
        message: 'Indústria não encontrada.',
      }
    case 'conflict':
      return {
        code: 'CONFLICT',
        status: 409,
        message: 'A operação conflita com o estado atual da indústria.',
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
  result: IndustryMutationResult<T>,
  logUnexpectedError: (cause: unknown) => void,
): IndustryMutationPublicResult<T> {
  if (result.ok) return result
  if (result.error.category === 'unexpected') {
    logUnexpectedError(result.error.cause)
  }
  return { ok: false, error: toPublicError(result.error) }
}

export function createIndustryMutationOperations(
  dependencies: OperationDependencies,
) {
  const invoke = async <T>(
    operation: (
      service: IndustryMutationServiceContract,
    ) => Promise<IndustryMutationResult<T>>,
  ): Promise<IndustryMutationPublicResult<T>> => {
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
    create: (input: unknown) => invoke((service) => service.create(input)),
    update: (input: unknown) => invoke((service) => service.update(input)),
    archive: (input: unknown) => invoke((service) => service.archive(input)),
  })
}

async function getIndustryMutationService(): Promise<IndustryMutationServiceContract> {
  const database = await getDatabase()
  const persistence = createPostgresIndustryPersistence(database)
  return createIndustryMutationService({
    ...persistence,
    // Fail closed until the authenticated app session adapter is connected.
    authenticate: async () => null,
    createId: () => crypto.randomUUID(),
    now: () => new Date(),
  })
}

const industryMutationOperations = createIndustryMutationOperations({
  getService: getIndustryMutationService,
  logUnexpectedError: (cause) => {
    logUnexpectedError('industry.server', cause)
  },
})

const acceptUnknownInput = (input: unknown) => input

export const createIndustry = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => industryMutationOperations.create(data))

export const updateIndustry = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => industryMutationOperations.update(data))

export const archiveIndustry = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => industryMutationOperations.archive(data))