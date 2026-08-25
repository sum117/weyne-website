import { createHash } from 'node:crypto'
import sharp, { type Metadata } from 'sharp'
import {
  PRODUCT_ATTACHMENT_POLICIES,
  PRODUCT_PHOTO_IMAGE_LIMITS,
  PRODUCT_PHOTO_VARIANTS,
  validateProductPhotoDimensions,
  type ProductPhotoVariantKey,
} from '@/domain/products/attachments'
import { createAttachmentObjectKey } from '@/lib/attachments/policy.server'

export type ProductPhotoProcessingErrorCode =
  | 'animated_image_not_supported'
  | 'checksum_mismatch'
  | 'content_type_mismatch'
  | 'file_too_large'
  | 'image_decode_failed'
  | 'size_mismatch'
  | 'unsupported_image_format'

export class ProductPhotoProcessingError extends Error {
  readonly code: ProductPhotoProcessingErrorCode

  constructor(code: ProductPhotoProcessingErrorCode, message: string) {
    super(message)
    this.name = 'ProductPhotoProcessingError'
    this.code = code
  }
}

export type ProcessedProductPhotoVariant = Readonly<{
  key: ProductPhotoVariantKey
  bytes: Uint8Array
  mimeType: 'image/webp'
  sizeBytes: number
  checksumSha256: string
  width: number
  height: number
}>

export type ProcessedProductPhoto = Readonly<{
  source: Readonly<{
    mimeType: string
    checksumSha256: string
    width: number
    height: number
    orientation: number | undefined
  }>
  variants: readonly ProcessedProductPhotoVariant[]
}>

export type ProductPhotoVariantMetadata = Readonly<{
  key: ProductPhotoVariantKey
  objectKey: string
  mimeType: 'image/webp'
  sizeBytes: number
  checksumSha256: string
  width: number
  height: number
}>

export type ProductPhotoProcessingAttachment = Readonly<{
  id: string
  objectKey: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string
}>

export interface ProductPhotoProcessingRepository {
  claim(attachmentId: string): Promise<
    | Readonly<{
        kind: 'available'
        variants: readonly ProductPhotoVariantMetadata[]
      }>
    | Readonly<{
        kind: 'process'
        attachment: ProductPhotoProcessingAttachment
      }>
  >
  complete(
    attachmentId: string,
    variants: readonly ProductPhotoVariantMetadata[],
  ): Promise<void>
  fail(attachmentId: string, code: string): Promise<void>
}

export interface ProductPhotoPrivateStorage {
  read(key: string): Promise<Uint8Array | null>
  putPrivate(input: Readonly<{
    key: string
    bytes: Uint8Array
    mimeType: 'image/webp'
    checksumSha256: string
  }>): Promise<void>
  delete(key: string): Promise<void>
}

const MIME_BY_FORMAT = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const)

export function createProductPhotoProcessingService(options: {
  repository: ProductPhotoProcessingRepository
  storage: ProductPhotoPrivateStorage
}) {
  return Object.freeze({
    async process(attachmentId: string): Promise<readonly ProductPhotoVariantMetadata[]> {
      const claim = await options.repository.claim(attachmentId)
      if (claim.kind === 'available') return claim.variants

      const storedObjectKeys: string[] = []
      let phase: 'read' | 'transform' | 'store' | 'persist' = 'read'
      try {
        const sourceBytes = await options.storage.read(claim.attachment.objectKey)
        if (sourceBytes === null) {
          throw new ProductPhotoProcessingError(
            'image_decode_failed',
            'Stored photo object is unavailable',
          )
        }

        phase = 'transform'
        const processed = await processProductPhotoBytes({
          bytes: sourceBytes,
          expectedChecksumSha256: claim.attachment.checksumSha256,
          expectedMimeType: claim.attachment.mimeType,
          expectedSizeBytes: claim.attachment.sizeBytes,
        })

        phase = 'store'
        const persistedVariants: ProductPhotoVariantMetadata[] = []
        for (const variant of processed.variants) {
          const objectKey = createAttachmentObjectKey({ scopeId: claim.attachment.id })
          await options.storage.putPrivate({
            key: objectKey,
            bytes: variant.bytes,
            mimeType: variant.mimeType,
            checksumSha256: variant.checksumSha256,
          })
          storedObjectKeys.push(objectKey)
          persistedVariants.push(
            Object.freeze({
              key: variant.key,
              objectKey,
              mimeType: variant.mimeType,
              sizeBytes: variant.sizeBytes,
              checksumSha256: variant.checksumSha256,
              width: variant.width,
              height: variant.height,
            }),
          )
        }

        phase = 'persist'
        const result = Object.freeze(persistedVariants)
        await options.repository.complete(attachmentId, result)
        return result
      } catch (error) {
        await Promise.allSettled(
          storedObjectKeys.map((objectKey) => options.storage.delete(objectKey)),
        )
        await options.repository.fail(attachmentId, processingFailureCode(error, phase))
        throw error
      }
    },
  })
}

export async function processProductPhotoBytes(input: {
  bytes: Uint8Array
  expectedChecksumSha256: string
  expectedMimeType: string
  expectedSizeBytes?: number
}): Promise<ProcessedProductPhoto> {
  if (input.bytes.byteLength > PRODUCT_ATTACHMENT_POLICIES.PHOTO.maxSizeBytes) {
    throw new ProductPhotoProcessingError(
      'file_too_large',
      'Stored photo exceeds the configured upload byte limit',
    )
  }
  if (
    input.expectedSizeBytes !== undefined &&
    input.bytes.byteLength !== input.expectedSizeBytes
  ) {
    throw new ProductPhotoProcessingError(
      'size_mismatch',
      'Stored photo size does not match the verified attachment metadata',
    )
  }
  const checksumSha256 = sha256Base64(input.bytes)
  if (checksumSha256 !== input.expectedChecksumSha256) {
    throw new ProductPhotoProcessingError(
      'checksum_mismatch',
      'Stored photo checksum does not match the verified attachment metadata',
    )
  }

  let metadata: Metadata
  try {
    metadata = await sharp(input.bytes, {
      animated: true,
      failOn: 'error',
      // Header inspection is bounded by the upload byte policy. Pixel limits are
      // validated below before any raster decode or transform is attempted.
      limitInputPixels: false,
    }).metadata()
  } catch (error) {
    throw new ProductPhotoProcessingError(
      'image_decode_failed',
      `Stored photo could not be decoded: ${safeSharpMessage(error)}`,
    )
  }

  if ((metadata.pages ?? 1) > 1) {
    throw new ProductPhotoProcessingError(
      'animated_image_not_supported',
      'Animated product photos are not supported',
    )
  }
  const mimeType = metadata.format
    ? MIME_BY_FORMAT[metadata.format as keyof typeof MIME_BY_FORMAT]
    : undefined
  if (!mimeType) {
    throw new ProductPhotoProcessingError(
      'unsupported_image_format',
      'Stored photo format is not supported',
    )
  }
  if (mimeType !== input.expectedMimeType) {
    throw new ProductPhotoProcessingError(
      'content_type_mismatch',
      'Stored photo content does not match the verified MIME type',
    )
  }
  if (metadata.width === undefined || metadata.height === undefined) {
    throw new ProductPhotoProcessingError(
      'image_decode_failed',
      'Stored photo has no readable dimensions',
    )
  }
  validateProductPhotoDimensions(metadata.width, metadata.height)

  const variants = await Promise.all(
    PRODUCT_PHOTO_VARIANTS.map(async (variant) => {
      const output = await sharp(input.bytes, {
        failOn: 'error',
        limitInputPixels: PRODUCT_PHOTO_IMAGE_LIMITS.maxPixels,
      })
        .rotate()
        .resize({
          width: variant.maxWidth,
          height: variant.maxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true })

      const bytes = new Uint8Array(output.data)
      return Object.freeze({
        key: variant.key,
        bytes,
        mimeType: 'image/webp' as const,
        sizeBytes: bytes.byteLength,
        checksumSha256: sha256Base64(bytes),
        width: output.info.width,
        height: output.info.height,
      })
    }),
  )

  return Object.freeze({
    source: Object.freeze({
      mimeType,
      checksumSha256,
      width: metadata.width,
      height: metadata.height,
      orientation: metadata.orientation,
    }),
    variants: Object.freeze(variants),
  })
}

function processingFailureCode(
  error: unknown,
  phase: 'read' | 'transform' | 'store' | 'persist',
): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }

  return {
    read: 'original_storage_failed',
    transform: 'image_processing_failed',
    store: 'variant_storage_failed',
    persist: 'variant_persistence_failed',
  }[phase]
}

function sha256Base64(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64')
}

function safeSharpMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown decode error'
}
