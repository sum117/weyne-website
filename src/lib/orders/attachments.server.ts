import { createHash, randomUUID } from 'node:crypto'
import { createAttachmentObjectKey } from '@/lib/attachments/policy.server'

export const ORDER_ATTACHMENT_STATES = [
  'pending',
  'ready',
  'deleting',
  'deleted',
  'failed',
] as const

export type OrderAttachmentState = (typeof ORDER_ATTACHMENT_STATES)[number]
export type AttachmentRole = 'admin' | 'representative' | 'read_only'
export type AttachmentOperation = 'upload' | 'download' | 'delete'

export type AttachmentApiErrorCode =
  | 'ATTACHMENT_LIMIT_REACHED'
  | 'ATTACHMENT_NOT_READY'
  | 'CHECKSUM_MISMATCH'
  | 'DECLARATION_MISMATCH'
  | 'DISALLOWED_FILE_TYPE'
  | 'FILE_SIGNATURE_MISMATCH'
  | 'FILE_TOO_LARGE'
  | 'FORBIDDEN'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_REQUEST'
  | 'INVALID_STATE'
  | 'NOT_FOUND'
  | 'STORAGE_INTEGRITY_FAILED'

export class AttachmentApiError extends Error {
  readonly code: AttachmentApiErrorCode

  constructor(code: AttachmentApiErrorCode, message = code) {
    super(message)
    this.name = 'AttachmentApiError'
    this.code = code
  }
}

export interface AttachmentActor {
  readonly id: string
  readonly role: AttachmentRole
}

export interface AttachmentOrder {
  readonly id: string
  readonly ownerUserId: string
  readonly assignedUserIds: readonly string[]
  readonly status: 'open' | 'confirmed' | 'invoiced' | 'completed' | 'cancelled'
}

export interface OrderAttachment {
  readonly id: string
  readonly orderId: string
  readonly label: string
  readonly originalFilename: string
  readonly objectKey: string
  readonly sizeBytes: number
  readonly validatedMimeType: string
  readonly checksumSha256: string
  readonly createdBy: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly deletedBy: string | null
  readonly deletedAt: Date | null
  readonly state: OrderAttachmentState
  readonly idempotencyKey: string
  readonly payloadHash: string
  readonly deleteIdempotencyKey: string | null
}

export type PublicOrderAttachment = Omit<
  OrderAttachment,
  | 'objectKey'
  | 'idempotencyKey'
  | 'payloadHash'
  | 'deleteIdempotencyKey'
>

/** The only attachment metadata shape safe to serialize to UI consumers. */
export function toPublicOrderAttachment(
  attachment: OrderAttachment,
): PublicOrderAttachment {
  const {
    objectKey: _objectKey,
    idempotencyKey: _idempotencyKey,
    payloadHash: _payloadHash,
    deleteIdempotencyKey: _deleteIdempotencyKey,
    ...publicMetadata
  } = attachment
  return publicMetadata
}

export interface AttachmentAuditEvent {
  readonly eventType: 'order.attachment.uploaded' | 'order.attachment.deleted'
  readonly orderId: string
  readonly attachmentId: string
  readonly actorId: string
  readonly occurredAt: Date
  readonly label: string
}

export interface AttachmentAuditSink {
  append(event: AttachmentAuditEvent): Promise<void>
}

export interface PrivateAttachmentStorage {
  put(input: {
    key: string
    bytes: Uint8Array
    validatedMimeType: string
    checksumSha256: string
  }): Promise<{ sizeBytes: number; checksumSha256: string }>
  get(key: string): Promise<Uint8Array | null>
  delete(key: string): Promise<void>
}

export interface AttachmentRepository {
  withOrderLock<T>(orderId: string, work: () => Promise<T>): Promise<T>
  findOrder(orderId: string): Promise<AttachmentOrder | null>
  findById(orderId: string, attachmentId: string): Promise<OrderAttachment | null>
  findByIdempotency(
    orderId: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<OrderAttachment | null>
  listActive(orderId: string): Promise<readonly OrderAttachment[]>
  countActive(orderId: string): Promise<number>
  insert(attachment: OrderAttachment): Promise<void>
  update(
    attachmentId: string,
    patch: Partial<Pick<OrderAttachment, 'state' | 'updatedAt' | 'deletedAt' | 'deletedBy' | 'deleteIdempotencyKey'>>,
  ): Promise<OrderAttachment>
}

export type OrderAttachmentPolicy = Readonly<{
  allowedMimeTypes: readonly string[]
  maxFilesPerOrder: number
  maxSizeBytes: number
}>

const SIGNATURE_VALIDATORS: Readonly<
  Record<string, (bytes: Uint8Array) => boolean>
> = {
  'application/pdf': (bytes) => startsWithAscii(bytes, '%PDF-'),
  'image/png': (bytes) =>
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (bytes) =>
    bytes.byteLength >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9,
}

export function createOrderAttachmentService(options: {
  repository: AttachmentRepository
  storage: PrivateAttachmentStorage
  audit: AttachmentAuditSink
  policy: OrderAttachmentPolicy
  now?: () => Date
}) {
  const policy = validatePolicy(options.policy)
  const now = options.now ?? (() => new Date())

  return {
    async list(input: {
      actor: AttachmentActor
      orderId: string
    }): Promise<readonly OrderAttachment[]> {
      await requireAuthorizedOrder(
        options.repository,
        input.actor,
        input.orderId,
        'download',
      )
      return options.repository.listActive(input.orderId)
    },

    async upload(input: {
      actor: AttachmentActor
      orderId: string
      idempotencyKey: string
      label: string
      originalFilename: string
      declaredMimeType: string
      declaredSizeBytes: number
      declaredChecksumSha256: string
      bytes: Uint8Array
    }): Promise<OrderAttachment> {
      const declaration = validateUploadInput(input, policy)
      const payloadHash = hashPayload({
        orderId: input.orderId,
        label: declaration.label,
        originalFilename: declaration.originalFilename,
        mimeType: declaration.mimeType,
        sizeBytes: declaration.sizeBytes,
        checksumSha256: declaration.checksumSha256,
      })

      return options.repository.withOrderLock(input.orderId, async () => {
        const order = await requireAuthorizedOrder(
          options.repository,
          input.actor,
          input.orderId,
          'upload',
        )
        requireUploadState(order, input.actor)

        const previous = await options.repository.findByIdempotency(
          order.id,
          input.actor.id,
          declaration.idempotencyKey,
        )
        if (previous) {
          if (previous.payloadHash !== payloadHash) {
            throw new AttachmentApiError('IDEMPOTENCY_KEY_REUSED')
          }
          if (previous.state === 'ready') return previous
          throw new AttachmentApiError('ATTACHMENT_NOT_READY')
        }

        if ((await options.repository.countActive(order.id)) >= policy.maxFilesPerOrder) {
          throw new AttachmentApiError('ATTACHMENT_LIMIT_REACHED')
        }

        const timestamp = now()
        const attachment: OrderAttachment = {
          id: randomUUID(),
          orderId: order.id,
          label: declaration.label,
          originalFilename: declaration.originalFilename,
          objectKey: createAttachmentObjectKey({ scopeId: order.id }),
          sizeBytes: declaration.sizeBytes,
          validatedMimeType: declaration.mimeType,
          checksumSha256: declaration.checksumSha256,
          createdBy: input.actor.id,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedBy: null,
          deletedAt: null,
          state: 'pending',
          idempotencyKey: declaration.idempotencyKey,
          payloadHash,
          deleteIdempotencyKey: null,
        }
        await options.repository.insert(attachment)

        try {
          const stored = await options.storage.put({
            key: attachment.objectKey,
            bytes: input.bytes,
            validatedMimeType: attachment.validatedMimeType,
            checksumSha256: attachment.checksumSha256,
          })
          if (
            stored.sizeBytes !== attachment.sizeBytes ||
            stored.checksumSha256 !== attachment.checksumSha256
          ) {
            throw new AttachmentApiError('STORAGE_INTEGRITY_FAILED')
          }

          const ready = await options.repository.update(attachment.id, {
            state: 'ready',
            updatedAt: now(),
          })
          await options.audit.append(toAuditEvent('order.attachment.uploaded', ready, input.actor, now()))
          return ready
        } catch (error) {
          try {
            await options.storage.delete(attachment.objectKey)
          } finally {
            await options.repository.update(attachment.id, {
              state: 'failed',
              updatedAt: now(),
            })
          }
          if (error instanceof AttachmentApiError) throw error
          throw new AttachmentApiError('STORAGE_INTEGRITY_FAILED')
        }
      })
    },

    async download(input: {
      actor: AttachmentActor
      orderId: string
      attachmentId: string
    }): Promise<{
      attachment: OrderAttachment
      bytes: Uint8Array
      checksumSha256: string
    }> {
      await requireAuthorizedOrder(
        options.repository,
        input.actor,
        input.orderId,
        'download',
      )
      const attachment = await requireAttachment(
        options.repository,
        input.orderId,
        input.attachmentId,
      )
      if (attachment.state !== 'ready') {
        throw new AttachmentApiError('ATTACHMENT_NOT_READY')
      }

      const bytes = await options.storage.get(attachment.objectKey)
      if (!bytes) throw new AttachmentApiError('ATTACHMENT_NOT_READY')
      const checksumSha256 = sha256(bytes)
      if (
        bytes.byteLength !== attachment.sizeBytes ||
        checksumSha256 !== attachment.checksumSha256
      ) {
        throw new AttachmentApiError('STORAGE_INTEGRITY_FAILED')
      }
      return { attachment, bytes, checksumSha256 }
    },

    async delete(input: {
      actor: AttachmentActor
      orderId: string
      attachmentId: string
      idempotencyKey: string
    }): Promise<OrderAttachment> {
      if (!input.idempotencyKey.trim()) {
        throw new AttachmentApiError('IDEMPOTENCY_KEY_REQUIRED')
      }

      return options.repository.withOrderLock(input.orderId, async () => {
        const order = await requireAuthorizedOrder(
          options.repository,
          input.actor,
          input.orderId,
          'delete',
        )
        const attachment = await requireAttachment(
          options.repository,
          input.orderId,
          input.attachmentId,
        )
        requireDeleteState(order, attachment, input.actor)

        if (attachment.state === 'deleted') {
          if (attachment.deleteIdempotencyKey !== input.idempotencyKey) {
            throw new AttachmentApiError('IDEMPOTENCY_KEY_REUSED')
          }
          return attachment
        }
        if (attachment.state !== 'ready' && attachment.state !== 'deleting') {
          throw new AttachmentApiError('ATTACHMENT_NOT_READY')
        }
        if (
          attachment.deleteIdempotencyKey !== null &&
          attachment.deleteIdempotencyKey !== input.idempotencyKey
        ) {
          throw new AttachmentApiError('IDEMPOTENCY_KEY_REUSED')
        }

        const deleting = await options.repository.update(attachment.id, {
          state: 'deleting',
          deleteIdempotencyKey: input.idempotencyKey,
          updatedAt: now(),
        })
        await options.storage.delete(deleting.objectKey)
        const timestamp = now()
        const deleted = await options.repository.update(attachment.id, {
          state: 'deleted',
          deletedAt: timestamp,
          deletedBy: input.actor.id,
          updatedAt: timestamp,
        })
        await options.audit.append(
          toAuditEvent('order.attachment.deleted', deleted, input.actor, timestamp),
        )
        return deleted
      })
    },
  }
}

async function requireAuthorizedOrder(
  repository: AttachmentRepository,
  actor: AttachmentActor,
  orderId: string,
  operation: AttachmentOperation,
): Promise<AttachmentOrder> {
  const order = await repository.findOrder(orderId)
  if (!order) throw new AttachmentApiError('NOT_FOUND')
  if (actor.role === 'admin') return order

  const inScope =
    order.ownerUserId === actor.id || order.assignedUserIds.includes(actor.id)
  if (!inScope) throw new AttachmentApiError('NOT_FOUND')
  if (actor.role === 'read_only') throw new AttachmentApiError('FORBIDDEN')

  // Deliberately evaluated per operation; do not replace with a single coarse "can access" check.
  if (!['upload', 'download', 'delete'].includes(operation)) {
    throw new AttachmentApiError('FORBIDDEN')
  }
  return order
}

function requireUploadState(order: AttachmentOrder, actor: AttachmentActor): void {
  const allowed =
    actor.role === 'admin'
      ? order.status === 'open' || order.status === 'confirmed'
      : order.status === 'open' || order.status === 'confirmed'
  if (!allowed) throw new AttachmentApiError('INVALID_STATE')
}

function requireDeleteState(
  order: AttachmentOrder,
  attachment: OrderAttachment,
  actor: AttachmentActor,
): void {
  const stateAllowed =
    actor.role === 'admin'
      ? order.status === 'open' || order.status === 'confirmed'
      : order.status === 'open'
  if (!stateAllowed) throw new AttachmentApiError('INVALID_STATE')
  if (actor.role === 'representative' && attachment.createdBy !== actor.id) {
    throw new AttachmentApiError('FORBIDDEN')
  }
}

async function requireAttachment(
  repository: AttachmentRepository,
  orderId: string,
  attachmentId: string,
): Promise<OrderAttachment> {
  const attachment = await repository.findById(orderId, attachmentId)
  if (!attachment) throw new AttachmentApiError('NOT_FOUND')
  return attachment
}

function validatePolicy(policy: OrderAttachmentPolicy): OrderAttachmentPolicy {
  if (
    !Number.isSafeInteger(policy.maxFilesPerOrder) ||
    policy.maxFilesPerOrder < 1 ||
    !Number.isSafeInteger(policy.maxSizeBytes) ||
    policy.maxSizeBytes < 1
  ) {
    throw new AttachmentApiError('INVALID_REQUEST')
  }
  const allowedMimeTypes = [...new Set(policy.allowedMimeTypes.map((value) => value.trim().toLowerCase()))]
  if (
    allowedMimeTypes.length === 0 ||
    allowedMimeTypes.some((mimeType) => SIGNATURE_VALIDATORS[mimeType] === undefined)
  ) {
    throw new AttachmentApiError('DISALLOWED_FILE_TYPE')
  }
  return Object.freeze({ ...policy, allowedMimeTypes: Object.freeze(allowedMimeTypes) })
}

function validateUploadInput(
  input: {
    idempotencyKey: string
    label: string
    originalFilename: string
    declaredMimeType: string
    declaredSizeBytes: number
    declaredChecksumSha256: string
    bytes: Uint8Array
  },
  policy: OrderAttachmentPolicy,
) {
  const idempotencyKey = cleanText(input.idempotencyKey, 128)
  if (!idempotencyKey) throw new AttachmentApiError('IDEMPOTENCY_KEY_REQUIRED')
  const label = cleanText(input.label, 120)
  const originalFilename = cleanFilename(input.originalFilename)
  if (!label || !originalFilename) throw new AttachmentApiError('INVALID_REQUEST')

  const mimeType = input.declaredMimeType.trim().toLowerCase()
  const validateSignature = SIGNATURE_VALIDATORS[mimeType]
  if (!policy.allowedMimeTypes.includes(mimeType) || !validateSignature) {
    throw new AttachmentApiError('DISALLOWED_FILE_TYPE')
  }
  if (
    !Number.isSafeInteger(input.declaredSizeBytes) ||
    input.declaredSizeBytes < 1 ||
    input.declaredSizeBytes !== input.bytes.byteLength
  ) {
    throw new AttachmentApiError('DECLARATION_MISMATCH')
  }
  if (input.bytes.byteLength > policy.maxSizeBytes) {
    throw new AttachmentApiError('FILE_TOO_LARGE')
  }
  if (!validateSignature(input.bytes)) {
    throw new AttachmentApiError('FILE_SIGNATURE_MISMATCH')
  }

  const actualChecksum = sha256(input.bytes)
  if (actualChecksum !== input.declaredChecksumSha256) {
    throw new AttachmentApiError('CHECKSUM_MISMATCH')
  }
  return {
    idempotencyKey,
    label,
    originalFilename,
    mimeType,
    sizeBytes: input.bytes.byteLength,
    checksumSha256: actualChecksum,
  }
}

function cleanText(value: string, maxLength: number): string | null {
  const cleaned = value.trim()
  const hasControlCharacter = [...cleaned].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
  if (!cleaned || cleaned.length > maxLength || hasControlCharacter) return null
  return cleaned
}

function cleanFilename(value: string): string | null {
  const cleaned = cleanText(value, 255)
  if (!cleaned || cleaned === '.' || cleaned === '..' || /[/\\]/.test(cleaned)) return null
  return cleaned
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64')
}

function hashPayload(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function startsWithAscii(bytes: Uint8Array, prefix: string): boolean {
  return startsWith(bytes, [...Buffer.from(prefix)])
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

function toAuditEvent(
  eventType: AttachmentAuditEvent['eventType'],
  attachment: OrderAttachment,
  actor: AttachmentActor,
  occurredAt: Date,
): AttachmentAuditEvent {
  return {
    eventType,
    orderId: attachment.orderId,
    attachmentId: attachment.id,
    actorId: actor.id,
    occurredAt,
    label: attachment.label,
  }
}

export function createInMemoryAttachmentRepository(options: {
  orders?: readonly AttachmentOrder[]
} = {}): AttachmentRepository & {
  snapshot(): { orders: readonly AttachmentOrder[]; attachments: readonly OrderAttachment[] }
} {
  const orders = new Map((options.orders ?? []).map((order) => [order.id, structuredClone(order)]))
  const attachments = new Map<string, OrderAttachment>()
  const locks = new Map<string, Promise<void>>()

  return {
    async withOrderLock<T>(orderId: string, work: () => Promise<T>): Promise<T> {
      const previous = locks.get(orderId) ?? Promise.resolve()
      let release: () => void = () => undefined
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      locks.set(orderId, previous.then(() => current))
      await previous
      try {
        return await work()
      } finally {
        release()
        if (locks.get(orderId) === current) locks.delete(orderId)
      }
    },
    async findOrder(orderId) {
      return cloneOrNull(orders.get(orderId))
    },
    async findById(orderId, attachmentId) {
      const attachment = attachments.get(attachmentId)
      return attachment?.orderId === orderId ? structuredClone(attachment) : null
    },
    async findByIdempotency(orderId, actorId, idempotencyKey) {
      return cloneOrNull(
        [...attachments.values()].find(
          (attachment) =>
            attachment.orderId === orderId &&
            attachment.createdBy === actorId &&
            attachment.idempotencyKey === idempotencyKey,
        ),
      )
    },
    async countActive(orderId) {
      return [...attachments.values()].filter(
        (attachment) =>
          attachment.orderId === orderId &&
          ['pending', 'ready', 'deleting'].includes(attachment.state),
      ).length
    },
    async listActive(orderId) {
      return [...attachments.values()]
        .filter(
          (attachment) =>
            attachment.orderId === orderId && attachment.state === 'ready',
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.id.localeCompare(left.id),
        )
        .map((attachment) => structuredClone(attachment))
    },
    async insert(attachment) {
      attachments.set(attachment.id, structuredClone(attachment))
    },
    async update(attachmentId, patch) {
      const attachment = attachments.get(attachmentId)
      if (!attachment) throw new AttachmentApiError('NOT_FOUND')
      const updated = { ...attachment, ...patch }
      attachments.set(attachmentId, structuredClone(updated))
      return structuredClone(updated)
    },
    snapshot() {
      return {
        orders: [...orders.values()].map((value) => structuredClone(value)),
        attachments: [...attachments.values()].map((value) => structuredClone(value)),
      }
    },
  }
}

export function createInMemoryPrivateAttachmentStorage(options: {
  corruptChecksumOnPut?: boolean
} = {}): PrivateAttachmentStorage & {
  publicUrl(key: string): null
  snapshot(): readonly { key: string; bytes: Uint8Array }[]
} {
  const objects = new Map<string, Uint8Array>()
  return {
    async put(input) {
      const bytes = new Uint8Array(input.bytes)
      objects.set(input.key, bytes)
      return {
        sizeBytes: bytes.byteLength,
        checksumSha256: options.corruptChecksumOnPut ? 'invalid' : sha256(bytes),
      }
    },
    async get(key) {
      const bytes = objects.get(key)
      return bytes ? new Uint8Array(bytes) : null
    },
    async delete(key) {
      objects.delete(key)
    },
    publicUrl(_key) {
      return null
    },
    snapshot() {
      return [...objects].map(([key, bytes]) => ({ key, bytes: new Uint8Array(bytes) }))
    },
  }
}

export function createInMemoryAttachmentAuditSink(): AttachmentAuditSink & {
  snapshot(): readonly AttachmentAuditEvent[]
} {
  const events: AttachmentAuditEvent[] = []
  return {
    async append(event) {
      events.push(structuredClone(event))
    },
    snapshot() {
      return structuredClone(events)
    },
  }
}

function cloneOrNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : structuredClone(value)
}
