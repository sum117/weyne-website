import { logUnexpectedError } from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import {
  createOrderReadService,
  type OrderReadServiceContract,
  type OrderReadServiceError,
  type OrderReadServiceResult,
} from '@/domain/orders/read-service.server'
import { createPostgresOrderReadRepository } from '@/domain/orders/read-repository.server'
import { createPostgresOrderVisibilityResolver } from '@/domain/orders/read-visibility.server'
import type { CommercialActor } from '@/lib/orders/security-policy.server'
import { getDatabase } from '@/lib/db/database.server'
import type { Result } from '@/lib/domain/result'

/**
 * Authorized order read endpoints: paginated listing with filters and
 * snapshot-faithful detail retrieval. Every operation re-checks the RBAC
 * policy server-side; the UI never decides authorization.
 *
 * Authentication fails closed until the authenticated app session adapter is
 * connected, matching the carrier/industry/quote-PDF functions. The full
 * service composition below is exercised by tests and becomes live the moment
 * `authenticate` resolves a real actor.
 */

export type OrderPublicError =
  | Readonly<{
      code: 'VALIDATION_FAILED'
      status: 400
      message: 'Os dados informados são inválidos.'
      issues: readonly Readonly<{ path: readonly (string | number)[]; message: string }>[]
    }>
  | Readonly<{ code: 'UNAUTHENTICATED'; status: 401; message: 'Autenticação necessária.' }>
  | Readonly<{ code: 'NOT_FOUND'; status: 404; message: 'Pedido não encontrado.' }>
  | Readonly<{ code: 'INTERNAL_ERROR'; status: 500; message: 'Não foi possível concluir a operação.' }>

export type OrderListResult = Result<
  Readonly<{ items: readonly unknown[]; nextCursor: string | null }>,
  OrderPublicError
>
export type OrderDetailResult = Result<unknown, OrderPublicError>

function toPublicError(error: OrderReadServiceError): OrderPublicError {
  switch (error.category) {
    case 'validation':
      return {
        code: 'VALIDATION_FAILED',
        status: 400,
        message: 'Os dados informados são inválidos.',
        issues: error.issues.map(({ path, message }) => ({ path, message })),
      }
    case 'not-found':
      return { code: 'NOT_FOUND', status: 404, message: 'Pedido não encontrado.' }
    default:
      return { code: 'INTERNAL_ERROR', status: 500, message: 'Não foi possível concluir a operação.' }
  }
}

export function createOrderOperations(dependencies: Readonly<{
  getService: () => Promise<OrderReadServiceContract>
  logUnexpectedError: (cause: unknown) => void
}>) {
  async function invoke<T>(
    operation: (service: OrderReadServiceContract) => Promise<OrderReadServiceResult<T>>,
  ): Promise<Result<T, OrderPublicError>> {
    try {
      const service = await dependencies.getService()
      const result = await operation(service)
      if (!result.ok && result.error.category === 'unexpected') {
        dependencies.logUnexpectedError(result.error.cause)
      }
      return result.ok ? result : { ok: false, error: toPublicError(result.error) }
    } catch (cause) {
      dependencies.logUnexpectedError(cause)
      return {
        ok: false,
        error: { code: 'INTERNAL_ERROR', status: 500, message: 'Não foi possível concluir a operação.' },
      }
    }
  }

  return Object.freeze({
    list: (actor: CommercialActor, input: unknown) =>
      invoke((service) => service.list(actor, input)),
    detail: (actor: CommercialActor, input: unknown) =>
      invoke((service) => service.detail(actor, input)),
  })
}

async function getOrderReadService(): Promise<OrderReadServiceContract> {
  const database = await getDatabase()
  return createOrderReadService({
    repository: createPostgresOrderReadRepository(database),
    visibility: createPostgresOrderVisibilityResolver(database),
  })
}

/** Fails closed until the authenticated session adapter exists. */
function authenticate(): CommercialActor | null {
  return null
}

const orderOperations = createOrderOperations({
  getService: getOrderReadService,
  logUnexpectedError: (cause) => {
    logUnexpectedError('order.read', cause)
  },
})

const acceptUnknownInput = (input: unknown) => input

export const listOrders = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }) => {
    const actor = authenticate()
    if (!actor) {
      return {
        ok: false as const,
        error: {
          code: 'UNAUTHENTICATED' as const,
          status: 401 as const,
          message: 'Autenticação necessária.',
        },
      }
    }
    return orderOperations.list(actor, data)
  })

export const getOrderDetail = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }) => {
    const actor = authenticate()
    if (!actor) {
      return {
        ok: false as const,
        error: {
          code: 'UNAUTHENTICATED' as const,
          status: 401 as const,
          message: 'Autenticação necessária.',
        },
      }
    }
    return orderOperations.detail(actor, data)
  })
