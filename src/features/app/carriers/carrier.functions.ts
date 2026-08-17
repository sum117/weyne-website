import { createServerFn } from '@tanstack/react-start'
import { createCarrierPersistence } from '@/domain/carriers/repository.server'
import {
  createCarrierService,
  type CarrierServiceContract,
  type CarrierServiceError,
  type CarrierServiceResult,
} from '@/domain/carriers/service.server'
import { getDatabase } from '@/lib/db/database.server'
import type { Result } from '@/lib/domain/result'

export type { CarrierServiceContract } from '@/domain/carriers/service.server'

export type CarrierPublicError =
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
      message: 'Transportadora não encontrada.'
    }>
  | Readonly<{
      code: 'CONFLICT'
      status: 409
      message: 'A operação conflita com o estado atual da transportadora.'
    }>
  | Readonly<{
      code: 'REFERENCE_UNAVAILABLE'
      status: 409
      message: 'A transportadora arquivada não pode ser selecionada.'
    }>
  | Readonly<{
      code: 'INTERNAL_ERROR'
      status: 500
      message: 'Não foi possível concluir a operação.'
    }>

export type CarrierPublicResult<T> = Result<T, CarrierPublicError>

type CarrierOperationDependencies = Readonly<{
  getService: () => Promise<CarrierServiceContract>
  logUnexpectedError: (cause: unknown) => void
}>

function toPublicError(error: CarrierServiceError): CarrierPublicError {
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
        message: 'Transportadora não encontrada.',
      }
    case 'conflict':
      return {
        code: 'CONFLICT',
        status: 409,
        message: 'A operação conflita com o estado atual da transportadora.',
      }
    case 'reference':
      return {
        code: 'REFERENCE_UNAVAILABLE',
        status: 409,
        message: 'A transportadora arquivada não pode ser selecionada.',
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
  result: CarrierServiceResult<T>,
  logUnexpectedError: (cause: unknown) => void,
): CarrierPublicResult<T> {
  if (result.ok) return result
  if (result.error.category === 'unexpected') {
    logUnexpectedError(result.error.cause)
  }
  return { ok: false, error: toPublicError(result.error) }
}

export function createCarrierOperations(
  dependencies: CarrierOperationDependencies,
) {
  const invoke = async <T>(
    operation: (service: CarrierServiceContract) => Promise<CarrierServiceResult<T>>,
  ): Promise<CarrierPublicResult<T>> => {
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
    detail: (input: unknown) => invoke((service) => service.detail(input)),
    resolveActive: (input: unknown) =>
      invoke((service) => service.resolveActive(input)),
    create: (input: unknown) => invoke((service) => service.create(input)),
    update: (input: unknown) => invoke((service) => service.update(input)),
    archive: (input: unknown) => invoke((service) => service.archive(input)),
  })
}

async function getCarrierService(): Promise<CarrierServiceContract> {
  const database = await getDatabase()
  const persistence = createCarrierPersistence(database)
  return createCarrierService({
    ...persistence,
    // Fail closed until the authenticated app session adapter is connected.
    // Tests and application composition inject the existing RBAC actor explicitly.
    authenticate: async () => null,
    createId: () => crypto.randomUUID(),
    now: () => new Date(),
  })
}

const carrierOperations = createCarrierOperations({
  getService: getCarrierService,
  logUnexpectedError: (cause) => {
    console.error('Carrier server operation failed.', cause)
  },
})

const acceptUnknownInput = (input: unknown) => input

export const listCarriers = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => carrierOperations.list(data))

export const getCarrierDetail = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => carrierOperations.detail(data))

export const resolveActiveCarrier = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => carrierOperations.resolveActive(data))

export const createCarrier = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => carrierOperations.create(data))

export const updateCarrier = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => carrierOperations.update(data))

export const archiveCarrier = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(({ data }) => carrierOperations.archive(data))
