import { z } from 'zod'
import { uuidSchema } from '@/domain/primitives/uuid'

/**
 * Pure contract for private document logo assets referenced by the canonical
 * settings schema (`documents.logoAssetId`). No React, DOM, storage, or
 * database imports — this module is the normative boundary shared by the
 * service, persistence, and UI layers.
 *
 * Logos are small raster images stored privately under opaque keys. Active
 * assets are permanent because issued-document snapshots carry their id;
 * only abandoned staged uploads may be purged. No public URL ever exists:
 * previews use short-lived signed access and document rendering reads bytes
 * through authenticated server code.
 */

/** 2 MiB — generous for a document header logo, tight enough to bound abuse. */
export const DOCUMENT_LOGO_MAX_SIZE_BYTES = 2 * 1024 * 1024

export const DOCUMENT_LOGO_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export type DocumentLogoMimeType = (typeof DOCUMENT_LOGO_ALLOWED_MIME_TYPES)[number]

export const DOCUMENT_LOGO_IMAGE_LIMITS = Object.freeze({
  maxWidth: 4_096,
  maxHeight: 4_096,
  maxPixels: 8_000_000,
})

export type DocumentLogoStatus = 'staged' | 'active' | 'purged'

export type DocumentLogoErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'DISALLOWED_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_CONTENT'
  | 'CHECKSUM_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'IMAGE_DECODE_FAILED'
  | 'IMAGE_DIMENSIONS_EXCEEDED'
  | 'INVALID_STATE'
  | 'STORAGE_UNAVAILABLE'
  | 'CONFLICT'

export class DocumentLogoValidationError extends Error {
  readonly code: DocumentLogoErrorCode

  constructor(code: DocumentLogoErrorCode, message: string) {
    super(message)
    this.name = 'DocumentLogoValidationError'
    this.code = code
  }
}

const mimeTypeSchema = z.enum(DOCUMENT_LOGO_ALLOWED_MIME_TYPES)

const sizeBytesSchema = z
  .number({ error: 'O tamanho do arquivo é obrigatório' })
  .int('O tamanho do arquivo deve ser um número inteiro de bytes')
  .positive('O tamanho do arquivo deve ser positivo')
  .max(
    DOCUMENT_LOGO_MAX_SIZE_BYTES,
    `O logo deve ter no máximo ${DOCUMENT_LOGO_MAX_SIZE_BYTES} bytes`,
  )

/** Canonical base64 SHA-256 digest of the exact upload bytes. */
const checksumSha256Schema = z
  .string()
  .regex(
    /^[A-Za-z0-9+/]{43}=$/,
    'O checksum SHA-256 deve usar base64 canônico',
  )
  .refine((value) => {
    const bytes = Buffer.from(value, 'base64')
    return bytes.byteLength === 32 && bytes.toString('base64') === value
  }, 'O checksum SHA-256 deve usar base64 canônico')

const originalFilenameSchema = z
  .string()
  .trim()
  .min(1, 'O nome do arquivo é obrigatório')
  .max(255, 'O nome do arquivo deve ter no máximo 255 caracteres')

/**
 * Client declaration of the bytes it is about to upload. Validated before any
 * storage interaction; every field is re-verified against the actual object
 * during finalization.
 */
export const documentLogoUploadDeclarationSchema = z.strictObject({
  filename: originalFilenameSchema,
  mimeType: mimeTypeSchema,
  sizeBytes: sizeBytesSchema,
  checksumSha256: checksumSha256Schema,
})

export type DocumentLogoUploadDeclaration = z.output<
  typeof documentLogoUploadDeclarationSchema
>

export const documentLogoAssetIdSchema = uuidSchema

/** Opaque private-storage key shape enforced by both code and database. */
export const DOCUMENT_LOGO_KEY_PATTERN =
  /^document-logos\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isDocumentLogoObjectKey(value: string): boolean {
  return DOCUMENT_LOGO_KEY_PATTERN.test(value)
}

/** Public projection of a logo asset: never carries keys or signed URLs. */
export type PublicDocumentLogoAsset = Readonly<{
  id: string
  status: DocumentLogoStatus
  filename: string
  mimeType: DocumentLogoMimeType
  sizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
}>

export function toPublicDocumentLogoAsset(asset: Readonly<{
  id: string
  status: DocumentLogoStatus
  originalFilename: string
  mimeType: string
  sizeBytes: bigint | number
  width: number | null
  height: number | null
  createdAt: Date
}>): PublicDocumentLogoAsset {
  return Object.freeze({
    id: asset.id,
    status: asset.status,
    filename: asset.originalFilename,
    mimeType: asset.mimeType as DocumentLogoMimeType,
    sizeBytes: Number(asset.sizeBytes),
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt.toISOString(),
  })
}
