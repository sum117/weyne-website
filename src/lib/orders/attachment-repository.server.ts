import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '@/lib/db/schema'
import { orderAttachments, orders } from '@/lib/db/schema'
import type {
  AttachmentOrder,
  AttachmentRepository,
  OrderAttachment,
} from './attachments.server'

type Database = PostgresJsDatabase<typeof schema>
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * PostgreSQL persistence for order attachment metadata. Order rows are locked
 * per operation so concurrent uploads/deletes serialize on the order, matching
 * the in-memory reference repository's `withOrderLock` semantics. Object keys
 * and idempotency bookkeeping never leave this layer unprojected.
 */
export function createPostgresAttachmentRepository(
  database: Database,
): AttachmentRepository {
  async function loadAttachmentOrder(
    tx: Transaction,
    orderId: string,
    lock: boolean,
  ): Promise<AttachmentOrder | null> {
    const base = tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
    const [orderRow] = await (lock ? base.for('update') : base)
    if (!orderRow) return null

    // Ownership/assignment lives in the shared commercial RBAC tables, the
    // same source the order read paths use.
    const scopeRows = await tx
      .select({ ownerUserId: sql<string>`s.owner_user_id` })
      .from(sql`commercial_resource_scopes s`)
      .where(
        sql`s.resource_type = 'order' AND s.resource_id = ${orderId}::uuid LIMIT 1`,
      )
    const assignmentRows = await tx
      .select({ userId: sql<string>`a.user_id` })
      .from(sql`commercial_resource_assignments a`)
      .where(
        sql`a.resource_type = 'order' AND a.resource_id = ${orderId}::uuid`,
      )

    return {
      id: orderRow.id,
      status: mapStatus(orderRow.status),
      ownerUserId: scopeRows[0]?.ownerUserId ?? '',
      assignedUserIds: assignmentRows.map((row) => row.userId),
    }
  }

  function mapRow(row: typeof orderAttachments.$inferSelect): OrderAttachment {
    return {
      id: row.id,
      orderId: row.orderId,
      label: row.label,
      originalFilename: row.originalFilename,
      objectKey: row.objectKey,
      sizeBytes: row.sizeBytes,
      validatedMimeType: row.validatedMimeType,
      checksumSha256: row.checksumSha256,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedBy: row.deletedBy,
      deletedAt: row.deletedAt,
      state: row.state as OrderAttachment['state'],
      idempotencyKey: row.idempotencyKey,
      payloadHash: row.payloadHash,
      deleteIdempotencyKey: row.deleteIdempotencyKey,
    }
  }

  return Object.freeze({
    async withOrderLock<T>(orderId: string, work: () => Promise<T>): Promise<T> {
      return database.transaction(async (tx) => {
        // Take the order-row lock first so every mutation for one order
        // serializes exactly like the reference implementation's mutex.
        await tx
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1)
          .for('update')
        return work()
      })
    },

    async findOrder(orderId: string) {
      return database.transaction((tx) => loadAttachmentOrder(tx, orderId, false))
    },

    async findById(orderId: string, attachmentId: string) {
      const [row] = await database
        .select()
        .from(orderAttachments)
        .where(
          and(
            eq(orderAttachments.id, attachmentId),
            eq(orderAttachments.orderId, orderId),
          ),
        )
        .limit(1)
      return row ? mapRow(row) : null
    },

    async findByIdempotency(orderId: string, actorId: string, idempotencyKey: string) {
      const [row] = await database
        .select()
        .from(orderAttachments)
        .where(
          and(
            eq(orderAttachments.orderId, orderId),
            eq(orderAttachments.createdBy, actorId),
            eq(orderAttachments.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1)
      return row ? mapRow(row) : null
    },

    async listActive(orderId: string) {
      const rows = await database
        .select()
        .from(orderAttachments)
        .where(
          and(
            eq(orderAttachments.orderId, orderId),
            eq(orderAttachments.state, 'ready'),
          ),
        )
      return rows
        .map(mapRow)
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.id.localeCompare(left.id),
        )
    },

    async countActive(orderId: string) {
      const rows = await database
        .select({ count: sql<number>`count(*)::int` })
        .from(orderAttachments)
        .where(
          and(
            eq(orderAttachments.orderId, orderId),
            inArray(orderAttachments.state, ['pending', 'ready', 'deleting']),
          ),
        )
      return rows[0]?.count ?? 0
    },

    async insert(attachment: OrderAttachment): Promise<void> {
      await database.insert(orderAttachments).values({
        id: attachment.id,
        orderId: attachment.orderId,
        label: attachment.label,
        originalFilename: attachment.originalFilename,
        objectKey: attachment.objectKey,
        sizeBytes: attachment.sizeBytes,
        validatedMimeType: attachment.validatedMimeType,
        checksumSha256: attachment.checksumSha256,
        createdBy: attachment.createdBy,
        createdAt: attachment.createdAt,
        updatedAt: attachment.updatedAt,
        deletedBy: attachment.deletedBy,
        deletedAt: attachment.deletedAt,
        state: attachment.state,
        idempotencyKey: attachment.idempotencyKey,
        payloadHash: attachment.payloadHash,
        deleteIdempotencyKey: attachment.deleteIdempotencyKey,
      })
    },

    async update(
      attachmentId: string,
      patch: Partial<
        Pick<
          OrderAttachment,
          'state' | 'updatedAt' | 'deletedAt' | 'deletedBy' | 'deleteIdempotencyKey'
        >
      >,
    ) {
      const [row] = await database
        .update(orderAttachments)
        .set(patch)
        .where(eq(orderAttachments.id, attachmentId))
        .returning()
      if (!row) {
        throw new Error(`Attachment not found for update: ${attachmentId}`)
      }
      return mapRow(row)
    },
  })
}

function mapStatus(status: string): AttachmentOrder['status'] {
  switch (status) {
    case 'confirmed':
    case 'invoiced':
    case 'completed':
    case 'cancelled':
      return status
    default:
      return 'open'
  }
}
