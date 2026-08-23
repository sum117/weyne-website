import { createHash, randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import {
  createAttachmentPolicy,
  validateUploadDeclaration,
} from '@/lib/attachments/policy.server'
import {
  authorizeCommercialAction,
  type AuthorizationResult,
  type CommercialAction,
  type CommercialActor,
  type CommercialResourceScope,
} from './security-policy.server'

export type { CommercialActor } from './security-policy.server'

export interface PrivateObjectStore {
  put(key: string, body: Uint8Array, mimeType: string): Promise<void>
  get(key: string): Promise<Uint8Array>
  delete(key: string): Promise<void>
}

export type CommercialSecurityErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_ATTACHMENT'

export class CommercialSecurityError extends Error {
  readonly code: CommercialSecurityErrorCode

  constructor(code: CommercialSecurityErrorCode, message: string = code) {
    super(message)
    this.name = 'CommercialSecurityError'
    this.code = code
  }
}

type ResourceType = 'quote' | 'order'

type ScopeRow = {
  resourceType: ResourceType
  resourceId: string
  tenantId: string
  ownerUserId: string
  resourceStatus: string
  assignedUserIds: string[]
}

type AttachmentRow = {
  id: string
  orderId: string
  tenantId: string
  objectKey: string
  originalFilename: string
  mimeType: string
  sizeBytes: string
  checksumSha256: string
  createdAt: Date
  createdBy: string
}

export type OrderAttachment = Readonly<{
  id: string
  orderId: string
  objectKey: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string
  createdAt: Date
  createdBy: string
}>

const ORDER_ATTACHMENT_POLICY = createAttachmentPolicy({
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  maxSizeBytes: 25 * 1024 * 1024,
})

export function createPostgresCommercialSecurityService(options: {
  readonly sql: Sql
  readonly schemaName: string
  readonly storage: PrivateObjectStore
}) {
  const { sql, storage } = options
  if (!/^[a-z_][a-z0-9_]*$/i.test(options.schemaName)) {
    throw new Error(`Invalid PostgreSQL schema name: ${options.schemaName}`)
  }
  const quotedSchema = `"${options.schemaName}"`

  async function transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
    return sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO ${quotedSchema}, public`)
      return work(tx as unknown as Sql)
    }) as Promise<T>
  }

  async function writeAudit(
    tx: Sql,
    input: Readonly<{
      actor: CommercialActor
      targetType: 'quote' | 'order' | 'order_attachment'
      targetId: string
      action: string
      outcome: 'allowed' | 'forbidden' | 'not_found'
      metadata?: Readonly<Record<string, string | number | boolean | null>>
    }>,
  ): Promise<void> {
    await tx`
      INSERT INTO commercial_security_audit (
        tenant_id, actor_id, actor_role, target_type, target_id,
        action, outcome, metadata
      ) VALUES (
        ${input.actor.tenantId}::uuid,
        ${input.actor.id},
        ${input.actor.role},
        ${input.targetType},
        ${input.targetId}::uuid,
        ${input.action},
        ${input.outcome},
        ${tx.json(input.metadata ?? {})}
      )
    `
  }

  async function getScope(
    tx: Sql,
    resourceType: ResourceType,
    resourceId: string,
    lock = false,
  ) {
    const rows = await tx.unsafe<Omit<ScopeRow, 'assignedUserIds'>[]>(
      `
      SELECT
        resource_type AS "resourceType", resource_id::text AS "resourceId",
        tenant_id::text AS "tenantId", owner_user_id AS "ownerUserId",
        resource_status AS "resourceStatus"
      FROM commercial_resource_scopes
      WHERE resource_type = $1 AND resource_id = $2::uuid
      ${lock ? 'FOR UPDATE' : ''}`,
      [resourceType, resourceId],
    )
    const scope = rows[0]
    if (!scope) return null
    const assignments = await tx<{ userId: string }[]>`
      SELECT user_id AS "userId"
      FROM commercial_resource_assignments
      WHERE resource_type = ${resourceType} AND resource_id = ${resourceId}::uuid
      ORDER BY user_id
    `
    return { ...scope, assignedUserIds: assignments.map((row) => row.userId) }
  }

  function asPolicyScope(scope: ScopeRow): CommercialResourceScope {
    return {
      tenantId: scope.tenantId,
      ownerUserId: scope.ownerUserId,
      assignedUserIds: scope.assignedUserIds,
      status: scope.resourceStatus,
    }
  }

  async function authorizeResource(
    actor: CommercialActor,
    action: CommercialAction,
    resourceType: ResourceType,
    resourceId: string,
    context: Readonly<{ attachmentCreatedBy?: string }> = {},
  ): Promise<{ scope: ScopeRow; authorization: AuthorizationResult }> {
    const expectedType = action.startsWith('quote.') ? 'quote' : 'order'
    if (resourceType !== expectedType) {
      throw new Error(`Action ${action} cannot target ${resourceType}`)
    }
    const scope = await transaction((tx) => getScope(tx, resourceType, resourceId))
    if (!scope) {
      await transaction((tx) =>
        writeAudit(tx, {
          actor,
          targetType: resourceType,
          targetId: resourceId,
          action,
          outcome: 'not_found',
        }),
      )
      throw new CommercialSecurityError('NOT_FOUND')
    }

    const authorization = authorizeCommercialAction(
      actor,
      action,
      asPolicyScope(scope),
      context,
    )
    if (authorization === 'not_found' || authorization === 'forbidden') {
      await transaction((tx) =>
        writeAudit(tx, {
          actor,
          targetType: resourceType,
          targetId: resourceId,
          action,
          outcome: authorization,
        }),
      )
      throw new CommercialSecurityError(
        authorization === 'not_found' ? 'NOT_FOUND' : 'FORBIDDEN',
      )
    }

    return { scope, authorization }
  }

  async function recheckAuthorized(
    tx: Sql,
    actor: CommercialActor,
    action: CommercialAction,
    resourceType: ResourceType,
    resourceId: string,
    context: Readonly<{ attachmentCreatedBy?: string }> = {},
  ): Promise<ScopeRow> {
    const scope = await getScope(tx, resourceType, resourceId, true)
    if (!scope) throw new CommercialSecurityError('NOT_FOUND')
    const result = authorizeCommercialAction(actor, action, asPolicyScope(scope), context)
    if (result === 'not_found' || result === 'forbidden') {
      throw new CommercialSecurityError(result === 'not_found' ? 'NOT_FOUND' : 'FORBIDDEN')
    }
    return scope
  }

  async function getAttachmentInTransaction(
    tx: Sql,
    attachmentId: string,
  ): Promise<AttachmentRow | null> {
      const rows = await tx<AttachmentRow[]>`
        SELECT id::text AS id, order_id::text AS "orderId",
               tenant_id::text AS "tenantId", object_key AS "objectKey",
               original_filename AS "originalFilename", mime_type AS "mimeType",
               size_bytes::text AS "sizeBytes", checksum_sha256 AS "checksumSha256",
               created_at AS "createdAt", created_by AS "createdBy"
        FROM secure_order_attachments
        WHERE id = ${attachmentId}::uuid AND deleted_at IS NULL
      `
      return rows[0] ?? null
  }

  async function getAttachment(attachmentId: string): Promise<AttachmentRow | null> {
    return transaction((tx) => getAttachmentInTransaction(tx, attachmentId))
  }

  function publicAttachment(row: AttachmentRow): OrderAttachment {
    return Object.freeze({
      id: row.id,
      orderId: row.orderId,
      objectKey: row.objectKey,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      checksumSha256: row.checksumSha256,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    })
  }

  return {
    async registerResource(input: Readonly<{
      resourceType: ResourceType
      resourceId: string
      tenantId: string
      ownerUserId: string
      status: string
      assignedUserIds: readonly string[]
    }>): Promise<void> {
      await transaction(async (tx) => {
        await tx`
          INSERT INTO commercial_resource_scopes (
            resource_type, resource_id, tenant_id, owner_user_id, resource_status
          ) VALUES (
            ${input.resourceType}, ${input.resourceId}::uuid, ${input.tenantId}::uuid,
            ${input.ownerUserId}, ${input.status}
          )
          ON CONFLICT (resource_type, resource_id) DO UPDATE
          SET tenant_id = EXCLUDED.tenant_id,
              owner_user_id = EXCLUDED.owner_user_id,
              resource_status = EXCLUDED.resource_status,
              updated_at = date_trunc('milliseconds', clock_timestamp())
        `
        await tx`
          DELETE FROM commercial_resource_assignments
          WHERE resource_type = ${input.resourceType}
            AND resource_id = ${input.resourceId}::uuid
        `
        for (const userId of [...new Set(input.assignedUserIds)]) {
          await tx`
            INSERT INTO commercial_resource_assignments (resource_type, resource_id, user_id)
            VALUES (${input.resourceType}, ${input.resourceId}::uuid, ${userId})
          `
        }
      })
    },

    async readResource(
      actor: CommercialActor,
      resourceType: ResourceType,
      resourceId: string,
    ) {
      const action = resourceType === 'quote' ? 'quote.read' : 'order.read'
      const result = await authorizeResource(actor, action, resourceType, resourceId)
      await transaction((tx) =>
        writeAudit(tx, {
          actor,
          targetType: resourceType,
          targetId: resourceId,
          action,
          outcome: 'allowed',
          metadata: { authorization: result.authorization },
        }),
      )
      return Object.freeze({
        resourceType,
        resourceId,
        status: result.scope.resourceStatus,
        authorization: result.authorization,
      })
    },

    async checkMutationAccess(
      actor: CommercialActor,
      action: Extract<CommercialAction, 'quote.approve' | 'order.confirm'>,
      resourceType: ResourceType,
      resourceId: string,
    ): Promise<void> {
      await authorizeResource(actor, action, resourceType, resourceId)
    },

    async uploadOrderAttachment(
      actor: CommercialActor,
      orderId: string,
      input: Readonly<{
        originalFilename: string
        mimeType: string
        sizeBytes: number
        checksumSha256: string
        body: Uint8Array
      }>,
    ): Promise<OrderAttachment> {
      await authorizeResource(actor, 'order.attachment.upload', 'order', orderId)
      const declaration = validateUploadDeclaration(ORDER_ATTACHMENT_POLICY, input)
      const actualChecksum = createHash('sha256').update(input.body).digest('base64')
      if (
        input.body.byteLength !== declaration.sizeBytes ||
        actualChecksum !== declaration.checksumSha256
      ) {
        throw new CommercialSecurityError(
          'INVALID_ATTACHMENT',
          'Attachment body does not match its declared size and checksum',
        )
      }
      const originalFilename = input.originalFilename.trim()
      if (!originalFilename || originalFilename.length > 255) {
        throw new CommercialSecurityError('INVALID_ATTACHMENT', 'Invalid attachment filename')
      }

      const objectKey = `order-attachments/${actor.tenantId}/${orderId}/${randomUUID()}`
      await storage.put(objectKey, input.body, declaration.mimeType)
      try {
        return await transaction(async (tx) => {
          await recheckAuthorized(
            tx,
            actor,
            'order.attachment.upload',
            'order',
            orderId,
          )
          const rows = await tx<AttachmentRow[]>`
            INSERT INTO secure_order_attachments (
              order_id, tenant_id, object_key, original_filename, mime_type,
              size_bytes, checksum_sha256, created_by
            ) VALUES (
              ${orderId}::uuid, ${actor.tenantId}::uuid, ${objectKey},
              ${originalFilename}, ${declaration.mimeType}, ${declaration.sizeBytes},
              ${declaration.checksumSha256}, ${actor.id}
            )
            RETURNING id::text AS id, order_id::text AS "orderId",
                      tenant_id::text AS "tenantId", object_key AS "objectKey",
                      original_filename AS "originalFilename", mime_type AS "mimeType",
                      size_bytes::text AS "sizeBytes", checksum_sha256 AS "checksumSha256",
                      created_at AS "createdAt", created_by AS "createdBy"
          `
          const row = rows[0]!
          await writeAudit(tx, {
            actor,
            targetType: 'order',
            targetId: orderId,
            action: 'order.attachment.upload',
            outcome: 'allowed',
            metadata: { attachmentId: row.id },
          })
          return publicAttachment(row)
        })
      } catch (error) {
        await storage.delete(objectKey)
        throw error
      }
    },

    async listOrderAttachments(
      actor: CommercialActor,
      orderId: string,
    ): Promise<readonly OrderAttachment[]> {
      await authorizeResource(actor, 'order.attachment.list', 'order', orderId)
      return transaction(async (tx) => {
        await recheckAuthorized(tx, actor, 'order.attachment.list', 'order', orderId)
        const rows = await tx<AttachmentRow[]>`
          SELECT id::text AS id, order_id::text AS "orderId",
                 tenant_id::text AS "tenantId", object_key AS "objectKey",
                 original_filename AS "originalFilename", mime_type AS "mimeType",
                 size_bytes::text AS "sizeBytes", checksum_sha256 AS "checksumSha256",
                 created_at AS "createdAt", created_by AS "createdBy"
          FROM secure_order_attachments
          WHERE order_id = ${orderId}::uuid
            AND tenant_id = ${actor.tenantId}::uuid
            AND deleted_at IS NULL
          ORDER BY created_at, id
        `
        await writeAudit(tx, {
          actor,
          targetType: 'order',
          targetId: orderId,
          action: 'order.attachment.list',
          outcome: 'allowed',
          metadata: { count: rows.length },
        })
        return Object.freeze(rows.map(publicAttachment))
      })
    },

    async downloadOrderAttachment(
      actor: CommercialActor,
      orderId: string,
      attachmentId: string,
    ): Promise<Uint8Array> {
      await authorizeResource(actor, 'order.attachment.download', 'order', orderId)
      const result = await transaction(async (tx) => {
        await recheckAuthorized(tx, actor, 'order.attachment.download', 'order', orderId)
        const attachment = await getAttachmentInTransaction(tx, attachmentId)
        if (
          !attachment ||
          attachment.orderId !== orderId ||
          attachment.tenantId !== actor.tenantId
        ) {
          await writeAudit(tx, {
            actor,
            targetType: 'order_attachment',
            targetId: attachmentId,
            action: 'order.attachment.download',
            outcome: 'not_found',
          })
          return null
        }
        const body = await storage.get(attachment.objectKey)
        await writeAudit(tx, {
          actor,
          targetType: 'order_attachment',
          targetId: attachmentId,
          action: 'order.attachment.download',
          outcome: 'allowed',
          metadata: { orderId },
        })
        return body
      })
      if (!result) throw new CommercialSecurityError('NOT_FOUND')
      return result
    },

    async deleteOrderAttachment(
      actor: CommercialActor,
      orderId: string,
      attachmentId: string,
    ): Promise<void> {
      const attachment = await getAttachment(attachmentId)
      if (!attachment || attachment.orderId !== orderId) {
        throw new CommercialSecurityError('NOT_FOUND')
      }
      await authorizeResource(actor, 'order.attachment.delete', 'order', orderId, {
        attachmentCreatedBy: attachment.createdBy,
      })
      if (attachment.tenantId !== actor.tenantId) {
        throw new CommercialSecurityError('NOT_FOUND')
      }

      await transaction(async (tx) => {
        const current = await getAttachmentInTransaction(tx, attachmentId)
        if (!current || current.orderId !== orderId || current.tenantId !== actor.tenantId) {
          throw new CommercialSecurityError('NOT_FOUND')
        }
        await recheckAuthorized(tx, actor, 'order.attachment.delete', 'order', orderId, {
          attachmentCreatedBy: current.createdBy,
        })
        await storage.delete(current.objectKey)
        const updated = await tx<{ id: string }[]>`
          UPDATE secure_order_attachments
          SET deleted_at = date_trunc('milliseconds', clock_timestamp()), deleted_by = ${actor.id}
          WHERE id = ${attachmentId}::uuid
            AND order_id = ${orderId}::uuid
            AND tenant_id = ${actor.tenantId}::uuid
            AND deleted_at IS NULL
          RETURNING id::text AS id
        `
        if (!updated[0]) throw new CommercialSecurityError('NOT_FOUND')
        await writeAudit(tx, {
          actor,
          targetType: 'order_attachment',
          targetId: attachmentId,
          action: 'order.attachment.delete',
          outcome: 'allowed',
          metadata: { orderId },
        })
      })
    },
  }
}
