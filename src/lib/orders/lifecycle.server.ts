import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '@/lib/db/schema'
import {
  createPostgresOrderRepository,
  type PersistedOrder,
} from '@/lib/orders/repository.server'

export type OrderLifecycleStatus =
  | 'open'
  | 'confirmed'
  | 'invoiced'
  | 'completed'
  | 'cancelled'

export type OrderLifecycleCommand =
  | 'confirmOrder'
  | 'markOrderInvoiced'
  | 'completeOrder'
  | 'cancelOrder'

export type OrderLifecycleActor = Readonly<{
  id: string
  role: 'admin' | 'representative' | 'read_only'
}>

/**
 * Frozen transition graph from docs/domain/quote-order-workflow-contract.md §3.2:
 *
 *   open      -> confirmed | cancelled
 *   confirmed -> invoiced | cancelled
 *   invoiced  -> completed | cancelled
 *   completed -> (none)
 *   cancelled -> (none)
 */
export const ORDER_LIFECYCLE_TARGETS: Readonly<
  Record<OrderLifecycleCommand, Partial<Record<OrderLifecycleStatus, OrderLifecycleStatus>>>
> = Object.freeze({
  confirmOrder: Object.freeze({ open: 'confirmed' }),
  markOrderInvoiced: Object.freeze({ confirmed: 'invoiced' }),
  completeOrder: Object.freeze({ invoiced: 'completed' }),
  cancelOrder: Object.freeze({
    open: 'cancelled',
    confirmed: 'cancelled',
    invoiced: 'cancelled',
  }),
})

const COMMAND_PERMISSIONS: Readonly<Record<OrderLifecycleCommand, readonly string[]>> =
  Object.freeze({
    // docs/domain/role-permission-matrix.md §10: lifecycle commands are
    // admin-only; representatives and read_only actors are denied.
    confirmOrder: ['admin'],
    markOrderInvoiced: ['admin'],
    completeOrder: ['admin'],
    cancelOrder: ['admin'],
  })

const REASON_REQUIRED_COMMANDS: ReadonlySet<OrderLifecycleCommand> = new Set([
  'cancelOrder',
])

export type OrderLifecycleErrorCode =
  | 'ORDER_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_STATE_TRANSITION'
  | 'TRANSITION_REASON_REQUIRED'
  | 'CONCURRENT_MODIFICATION'

export class OrderLifecycleError extends Error {
  readonly code: OrderLifecycleErrorCode

  constructor(code: OrderLifecycleErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'OrderLifecycleError'
    this.code = code
  }
}

export interface OrderLifecycleService {
  transition(input: OrderLifecycleTransitionInput): Promise<PersistedOrder>
}

export type OrderLifecycleTransitionInput = Readonly<{
  orderId: string
  expectedVersion: bigint
  command: OrderLifecycleCommand
  actor: OrderLifecycleActor
  reason?: string
  occurredAt?: Date
}>

type Database = PostgresJsDatabase<typeof schema>

export function createOrderLifecycleService(database: Database): OrderLifecycleService {
  const repository = createPostgresOrderRepository(database)

  return Object.freeze({
    async transition(input: OrderLifecycleTransitionInput) {
      if (!COMMAND_PERMISSIONS[input.command].includes(input.actor.role)) {
        throw new OrderLifecycleError('FORBIDDEN')
      }

      const reason = input.reason?.trim() ?? ''
      if (REASON_REQUIRED_COMMANDS.has(input.command) && !reason) {
        throw new OrderLifecycleError('TRANSITION_REASON_REQUIRED')
      }

      return repository.transaction(async (transaction) => {
        const order = await transaction.findById(input.orderId)
        if (!order) throw new OrderLifecycleError('ORDER_NOT_FOUND')
        if (order.version !== input.expectedVersion) {
          throw new OrderLifecycleError('CONCURRENT_MODIFICATION')
        }

        const toStatus = ORDER_LIFECYCLE_TARGETS[input.command][order.status]
        if (!toStatus) {
          throw new OrderLifecycleError(
            'INVALID_STATE_TRANSITION',
            `Cannot ${input.command} an order in status ${order.status}`,
          )
        }

        try {
          return await transaction.transitionState({
            orderId: input.orderId,
            expectedVersion: input.expectedVersion,
            toStatus,
            actor: input.actor.id,
            reason: reason || input.command,
            occurredAt: input.occurredAt,
          })
        } catch (error) {
          if (error instanceof Error && 'code' in error) {
            const code = (error as { code: string }).code
            if (code === 'ORDER_NOT_FOUND') {
              throw new OrderLifecycleError('ORDER_NOT_FOUND')
            }
            if (code === 'CONCURRENT_MODIFICATION') {
              throw new OrderLifecycleError('CONCURRENT_MODIFICATION')
            }
          }
          throw error
        }
      })
    },
  })
}
