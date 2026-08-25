import type {
  OrderHistoryEvent,
  OrderHistoryEventType,
  OrderHistoryOutput,
} from './contracts'
import {
  ORDER_HISTORY_EVENT_TYPES,
  orderHistoryInputSchema,
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
  type ApplicationError,
  type Result,
} from '@/lib/domain/result'

export type OrderHistoryServiceError =
  | Extract<ApplicationError, { category: 'validation' | 'not-found' | 'unexpected' }>

export type OrderHistoryServiceResult<T> = Result<T, OrderHistoryServiceError>

/**
 * One raw audit row from either source table. The service consumes only these
 * fields; every other column (tokens, signed URLs, storage keys, checksums,
 * authorization internals, authentication events) never crosses this boundary.
 */
export type OrderHistoryAuditRow = Readonly<{
  /** Stable source-row identifier; also the equal-timestamp tiebreaker. */
  id: string
  type: OrderHistoryEventType
  occurredAt: Date
  /** Actor identifier already cleared for display, or null when unknown. */
  actorId: string | null
  description: string
  attachment: Readonly<{ id: string; label: string }> | null
}>

export type OrderHistorySource = Readonly<{
  /** Merged audit rows for the order, unsorted and unpaged. */
  loadAuditRows: (orderId: string) => Promise<readonly OrderHistoryAuditRow[]>
  /** Order-view scope resolution; null means no scope row exists. */
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

export type OrderHistoryServiceContract = Readonly<{
  history: (
    actor: CommercialActor,
    input: unknown,
  ) => Promise<OrderHistoryServiceResult<OrderHistoryOutput>>
}>

/** Opaque keyset cursor: `occurredAt ISO|id`, base64url-encoded. */
function encodeCursor(event: OrderHistoryEvent): string {
  return Buffer.from(`${event.occurredAt}|${event.id}`, 'utf8').toString('base64url')
}

function decodeCursor(raw: string): { occurredAt: number; id: string } {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8')
  const separator = decoded.lastIndexOf('|')
  if (separator <= 0) throw new RangeError('cursor')
  const occurredAt = Date.parse(decoded.slice(0, separator))
  const id = decoded.slice(separator + 1)
  if (!Number.isFinite(occurredAt) || !id) throw new RangeError('cursor')
  return { occurredAt, id }
}

export function createOrderHistoryService(
  source: OrderHistorySource,
): OrderHistoryServiceContract {
  return Object.freeze({
    async history(actor, input) {
      const request = parseRequest(orderHistoryInputSchema, input)
      if (!request.ok) {
        return request as OrderHistoryServiceResult<never>
      }
      const query = request.data

      try {
        const access = await source.resolveResourceAccess(actor, query.id)
        if (!access.ok) return failure(access.error)

        // Re-check through the shared policy so direct service calls cannot
        // bypass RBAC: history is an order-view surface.
        const decision = authorizeCommercialAction(
          actor,
          'order.history.read',
          access.data.scope,
        )
        if (decision === 'forbidden' || decision === 'not_found') {
          return failure({ category: 'not-found' })
        }

        const rows = await source.loadAuditRows(query.id)
        // Allowlist gate: only event types in the published union may cross
        // the boundary, so authentication attempts and other internal audit
        // records can never leak into the timeline.
        const allowedTypes = new Set<string>(ORDER_HISTORY_EVENT_TYPES)
        const admissible = rows.filter((row) => allowedTypes.has(row.type))
        const direction = query.direction === 'asc' ? 1 : -1
        const sorted = admissible
          .slice()
          .sort(
            (left, right) =>
              (left.occurredAt.getTime() - right.occurredAt.getTime()) * direction ||
              left.id.localeCompare(right.id) * direction,
          )

        let start = 0
        if (query.cursor) {
          const cursor = decodeCursor(query.cursor)
          start = sorted.findIndex((row) => {
            const rowMs = row.occurredAt.getTime()
            if (direction === 1) {
              return rowMs > cursor.occurredAt || (rowMs === cursor.occurredAt && row.id > cursor.id)
            }
            return rowMs < cursor.occurredAt || (rowMs === cursor.occurredAt && row.id < cursor.id)
          })
          if (start === -1) start = sorted.length
        }

        const page = sorted.slice(start, start + query.limit)
        const events: OrderHistoryEvent[] = page.map((row) =>
          Object.freeze({
            id: row.id,
            type: row.type,
            occurredAt: row.occurredAt.toISOString(),
            description: row.description,
            actorId: row.actorId,
            attachment: row.attachment ? Object.freeze({ ...row.attachment }) : null,
          }),
        )
        const hasMore = start + query.limit < sorted.length
        const nextCursor = hasMore && events.length > 0
          ? encodeCursor(events[events.length - 1]!)
          : null
        return success(Object.freeze({ events, nextCursor }))
      } catch (cause) {
        if (cause instanceof RangeError) {
          return failure({
            category: 'validation',
            issues: [{ path: ['cursor'], message: 'Cursor inválido.' }],
          })
        }
        return failure(unexpected(cause))
      }
    },
  })
}
