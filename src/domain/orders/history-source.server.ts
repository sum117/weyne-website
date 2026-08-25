import { sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '@/lib/db/schema'
import { orderAttachmentAudit } from '@/lib/db/schema'
import { orderStateAudit } from '@/lib/db/schema'
import type { OrderHistoryAuditRow } from './history-service.server'
import type { OrderHistoryEventType } from './contracts'

type Database = PostgresJsDatabase<typeof schema>

/**
 * Allowlisted lifecycle event mapping. Any future `order_state_audit` variant
 * must be added here explicitly or it is dropped from the timeline — unknown
 * rows can never leak into the API.
 */
const LIFECYCLE_EVENT_BY_TRANSITION = {
  created: 'order.created',
  transitioned: 'order.status_changed',
} as const

interface LifecycleRow {
  id: string
  kind: 'created' | 'transitioned'
  actor: string
  reason: string
  occurredAt: Date
}

interface AttachmentRow {
  id: string
  attachmentId: string
  eventType: string
  actorId: string
  label: string
  occurredAt: Date
}

function lifecycleDescription(row: LifecycleRow): string {
  return row.kind === 'created'
    ? `Pedido criado: ${row.reason}`
    : `Situação do pedido atualizada: ${row.reason}`
}

function attachmentDescription(row: AttachmentRow): string {
  return row.eventType === 'order.attachment.uploaded'
    ? `Anexo enviado: ${row.label}`
    : `Anexo excluído: ${row.label}`
}

/**
 * Read-only aggregation over the two append-only audit tables. No writes, no
 * joins into mutable order data, and only allowlisted columns are selected.
 */
export function createPostgresOrderHistorySource(database: Database) {
  return {
    async loadAuditRows(orderId: string): Promise<readonly OrderHistoryAuditRow[]> {
      const [lifecycleRows, attachmentRows] = await Promise.all([
        database
          .select({
            id: sql<string>`${orderStateAudit.id}::text`,
            kind: sql<string>`CASE WHEN ${orderStateAudit.fromStatus} IS NULL THEN 'created' ELSE 'transitioned' END`,
            actor: orderStateAudit.actor,
            reason: orderStateAudit.reason,
            occurredAt: orderStateAudit.occurredAt,
          })
          .from(orderStateAudit)
          .where(sql`${orderStateAudit.orderId} = ${orderId}::uuid`),
        database
          .select({
            id: sql<string>`${orderAttachmentAudit.id}::text`,
            attachmentId: sql<string>`${orderAttachmentAudit.attachmentId}::text`,
            eventType: orderAttachmentAudit.eventType,
            actorId: sql<string>`${orderAttachmentAudit.actorId}::text`,
            label: orderAttachmentAudit.label,
            occurredAt: orderAttachmentAudit.occurredAt,
          })
          .from(orderAttachmentAudit)
          .where(
            sql`${orderAttachmentAudit.orderId} = ${orderId}::uuid
              AND ${orderAttachmentAudit.eventType} IN ('order.attachment.uploaded', 'order.attachment.deleted')`,
          ),
      ])

      const rows: OrderHistoryAuditRow[] = []
      for (const row of lifecycleRows as unknown as LifecycleRow[]) {
        const type = LIFECYCLE_EVENT_BY_TRANSITION[
          row.kind as keyof typeof LIFECYCLE_EVENT_BY_TRANSITION
        ]
        // Unknown kinds are dropped, never surfaced.
        if (!type) continue
        rows.push(freezeRow(row.id, type, row.occurredAt, row.actor, lifecycleDescription(row), null))
      }
      for (const row of attachmentRows) {
        const type: OrderHistoryEventType =
          row.eventType === 'order.attachment.uploaded'
            ? 'order.attachment.uploaded'
            : 'order.attachment.deleted'
        rows.push(
          freezeRow(
            row.id,
            type,
            row.occurredAt,
            row.actorId,
            attachmentDescription(row),
            { id: row.attachmentId, label: row.label },
          ),
        )
      }
      return Object.freeze(rows)
    },
  }
}

function freezeRow(
  id: string,
  type: OrderHistoryEventType,
  occurredAt: Date,
  actorId: string | null,
  description: string,
  attachment: Readonly<{ id: string; label: string }> | null,
): OrderHistoryAuditRow {
  return Object.freeze({
    id,
    type,
    occurredAt,
    actorId: actorId && actorId.trim() ? actorId : null,
    description,
    attachment,
  })
}
