import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import {
  PRODUCT_ATTACHMENT_POLICIES,
  ProductAttachmentValidationError,
  validateProductAttachmentDraft,
  validateProductPhotoSet,
  type ProductAttachmentCategory,
  type ProductAttachmentUploadStatus,
} from '@/domain/products/attachments'
import {
  authorizeCatalogAction,
  type CatalogActor,
} from '@/lib/catalog/authorization.server'
import { createAttachmentObjectKey } from '@/lib/attachments/policy.server'

export type ProductAttachmentActor = CatalogActor

export type ProductAttachmentApiErrorCode =
  | 'ATTACHMENT_NOT_AVAILABLE'
  | 'CHECKSUM_MISMATCH'
  | 'DECLARATION_MISMATCH'
  | 'DISALLOWED_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'FORBIDDEN'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_CONTENT'
  | 'INVALID_REQUEST'
  | 'INVALID_STATE'
  | 'NOT_FOUND'
  | 'STORAGE_ERROR'
  | 'UNAUTHENTICATED'
  | 'UPLOAD_EXPIRED'

const ERROR_STATUS: Readonly<Record<ProductAttachmentApiErrorCode, number>> = {
  ATTACHMENT_NOT_AVAILABLE: 409,
  CHECKSUM_MISMATCH: 422,
  DECLARATION_MISMATCH: 422,
  DISALLOWED_FILE_TYPE: 415,
  FILE_TOO_LARGE: 413,
  FORBIDDEN: 403,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 409,
  INVALID_CONTENT: 415,
  INVALID_REQUEST: 400,
  INVALID_STATE: 409,
  NOT_FOUND: 404,
  STORAGE_ERROR: 503,
  UNAUTHENTICATED: 401,
  UPLOAD_EXPIRED: 410,
}

const RETRYABLE_CODES: readonly ProductAttachmentApiErrorCode[] = [
  'ATTACHMENT_NOT_AVAILABLE',
  'STORAGE_ERROR',
]

export class ProductAttachmentApiError extends Error {
  readonly code: ProductAttachmentApiErrorCode
  readonly status: number
  readonly retryable: boolean

  constructor(code: ProductAttachmentApiErrorCode) {
    super(code)
    this.name = 'ProductAttachmentApiError'
    this.code = code
    this.status = ERROR_STATUS[code]
    this.retryable = RETRYABLE_CODES.includes(code)
  }
}

export type ProductAttachmentRecord = Readonly<{
  id: string
  productId: string
  category: ProductAttachmentCategory
  objectKey: string
  originalFilename: string
  displayLabel: string | null
  documentVersion: string | null
  effectiveDate: string | null
  mimeType: string
  sizeBytes: number
  checksumSha256: string
  uploadStatus: ProductAttachmentUploadStatus
  photoPosition: number | null
  isPrimary: boolean
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
  deletedAt: Date | null
  deletedBy: string | null
  uploadExpiresAt: Date
  initiationActorId: string
  idempotencyKey: string
  initiationPayloadHash: string
  failureCode: ProductAttachmentApiErrorCode | null
}>

export type PublicProductAttachment = Omit<
  ProductAttachmentRecord,
  | 'objectKey'
  | 'uploadExpiresAt'
  | 'initiationActorId'
  | 'idempotencyKey'
  | 'initiationPayloadHash'
  | 'failureCode'
>

export function toPublicProductAttachment(
  attachment: ProductAttachmentRecord,
): PublicProductAttachment {
  const {
    objectKey: _objectKey,
    uploadExpiresAt: _uploadExpiresAt,
    initiationActorId: _initiationActorId,
    idempotencyKey: _idempotencyKey,
    initiationPayloadHash: _initiationPayloadHash,
    failureCode: _failureCode,
    ...publicAttachment
  } = attachment
  return publicAttachment
}

export type ProductAttachmentAuditAction =
  | 'product.attachment.upload.initiated'
  | 'product.attachment.upload.completed'
  | 'product.attachment.upload.failed'
  | 'product.attachment.download.authorized'
  | 'product.attachment.metadata.updated'
  | 'product.attachment.ordering.updated'
  | 'product.attachment.deleted'

export type ProductAttachmentAuditEvent = Readonly<{
  eventId: string
  action: ProductAttachmentAuditAction
  actorId: string
  productId: string
  attachmentId: string
  category: ProductAttachmentCategory
  occurredAt: Date
  previousStatus: ProductAttachmentUploadStatus | null
  newStatus: ProductAttachmentUploadStatus
  outcomeCode: 'OK' | ProductAttachmentApiErrorCode
}>

export interface ProductAttachmentAuditSink {
  append(event: ProductAttachmentAuditEvent): Promise<void>
}

export interface ProductAttachmentStorage {
  signUpload(input: Readonly<{
    key: string
    mimeType: string
    sizeBytes: number
    checksumSha256: string
    expiresInSeconds: number
    now: Date
  }>): Promise<Readonly<{ url: string; expiresAt: Date }>>
  signDownload(input: Readonly<{
    key: string
    expiresInSeconds: number
    now: Date
  }>): Promise<Readonly<{ url: string; expiresAt: Date }>>
  read(key: string): Promise<Uint8Array | null>
  putPrivate(input: Readonly<{
    key: string
    bytes: Uint8Array
    mimeType: string
    checksumSha256: string
  }>): Promise<void>
  delete(key: string): Promise<void>
}

export type ProductAttachmentProduct = Readonly<{
  id: string
  archived: boolean
}>

export interface ProductAttachmentRepository {
  withProductLock<T>(productId: string, work: () => Promise<T>): Promise<T>
  findProduct(productId: string): Promise<ProductAttachmentProduct | null>
  findById(attachmentId: string): Promise<ProductAttachmentRecord | null>
  findByInitiation(
    productId: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<ProductAttachmentRecord | null>
  listActive(productId: string): Promise<readonly ProductAttachmentRecord[]>
  insert(attachment: ProductAttachmentRecord): Promise<void>
  update(
    attachmentId: string,
    patch: Partial<ProductAttachmentRecord>,
  ): Promise<ProductAttachmentRecord>
  replacePhotoOrder(
    productId: string,
    photos: readonly Readonly<{
      id: string
      photoPosition: number
      isPrimary: boolean
    }>[],
    actorId: string,
    occurredAt: Date,
  ): Promise<readonly ProductAttachmentRecord[]>
}

type ServiceDependencies = Readonly<{
  authenticate: (
    actor: ProductAttachmentActor | null | undefined,
  ) => Promise<ProductAttachmentActor | null>
  repository: ProductAttachmentRepository
  storage: ProductAttachmentStorage
  audit: ProductAttachmentAuditSink
  now?: () => Date
  uploadTtlSeconds?: number
  downloadTtlSeconds?: number
}>

export function createProductAttachmentService(dependencies: ServiceDependencies) {
  const now = dependencies.now ?? (() => new Date())
  const uploadTtlSeconds = validateTtl(dependencies.uploadTtlSeconds ?? 900)
  const downloadTtlSeconds = validateTtl(dependencies.downloadTtlSeconds ?? 300)

  async function authorize(
    actorInput: ProductAttachmentActor | null | undefined,
    productId: string,
    operation: 'read' | 'mutate',
  ): Promise<ProductAttachmentActor> {
    const actor = await dependencies.authenticate(actorInput)
    if (!actor) throw new ProductAttachmentApiError('UNAUTHENTICATED')
    const action = operation === 'read' ? 'product.files.read' : 'product.files.manage'
    if (authorizeCatalogAction(actor, action) !== 'allow') {
      throw new ProductAttachmentApiError('FORBIDDEN')
    }
    const product = await dependencies.repository.findProduct(productId)
    if (!product) throw new ProductAttachmentApiError('NOT_FOUND')
    if (product.archived && operation === 'mutate') {
      throw new ProductAttachmentApiError('INVALID_STATE')
    }
    return actor
  }

  async function attachmentFor(
    actorInput: ProductAttachmentActor | null | undefined,
    attachmentId: string,
    operation: 'read' | 'mutate',
  ) {
    const attachment = await dependencies.repository.findById(attachmentId)
    if (!attachment || attachment.deletedAt) {
      throw new ProductAttachmentApiError('NOT_FOUND')
    }
    const actor = await authorize(actorInput, attachment.productId, operation)
    return { actor, attachment }
  }

  return Object.freeze({
    async initiateUpload(input: {
      actor?: ProductAttachmentActor | null
      productId: string
      idempotencyKey: string
      category: ProductAttachmentCategory
      originalFilename: string
      declaration: Readonly<{
        mimeType: string
        sizeBytes: number
        checksumSha256: string
      }>
      documentMetadata?: Readonly<{
        displayLabel: string
        documentVersion?: string | null
        effectiveDate?: string | null
      }>
    }) {
      const actor = await authorize(input.actor, input.productId, 'mutate')
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
      const payloadHash = hashJson({
        productId: input.productId,
        category: input.category,
        originalFilename: input.originalFilename,
        declaration: input.declaration,
        documentMetadata: input.documentMetadata ?? null,
      })

      return dependencies.repository.withProductLock(input.productId, async () => {
        const prior = await dependencies.repository.findByInitiation(
          input.productId,
          actor.id,
          idempotencyKey,
        )
        if (prior) {
          if (prior.initiationPayloadHash !== payloadHash) {
            throw new ProductAttachmentApiError('IDEMPOTENCY_KEY_REUSED')
          }
          let retry = prior
          if (prior.uploadStatus === 'FAILED' && prior.failureCode === 'STORAGE_ERROR') {
            const timestamp = now()
            retry = await dependencies.repository.update(prior.id, {
              uploadStatus: 'PENDING',
              uploadExpiresAt: addSeconds(timestamp, uploadTtlSeconds),
              failureCode: null,
              updatedAt: timestamp,
              updatedBy: actor.id,
            })
          } else if (prior.uploadStatus !== 'PENDING' || now() >= prior.uploadExpiresAt) {
            throw new ProductAttachmentApiError(
              prior.uploadStatus === 'FAILED' && prior.failureCode === 'UPLOAD_EXPIRED'
                ? 'UPLOAD_EXPIRED'
                : 'INVALID_STATE',
            )
          }
          try {
            const signedAt = now()
            const signed = await dependencies.storage.signUpload({
              key: retry.objectKey,
              mimeType: retry.mimeType,
              sizeBytes: retry.sizeBytes,
              checksumSha256: retry.checksumSha256,
              expiresInSeconds: secondsRemaining(retry.uploadExpiresAt, signedAt),
              now: signedAt,
            })
            await dependencies.audit.append(
              auditEvent(
                'product.attachment.upload.initiated',
                actor,
                retry,
                null,
                'OK',
                retry.createdAt,
              ),
            )
            return uploadInitiationResponse(retry, signed)
          } catch {
            throw new ProductAttachmentApiError('STORAGE_ERROR')
          }
        }

        const active = await dependencies.repository.listActive(input.productId)
        const photos = active.filter((attachment) => attachment.category === 'PHOTO')
        const timestamp = now()
        const objectKey = createAttachmentObjectKey()
        const isPhoto = input.category === 'PHOTO'
        const draft = validateDraft({
          category: input.category,
          objectKey,
          originalFilename: input.originalFilename,
          displayLabel: isPhoto ? null : input.documentMetadata?.displayLabel,
          documentVersion: isPhoto
            ? null
            : (input.documentMetadata?.documentVersion ?? null),
          effectiveDate: isPhoto
            ? null
            : (input.documentMetadata?.effectiveDate ?? null),
          ...input.declaration,
          uploadStatus: 'PENDING',
          photoPosition: isPhoto ? photos.length : null,
          isPrimary: isPhoto ? photos.length === 0 : false,
        })
        const attachment: ProductAttachmentRecord = Object.freeze({
          id: randomUUID(),
          productId: input.productId,
          ...draft,
          createdAt: timestamp,
          createdBy: actor.id,
          updatedAt: timestamp,
          updatedBy: actor.id,
          deletedAt: null,
          deletedBy: null,
          uploadExpiresAt: addSeconds(timestamp, uploadTtlSeconds),
          initiationActorId: actor.id,
          idempotencyKey,
          initiationPayloadHash: payloadHash,
          failureCode: null,
        })
        await dependencies.repository.insert(attachment)
        let signed: Readonly<{ url: string; expiresAt: Date }>
        try {
          signed = await dependencies.storage.signUpload({
            key: objectKey,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            checksumSha256: attachment.checksumSha256,
            expiresInSeconds: uploadTtlSeconds,
            now: timestamp,
          })
        } catch {
          const failedAt = now()
          const failed = await dependencies.repository.update(attachment.id, {
            uploadStatus: 'FAILED',
            failureCode: 'STORAGE_ERROR',
            updatedAt: failedAt,
            updatedBy: actor.id,
          })
          try {
            await dependencies.audit.append(
              auditEvent(
                'product.attachment.upload.failed',
                actor,
                failed,
                'PENDING',
                'STORAGE_ERROR',
                failedAt,
              ),
            )
          } catch {
            // The same idempotency key safely replays this intent.
          }
          throw new ProductAttachmentApiError('STORAGE_ERROR')
        }
        try {
          await dependencies.audit.append(
            auditEvent(
              'product.attachment.upload.initiated',
              actor,
              attachment,
              null,
              'OK',
              timestamp,
            ),
          )
          return uploadInitiationResponse(attachment, signed)
        } catch {
          throw new ProductAttachmentApiError('STORAGE_ERROR')
        }
      })
    },

    async finalizeUpload(input: {
      actor?: ProductAttachmentActor | null
      attachmentId: string
    }): Promise<PublicProductAttachment> {
      const found = await attachmentFor(input.actor, input.attachmentId, 'mutate')
      return dependencies.repository.withProductLock(
        found.attachment.productId,
        async () => {
          const current = await dependencies.repository.findById(input.attachmentId)
          if (!current || current.deletedAt) {
            throw new ProductAttachmentApiError('NOT_FOUND')
          }
          if (current.uploadStatus === 'AVAILABLE' || current.uploadStatus === 'UPLOADED') {
            await dependencies.audit.append(
              auditEvent(
                'product.attachment.upload.completed',
                found.actor,
                current,
                'PENDING',
                'OK',
                current.updatedAt,
              ),
            )
            return toPublicProductAttachment(current)
          }
          if (current.uploadStatus === 'FAILED' && current.failureCode) {
            throw new ProductAttachmentApiError(current.failureCode)
          }
          if (current.uploadStatus !== 'PENDING') {
            throw new ProductAttachmentApiError('INVALID_STATE')
          }
          if (now() >= current.uploadExpiresAt) {
            await failFinalization(
              dependencies,
              found.actor,
              current,
              'UPLOAD_EXPIRED',
              now(),
            )
          }

          let bytes: Uint8Array | null
          try {
            bytes = await dependencies.storage.read(current.objectKey)
          } catch {
            throw new ProductAttachmentApiError('STORAGE_ERROR')
          }
          if (!bytes) throw new ProductAttachmentApiError('ATTACHMENT_NOT_AVAILABLE')
          if (bytes.byteLength !== current.sizeBytes) {
            await failFinalization(
              dependencies,
              found.actor,
              current,
              'DECLARATION_MISMATCH',
              now(),
            )
          }
          if (bytes.byteLength > PRODUCT_ATTACHMENT_POLICIES[current.category].maxSizeBytes) {
            await failFinalization(
              dependencies,
              found.actor,
              current,
              'FILE_TOO_LARGE',
              now(),
            )
          }
          const actualMimeType = await sniffMimeType(bytes)
          if (!actualMimeType) {
            await failFinalization(
              dependencies,
              found.actor,
              current,
              'INVALID_CONTENT',
              now(),
            )
          }
          if (
            actualMimeType !== current.mimeType ||
            !PRODUCT_ATTACHMENT_POLICIES[current.category].allowedMimeTypes.includes(
              actualMimeType,
            )
          ) {
            await failFinalization(
              dependencies,
              found.actor,
              current,
              'DISALLOWED_FILE_TYPE',
              now(),
            )
          }
          if (sha256(bytes) !== current.checksumSha256) {
            await failFinalization(
              dependencies,
              found.actor,
              current,
              'CHECKSUM_MISMATCH',
              now(),
            )
          }

          const timestamp = now()
          const completed = await dependencies.repository.update(current.id, {
            uploadStatus: current.category === 'PHOTO' ? 'UPLOADED' : 'AVAILABLE',
            updatedAt: timestamp,
            updatedBy: found.actor.id,
            failureCode: null,
          })
          await dependencies.audit.append(
            auditEvent(
              'product.attachment.upload.completed',
              found.actor,
              completed,
              current.uploadStatus,
              'OK',
              timestamp,
            ),
          )
          return toPublicProductAttachment(completed)
        },
      )
    },

    async listAttachments(input: {
      actor?: ProductAttachmentActor | null
      productId: string
    }): Promise<readonly PublicProductAttachment[]> {
      await authorize(input.actor, input.productId, 'read')
      const attachments = await dependencies.repository.listActive(input.productId)
      return Object.freeze(
        sortAttachments(attachments).map(toPublicProductAttachment),
      )
    },

    async authorizeDownload(input: {
      actor?: ProductAttachmentActor | null
      attachmentId: string
    }) {
      const { actor, attachment } = await attachmentFor(
        input.actor,
        input.attachmentId,
        'read',
      )
      if (attachment.uploadStatus !== 'AVAILABLE') {
        throw new ProductAttachmentApiError('ATTACHMENT_NOT_AVAILABLE')
      }
      const timestamp = now()
      let signed: Readonly<{ url: string; expiresAt: Date }>
      try {
        signed = await dependencies.storage.signDownload({
          key: attachment.objectKey,
          expiresInSeconds: downloadTtlSeconds,
          now: timestamp,
        })
      } catch {
        throw new ProductAttachmentApiError('STORAGE_ERROR')
      }
      await dependencies.audit.append(
        auditEvent(
          'product.attachment.download.authorized',
          actor,
          attachment,
          attachment.uploadStatus,
          'OK',
          timestamp,
        ),
      )
      return Object.freeze({
        attachment: toPublicProductAttachment(attachment),
        download: Object.freeze({
          method: 'GET' as const,
          url: signed.url,
          expiresAt: signed.expiresAt.toISOString(),
        }),
      })
    },

    async updateDocumentMetadata(input: {
      actor?: ProductAttachmentActor | null
      attachmentId: string
      displayLabel: string
      documentVersion?: string | null
      effectiveDate?: string | null
    }): Promise<PublicProductAttachment> {
      const { actor, attachment } = await attachmentFor(
        input.actor,
        input.attachmentId,
        'mutate',
      )
      if (attachment.category === 'PHOTO') {
        throw new ProductAttachmentApiError('INVALID_REQUEST')
      }
      const draft = validateDraft({
        ...attachment,
        displayLabel: input.displayLabel,
        documentVersion: input.documentVersion ?? null,
        effectiveDate: input.effectiveDate ?? null,
      })
      const timestamp = now()
      const updated = await dependencies.repository.update(attachment.id, {
        displayLabel: draft.displayLabel,
        documentVersion: draft.documentVersion,
        effectiveDate: draft.effectiveDate,
        updatedAt: timestamp,
        updatedBy: actor.id,
      })
      await dependencies.audit.append(
        auditEvent(
          'product.attachment.metadata.updated',
          actor,
          updated,
          attachment.uploadStatus,
          'OK',
          timestamp,
        ),
      )
      return toPublicProductAttachment(updated)
    },

    async reorderPhotos(input: {
      actor?: ProductAttachmentActor | null
      productId: string
      orderedAttachmentIds: readonly string[]
    }): Promise<readonly PublicProductAttachment[]> {
      const actor = await authorize(input.actor, input.productId, 'mutate')
      return dependencies.repository.withProductLock(input.productId, async () => {
        const attachments = await dependencies.repository.listActive(input.productId)
        const photos = attachments.filter((attachment) => attachment.category === 'PHOTO')
        requireExactPhotoIds(photos, input.orderedAttachmentIds)
        const primaryId = photos.find((photo) => photo.isPrimary)?.id
        const order = validateProductPhotoSet(
          input.orderedAttachmentIds.map((id, photoPosition) => ({
            id,
            photoPosition,
            isPrimary: id === primaryId,
          })),
        )
        const timestamp = now()
        const updated = await dependencies.repository.replacePhotoOrder(
          input.productId,
          order,
          actor.id,
          timestamp,
        )
        const subject = updated[0]
        if (subject) {
          await dependencies.audit.append(
            auditEvent(
              'product.attachment.ordering.updated',
              actor,
              subject,
              subject.uploadStatus,
              'OK',
              timestamp,
            ),
          )
        }
        return Object.freeze(updated.map(toPublicProductAttachment))
      })
    },

    async selectPrimaryPhoto(input: {
      actor?: ProductAttachmentActor | null
      attachmentId: string
    }): Promise<readonly PublicProductAttachment[]> {
      const { actor, attachment } = await attachmentFor(
        input.actor,
        input.attachmentId,
        'mutate',
      )
      if (attachment.category !== 'PHOTO') {
        throw new ProductAttachmentApiError('INVALID_REQUEST')
      }
      return dependencies.repository.withProductLock(attachment.productId, async () => {
        const active = await dependencies.repository.listActive(attachment.productId)
        const photos = active.filter((candidate) => candidate.category === 'PHOTO')
        const order = validateProductPhotoSet(
          photos.map((photo) => ({
            id: photo.id,
            photoPosition: photo.photoPosition!,
            isPrimary: photo.id === attachment.id,
          })),
        )
        const timestamp = now()
        const updated = await dependencies.repository.replacePhotoOrder(
          attachment.productId,
          order,
          actor.id,
          timestamp,
        )
        await dependencies.audit.append(
          auditEvent(
            'product.attachment.ordering.updated',
            actor,
            updated.find((photo) => photo.id === attachment.id)!,
            attachment.uploadStatus,
            'OK',
            timestamp,
          ),
        )
        return Object.freeze(updated.map(toPublicProductAttachment))
      })
    },

    async deleteAttachment(input: {
      actor?: ProductAttachmentActor | null
      attachmentId: string
    }): Promise<PublicProductAttachment> {
      const attachment = await dependencies.repository.findById(input.attachmentId)
      if (!attachment) throw new ProductAttachmentApiError('NOT_FOUND')
      const actor = await authorize(input.actor, attachment.productId, 'mutate')
      if (attachment.deletedAt) {
        await dependencies.audit.append(
          auditEvent(
            'product.attachment.deleted',
            actor,
            attachment,
            'DELETING',
            'OK',
            attachment.updatedAt,
          ),
        )
        return toPublicProductAttachment(attachment)
      }
      return dependencies.repository.withProductLock(attachment.productId, async () => {
        const current = await dependencies.repository.findById(attachment.id)
        if (!current) throw new ProductAttachmentApiError('NOT_FOUND')
        if (current.deletedAt) return toPublicProductAttachment(current)
        if (current.uploadStatus !== 'DELETING') {
          await dependencies.repository.update(current.id, {
            uploadStatus: 'DELETING',
            updatedAt: now(),
            updatedBy: actor.id,
          })
        }
        try {
          await dependencies.storage.delete(current.objectKey)
        } catch {
          throw new ProductAttachmentApiError('STORAGE_ERROR')
        }
        const timestamp = now()
        const deleted = await dependencies.repository.update(current.id, {
          uploadStatus: 'DELETING',
          deletedAt: timestamp,
          deletedBy: actor.id,
          updatedAt: timestamp,
          updatedBy: actor.id,
        })
        if (current.category === 'PHOTO') {
          await compactRemainingPhotos(
            dependencies.repository,
            current.productId,
            current.id,
            actor.id,
            timestamp,
          )
        }
        await dependencies.audit.append(
          auditEvent(
            'product.attachment.deleted',
            actor,
            deleted,
            current.uploadStatus,
            'OK',
            timestamp,
          ),
        )
        return toPublicProductAttachment(deleted)
      })
    },
  })
}

function validateDraft(input: unknown) {
  try {
    return validateProductAttachmentDraft(input)
  } catch (cause) {
    if (cause instanceof ProductAttachmentValidationError) {
      if (cause.code === 'file_too_large') {
        throw new ProductAttachmentApiError('FILE_TOO_LARGE')
      }
      if (cause.code === 'disallowed_mime_type') {
        throw new ProductAttachmentApiError('DISALLOWED_FILE_TYPE')
      }
      throw new ProductAttachmentApiError('INVALID_REQUEST')
    }
    throw cause
  }
}

async function failFinalization(
  dependencies: ServiceDependencies,
  actor: ProductAttachmentActor,
  attachment: ProductAttachmentRecord,
  code: ProductAttachmentApiErrorCode,
  occurredAt: Date,
): Promise<never> {
  try {
    await dependencies.storage.delete(attachment.objectKey)
  } catch {
    // Reconciliation may retry cleanup; the record still becomes non-readable.
  }
  const failed = await dependencies.repository.update(attachment.id, {
    uploadStatus: 'FAILED',
    failureCode: code,
    updatedAt: occurredAt,
    updatedBy: actor.id,
  })
  await dependencies.audit.append(
    auditEvent(
      'product.attachment.upload.failed',
      actor,
      failed,
      attachment.uploadStatus,
      code,
      occurredAt,
    ),
  )
  throw new ProductAttachmentApiError(code)
}

function uploadInitiationResponse(
  attachment: ProductAttachmentRecord,
  signed: Readonly<{ url: string; expiresAt: Date }>,
) {
  return Object.freeze({
    attachment: toPublicProductAttachment(attachment),
    upload: Object.freeze({
      method: 'PUT' as const,
      url: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      requiredHeaders: Object.freeze({
        'content-type': attachment.mimeType,
        'x-amz-checksum-sha256': attachment.checksumSha256,
      }),
    }),
  })
}

function auditEvent(
  action: ProductAttachmentAuditAction,
  actor: ProductAttachmentActor,
  attachment: ProductAttachmentRecord,
  previousStatus: ProductAttachmentUploadStatus | null,
  outcomeCode: 'OK' | ProductAttachmentApiErrorCode,
  occurredAt: Date,
): ProductAttachmentAuditEvent {
  return Object.freeze({
    eventId: hashJson({
      action,
      attachment,
      occurredAt: occurredAt.toISOString(),
      outcomeCode,
    }),
    action,
    actorId: actor.id,
    productId: attachment.productId,
    attachmentId: attachment.id,
    category: attachment.category,
    occurredAt,
    previousStatus,
    newStatus: attachment.uploadStatus,
    outcomeCode,
  })
}

async function sniffMimeType(bytes: Uint8Array): Promise<string | null> {
  const text = Buffer.from(bytes).toString('latin1')
  if (
    startsWithAscii(bytes, '%PDF-') &&
    /\d+\s+\d+\s+obj\b/.test(text) &&
    text.includes('endobj') &&
    text.includes('trailer') &&
    text.lastIndexOf('%%EOF') >= Math.max(0, text.length - 1_024)
  ) {
    return 'application/pdf'
  }
  const looksLikeImage =
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    (bytes.byteLength >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (bytes.byteLength >= 12 &&
      startsWithAscii(bytes, 'RIFF') &&
      asciiAt(bytes, 8, 4) === 'WEBP')
  if (looksLikeImage) {
    try {
      const metadata = await sharp(bytes, { failOn: 'error' }).metadata()
      if (metadata.width === undefined || metadata.height === undefined) return null
      if (metadata.format === 'jpeg') return 'image/jpeg'
      if (metadata.format === 'png') return 'image/png'
      if (metadata.format === 'webp') return 'image/webp'
    } catch {
      return null
    }
  }
  return null
}

function requireExactPhotoIds(
  photos: readonly ProductAttachmentRecord[],
  orderedIds: readonly string[],
): void {
  if (
    orderedIds.length !== photos.length ||
    new Set(orderedIds).size !== orderedIds.length ||
    photos.some((photo) => !orderedIds.includes(photo.id))
  ) {
    throw new ProductAttachmentApiError('INVALID_REQUEST')
  }
}

async function compactRemainingPhotos(
  repository: ProductAttachmentRepository,
  productId: string,
  deletedId: string,
  actorId: string,
  occurredAt: Date,
): Promise<void> {
  const active = await repository.listActive(productId)
  const photos = active
    .filter((attachment) => attachment.category === 'PHOTO' && attachment.id !== deletedId)
    .sort((left, right) => left.photoPosition! - right.photoPosition!)
  if (photos.length === 0) return
  const primaryId = photos.some((photo) => photo.isPrimary)
    ? photos.find((photo) => photo.isPrimary)!.id
    : photos[0]!.id
  await repository.replacePhotoOrder(
    productId,
    validateProductPhotoSet(
      photos.map((photo, photoPosition) => ({
        id: photo.id,
        photoPosition,
        isPrimary: photo.id === primaryId,
      })),
    ),
    actorId,
    occurredAt,
  )
}

function sortAttachments(
  attachments: readonly ProductAttachmentRecord[],
): ProductAttachmentRecord[] {
  const categoryOrder: Readonly<Record<ProductAttachmentCategory, number>> = {
    PHOTO: 0,
    TECHNICAL_SHEET: 1,
    FISPQ: 2,
  }
  return [...attachments].sort((left, right) => {
    const category = categoryOrder[left.category] - categoryOrder[right.category]
    if (category !== 0) return category
    if (left.category === 'PHOTO' && right.category === 'PHOTO') {
      return left.photoPosition! - right.photoPosition!
    }
    return (
      (right.effectiveDate ?? '').localeCompare(left.effectiveDate ?? '') ||
      left.id.localeCompare(right.id)
    )
  })
}

function normalizeIdempotencyKey(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ProductAttachmentApiError('IDEMPOTENCY_KEY_REQUIRED')
  if (normalized.length > 128) throw new ProductAttachmentApiError('INVALID_REQUEST')
  return normalized
}

function validateTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 604_800) {
    throw new ProductAttachmentApiError('INVALID_REQUEST')
  }
  return value
}

function secondsRemaining(expiresAt: Date, current: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - current.getTime()) / 1000))
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000)
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64')
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value)
}

function startsWithAscii(bytes: Uint8Array, expected: string): boolean {
  return asciiAt(bytes, 0, expected.length) === expected
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.subarray(offset, offset + length)).toString('ascii')
}

export function createInMemoryProductAttachmentRepository(input: {
  products: readonly ProductAttachmentProduct[]
}): ProductAttachmentRepository & {
  snapshot(): Readonly<{
    products: readonly ProductAttachmentProduct[]
    attachments: readonly ProductAttachmentRecord[]
  }>
} {
  const products = [...input.products]
  const attachments: ProductAttachmentRecord[] = []
  const locks = new Map<string, Promise<void>>()

  return {
    async withProductLock<T>(productId: string, work: () => Promise<T>): Promise<T> {
      const previous = locks.get(productId) ?? Promise.resolve()
      let release!: () => void
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      locks.set(productId, previous.then(() => current))
      await previous
      try {
        return await work()
      } finally {
        release()
        if (locks.get(productId) === current) locks.delete(productId)
      }
    },
    async findProduct(id) {
      return products.find((product) => product.id === id) ?? null
    },
    async findById(id) {
      return attachments.find((attachment) => attachment.id === id) ?? null
    },
    async findByInitiation(productId, actorId, idempotencyKey) {
      return (
        attachments.find(
          (attachment) =>
            attachment.productId === productId &&
            attachment.initiationActorId === actorId &&
            attachment.idempotencyKey === idempotencyKey,
        ) ?? null
      )
    },
    async listActive(productId) {
      return attachments.filter(
        (attachment) =>
          attachment.productId === productId && attachment.deletedAt === null,
      )
    },
    async insert(attachment) {
      attachments.push(attachment)
    },
    async update(attachmentId, patch) {
      const index = attachments.findIndex((attachment) => attachment.id === attachmentId)
      if (index < 0) throw new ProductAttachmentApiError('NOT_FOUND')
      attachments[index] = Object.freeze({ ...attachments[index]!, ...patch })
      return attachments[index]!
    },
    async replacePhotoOrder(productId, photos, actorId, occurredAt) {
      for (const photo of photos) {
        const index = attachments.findIndex(
          (attachment) =>
            attachment.id === photo.id && attachment.productId === productId,
        )
        if (index < 0) throw new ProductAttachmentApiError('NOT_FOUND')
        attachments[index] = Object.freeze({
          ...attachments[index]!,
          photoPosition: photo.photoPosition,
          isPrimary: photo.isPrimary,
          updatedAt: occurredAt,
          updatedBy: actorId,
        })
      }
      return attachments
        .filter(
          (attachment) =>
            attachment.productId === productId &&
            attachment.category === 'PHOTO' &&
            attachment.deletedAt === null,
        )
        .sort((left, right) => left.photoPosition! - right.photoPosition!)
    },
    snapshot() {
      return Object.freeze({
        products: Object.freeze([...products]),
        attachments: Object.freeze([...attachments]),
      })
    },
  }
}

export function createInMemoryProductAttachmentStorage(): ProductAttachmentStorage & {
  seed(key: string, bytes: Uint8Array): void
  snapshot(): readonly string[]
} {
  const objects = new Map<string, Uint8Array>()
  return {
    async signUpload(input) {
      return {
        url: `https://signed-upload.test/capability?expires=${input.expiresInSeconds}`,
        expiresAt: addSeconds(input.now, input.expiresInSeconds),
      }
    },
    async signDownload(input) {
      if (!objects.has(input.key)) throw new Error('missing object')
      return {
        url: `https://signed-download.test/capability?expires=${input.expiresInSeconds}`,
        expiresAt: addSeconds(input.now, input.expiresInSeconds),
      }
    },
    async read(key) {
      return objects.get(key) ?? null
    },
    async putPrivate(input) {
      if (sha256(input.bytes) !== input.checksumSha256) {
        throw new ProductAttachmentApiError('CHECKSUM_MISMATCH')
      }
      objects.set(input.key, new Uint8Array(input.bytes))
    },
    async delete(key) {
      objects.delete(key)
    },
    seed(key, bytes) {
      objects.set(key, new Uint8Array(bytes))
    },
    snapshot() {
      return Object.freeze([...objects.keys()])
    },
  }
}

export function createInMemoryProductAttachmentAuditSink(): ProductAttachmentAuditSink & {
  snapshot(): readonly ProductAttachmentAuditEvent[]
} {
  const events: ProductAttachmentAuditEvent[] = []
  return {
    async append(event) {
      if (!events.some((candidate) => candidate.eventId === event.eventId)) {
        events.push(event)
      }
    },
    snapshot() {
      return Object.freeze([...events])
    },
  }
}
