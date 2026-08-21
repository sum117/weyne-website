import type { z } from 'zod'
import {
  orderIdInputSchema,
  orderListInputSchema,
  type OrderDetail,
  type OrderListOutput,
  type OrderListQuery,
  type RedactedOrderDetail,
} from './contracts'
import {
  authorizeCommercialAction,
  type CommercialActor,
  type CommercialResourceScope,
} from '@/lib/orders/security-policy.server'
import { parseRequest } from '@/lib/server/request.schema'
import {
  failure,
  success,
  unexpected,
  validationFailure,
  type ApplicationError,
  type Result,
} from '@/lib/domain/result'

export type OrderReadScope = Readonly<{
  tenantId: string
  ownerUserId: string
  assignedUserIds: readonly string[]
  status: string
}>

/**
 * Resolves the set of order IDs an actor may see. The security service owns
 * scope storage; the read service only consumes the resolved allowlist.
 */
export type OrderVisibilityResolver = Readonly<{
  /** Returns every visible order ID for the actor (scoped listing). */
  listVisibleOrderIds: (actor: CommercialActor) => Promise<readonly string[]>
  /** Authorizes one direct-ID access. `null` means the resource has no scope row. */
  resolveResourceAccess: (
    actor: CommercialActor,
    orderId: string,
  ) => Promise<
    Result<
      Readonly<{ scope: CommercialResourceScope; authorization: 'allow' | 'allow_redacted' }>,
      Extract<ApplicationError, { category: 'not-found' }>
    >
  >
}>

export type OrderReadServiceError =
  | Extract<ApplicationError, { category: 'validation' | 'not-found' | 'unexpected' }>

export type OrderReadServiceResult<T> = Result<T, OrderReadServiceError>

export type OrderDetailView =
  | Readonly<{ kind: 'full'; order: OrderDetail }>
  | Readonly<{ kind: 'redacted'; order: RedactedOrderDetail }>

export type OrderReadServiceContract = Readonly<{
  list: (
    actor: CommercialActor,
    input: unknown,
  ) => Promise<OrderReadServiceResult<OrderListOutput>>
  detail: (
    actor: CommercialActor,
    input: unknown,
  ) => Promise<OrderReadServiceResult<OrderDetailView>>
}>

type OrderReadServiceDependencies = Readonly<{
  repository: Readonly<{
    list: (
      query: OrderListQuery,
      visibleOrderIds: readonly string[],
    ) => Promise<OrderListOutput>
    findDetailById: (id: string) => Promise<OrderDetail | null>
  }>
  visibility: OrderVisibilityResolver
}>

function toRedacted(order: OrderDetail): RedactedOrderDetail {
  return Object.freeze({
    id: order.id,
    number: order.number,
    status: order.status,
    version: order.version,
    currencyCode: order.currencyCode,
    sourceQuoteId: order.sourceQuoteId,
    sourceQuoteRevision: order.sourceQuoteRevision,
    client: order.client,
  })
}

export function createOrderReadService(
  dependencies: OrderReadServiceDependencies,
): OrderReadServiceContract {
  return Object.freeze({
    async list(actor, input) {
      const request = parseRequest(
        orderListInputSchema,
        input,
      ) as Result<
        z.output<typeof orderListInputSchema>,
        Extract<ApplicationError, { category: 'validation' }>
      >
      if (!request.ok) return request

      try {
        const visibleOrderIds = await dependencies.visibility.listVisibleOrderIds(actor)
        if (visibleOrderIds.length === 0) {
          return success(Object.freeze({ items: [], nextCursor: null }))
        }
        const output = await dependencies.repository.list(
          request.data as OrderListQuery,
          visibleOrderIds,
        )
        return success(output)
      } catch (cause) {
        if (cause instanceof RangeError) {
          return failure(
            validationFailure([{ path: ['cursor'], message: 'Cursor inválido.' }]),
          )
        }
        return failure(unexpected(cause))
      }
    },

    async detail(actor, input) {
      const request = parseRequest(orderIdInputSchema, input)
      if (!request.ok) return request as OrderReadServiceResult<never>

      try {
        const access = await dependencies.visibility.resolveResourceAccess(actor, request.data.id)
        if (!access.ok) return failure(access.error)

        // Re-check through the shared policy so direct service calls cannot
        // bypass RBAC: the resolved authorization must still permit reads.
        const decision = authorizeCommercialAction(
          actor,
          'order.read',
          access.data.scope,
        )
        if (decision === 'forbidden') {
          return failure({ category: 'not-found' })
        }

        const order = await dependencies.repository.findDetailById(request.data.id)
        if (!order || !access.data.scope.tenantId) return failure({ category: 'not-found' })

        if (decision === 'allow_redacted' || access.data.authorization === 'allow_redacted') {
          return success({ kind: 'redacted', order: toRedacted(order) } as OrderDetailView)
        }
        return success({ kind: 'full', order } as OrderDetailView)
      } catch (cause) {
        return failure(unexpected(cause))
      }
    },
  })
}
