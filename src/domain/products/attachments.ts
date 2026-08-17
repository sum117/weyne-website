import { dateSchema } from '@/domain/primitives/date'
import {
  AttachmentPolicyError,
  createAttachmentPolicy,
  validateUploadDeclaration,
  type AttachmentPolicy,
  type AttachmentPolicyErrorCode,
} from '@/lib/attachments/policy.server'

export const PRODUCT_ATTACHMENT_CATEGORIES = [
  'PHOTO',
  'TECHNICAL_SHEET',
  'FISPQ',
] as const
export type ProductAttachmentCategory =
  (typeof PRODUCT_ATTACHMENT_CATEGORIES)[number]

export const PRODUCT_ATTACHMENT_UPLOAD_STATUSES = [
  'PENDING',
  'UPLOADED',
  'PROCESSING',
  'AVAILABLE',
  'FAILED',
  'DELETING',
] as const
export type ProductAttachmentUploadStatus =
  (typeof PRODUCT_ATTACHMENT_UPLOAD_STATUSES)[number]

export const PRODUCT_ATTACHMENT_POLICIES = Object.freeze({
  PHOTO: createAttachmentPolicy({
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSizeBytes: 10 * 1024 * 1024,
  }),
  TECHNICAL_SHEET: createAttachmentPolicy({
    allowedMimeTypes: ['application/pdf'],
    maxSizeBytes: 25 * 1024 * 1024,
  }),
  FISPQ: createAttachmentPolicy({
    allowedMimeTypes: ['application/pdf'],
    maxSizeBytes: 25 * 1024 * 1024,
  }),
}) satisfies Readonly<Record<ProductAttachmentCategory, AttachmentPolicy>>

export const PRODUCT_PHOTO_IMAGE_LIMITS = Object.freeze({
  maxWidth: 12_000,
  maxHeight: 12_000,
  maxPixels: 40_000_000,
})

export const PRODUCT_PHOTO_VARIANTS = Object.freeze([
  Object.freeze({
    key: 'THUMBNAIL' as const,
    maxWidth: 320,
    maxHeight: 320,
    format: 'webp' as const,
  }),
  Object.freeze({
    key: 'DISPLAY' as const,
    maxWidth: 1600,
    maxHeight: 1600,
    format: 'webp' as const,
  }),
])
export type ProductPhotoVariantKey =
  (typeof PRODUCT_PHOTO_VARIANTS)[number]['key']

export type ProductAttachmentValidationErrorCode =
  | AttachmentPolicyErrorCode
  | 'document_label_required'
  | 'document_photo_fields_forbidden'
  | 'image_dimensions_exceeded'
  | 'image_pixels_exceeded'
  | 'invalid_category'
  | 'invalid_effective_date'
  | 'invalid_image_dimensions'
  | 'invalid_object_key'
  | 'invalid_original_filename'
  | 'invalid_photo_fields'
  | 'invalid_upload_status'
  | 'multiple_primary_photos'
  | 'non_contiguous_photo_positions'
  | 'photo_document_fields_forbidden'
  | 'primary_photo_required'

export class ProductAttachmentValidationError extends Error {
  readonly code: ProductAttachmentValidationErrorCode

  constructor(code: ProductAttachmentValidationErrorCode, message: string) {
    super(message)
    this.name = 'ProductAttachmentValidationError'
    this.code = code
  }
}

export type ProductAttachmentDraft = Readonly<{
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
}>

export type ProductPhotoOrder = Readonly<{
  id: string
  photoPosition: number
  isPrimary: boolean
}>

const OPAQUE_OBJECT_KEY_PATTERN =
  /^attachments\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_ORIGINAL_FILENAME_LENGTH = 255
const MAX_DISPLAY_LABEL_LENGTH = 200
const MAX_DOCUMENT_VERSION_LENGTH = 100

export function validateProductPhotoDimensions(
  width: number,
  height: number,
): Readonly<{ width: number; height: number }> {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new ProductAttachmentValidationError(
      'invalid_image_dimensions',
      'Photo dimensions must be positive integers',
    )
  }
  if (
    width > PRODUCT_PHOTO_IMAGE_LIMITS.maxWidth ||
    height > PRODUCT_PHOTO_IMAGE_LIMITS.maxHeight
  ) {
    throw new ProductAttachmentValidationError(
      'image_dimensions_exceeded',
      'Photo dimensions exceed the supported boundary',
    )
  }
  if (width * height > PRODUCT_PHOTO_IMAGE_LIMITS.maxPixels) {
    throw new ProductAttachmentValidationError(
      'image_pixels_exceeded',
      'Photo pixel count exceeds the decompression safety boundary',
    )
  }
  return Object.freeze({ width, height })
}

export function validateProductAttachmentDraft(input: unknown): ProductAttachmentDraft {
  if (!isRecord(input) || !isCategory(input.category)) {
    throw new ProductAttachmentValidationError(
      'invalid_category',
      'Product attachment category is invalid',
    )
  }

  if (
    typeof input.objectKey !== 'string' ||
    !OPAQUE_OBJECT_KEY_PATTERN.test(input.objectKey)
  ) {
    throw new ProductAttachmentValidationError(
      'invalid_object_key',
      'Product attachment object key must be an opaque storage identifier',
    )
  }

  const originalFilename = normalizeRequiredText(
    input.originalFilename,
    MAX_ORIGINAL_FILENAME_LENGTH,
  )
  if (originalFilename === null) {
    throw new ProductAttachmentValidationError(
      'invalid_original_filename',
      'Original filename is required as protected metadata',
    )
  }

  if (!isUploadStatus(input.uploadStatus)) {
    throw new ProductAttachmentValidationError(
      'invalid_upload_status',
      'Product attachment upload status is invalid',
    )
  }

  let declaration
  try {
    declaration = validateUploadDeclaration(PRODUCT_ATTACHMENT_POLICIES[input.category], {
      checksumSha256: input.checksumSha256,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    })
  } catch (error) {
    if (error instanceof AttachmentPolicyError) {
      throw new ProductAttachmentValidationError(error.code, error.message)
    }
    throw error
  }

  const displayLabel = normalizeOptionalText(input.displayLabel, MAX_DISPLAY_LABEL_LENGTH)
  const documentVersion = normalizeOptionalText(
    input.documentVersion,
    MAX_DOCUMENT_VERSION_LENGTH,
  )
  const effectiveDate = normalizeOptionalText(input.effectiveDate, 10)

  if (input.category === 'PHOTO') {
    if (displayLabel !== null || documentVersion !== null || effectiveDate !== null) {
      throw new ProductAttachmentValidationError(
        'photo_document_fields_forbidden',
        'Photo attachments cannot carry document metadata',
      )
    }
    if (
      !Number.isSafeInteger(input.photoPosition) ||
      (input.photoPosition as number) < 0 ||
      typeof input.isPrimary !== 'boolean'
    ) {
      throw new ProductAttachmentValidationError(
        'invalid_photo_fields',
        'Photo position and primary state are required',
      )
    }
  } else {
    if (displayLabel === null) {
      throw new ProductAttachmentValidationError(
        'document_label_required',
        'Document display label is required',
      )
    }
    if (input.photoPosition !== null || input.isPrimary !== false) {
      throw new ProductAttachmentValidationError(
        'document_photo_fields_forbidden',
        'Documents cannot carry photo ordering fields',
      )
    }
    if (effectiveDate !== null && !dateSchema.safeParse(effectiveDate).success) {
      throw new ProductAttachmentValidationError(
        'invalid_effective_date',
        'Document effective date must be a real ISO calendar date',
      )
    }
  }

  return Object.freeze({
    category: input.category,
    objectKey: input.objectKey,
    originalFilename,
    displayLabel,
    documentVersion,
    effectiveDate,
    ...declaration,
    uploadStatus: input.uploadStatus,
    photoPosition: input.category === 'PHOTO' ? (input.photoPosition as number) : null,
    isPrimary: input.category === 'PHOTO' ? input.isPrimary === true : false,
  })
}

export function validateProductPhotoSet(
  photos: readonly ProductPhotoOrder[],
): readonly ProductPhotoOrder[] {
  if (photos.length === 0) return Object.freeze([])

  const ordered = [...photos].sort((left, right) => left.photoPosition - right.photoPosition)
  const primaryCount = ordered.filter((photo) => photo.isPrimary).length
  if (primaryCount === 0) {
    throw new ProductAttachmentValidationError(
      'primary_photo_required',
      'Exactly one primary photo is required when photos exist',
    )
  }
  if (primaryCount > 1) {
    throw new ProductAttachmentValidationError(
      'multiple_primary_photos',
      'Only one product photo can be primary',
    )
  }
  if (
    ordered.some(
      (photo, expectedPosition) =>
        !Number.isSafeInteger(photo.photoPosition) ||
        photo.photoPosition !== expectedPosition,
    )
  ) {
    throw new ProductAttachmentValidationError(
      'non_contiguous_photo_positions',
      'Product photo positions must be unique and contiguous from zero',
    )
  }

  return Object.freeze(ordered.map((photo) => Object.freeze({ ...photo })))
}

function normalizeRequiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null
  return normalizeRequiredText(value, maxLength)
}

function isCategory(value: unknown): value is ProductAttachmentCategory {
  return PRODUCT_ATTACHMENT_CATEGORIES.includes(value as ProductAttachmentCategory)
}

function isUploadStatus(value: unknown): value is ProductAttachmentUploadStatus {
  return PRODUCT_ATTACHMENT_UPLOAD_STATUSES.includes(value as ProductAttachmentUploadStatus)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
