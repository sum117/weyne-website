import { randomUUID } from 'node:crypto'

const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/
const SHA256_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=$/
const UUID_SCOPE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AttachmentPolicyErrorCode =
  | 'disallowed_mime_type'
  | 'file_too_large'
  | 'invalid_checksum'
  | 'invalid_mime_type'
  | 'invalid_policy'
  | 'invalid_scope'
  | 'invalid_size'
  | 'missing_declaration'

export class AttachmentPolicyError extends Error {
  readonly code: AttachmentPolicyErrorCode

  constructor(code: AttachmentPolicyErrorCode, message: string) {
    super(message)
    this.name = 'AttachmentPolicyError'
    this.code = code
  }
}

export type AttachmentPolicy = Readonly<{
  allowedMimeTypes: readonly string[]
  maxSizeBytes: number
}>

export type UploadDeclaration = Readonly<{
  checksumSha256: string
  mimeType: string
  sizeBytes: number
}>

export function createAttachmentPolicy(input: {
  allowedMimeTypes: readonly string[]
  maxSizeBytes: number
}): AttachmentPolicy {
  if (!Number.isSafeInteger(input.maxSizeBytes) || input.maxSizeBytes < 1) {
    throw new AttachmentPolicyError(
      'invalid_policy',
      'Attachment maximum size must be a positive safe integer',
    )
  }

  const normalizedMimeTypes: string[] = []
  for (const allowedMimeType of input.allowedMimeTypes) {
    const normalizedMimeType = normalizeMimeType(allowedMimeType)
    if (normalizedMimeType === null) {
      throw new AttachmentPolicyError(
        'invalid_policy',
        'Attachment MIME allowlist must contain valid media types',
      )
    }
    if (!normalizedMimeTypes.includes(normalizedMimeType)) {
      normalizedMimeTypes.push(normalizedMimeType)
    }
  }

  if (normalizedMimeTypes.length === 0) {
    throw new AttachmentPolicyError(
      'invalid_policy',
      'Attachment MIME allowlist must contain valid media types',
    )
  }

  return Object.freeze({
    allowedMimeTypes: Object.freeze(normalizedMimeTypes),
    maxSizeBytes: input.maxSizeBytes,
  })
}

export function validateUploadDeclaration(
  policy: AttachmentPolicy,
  input: unknown,
): UploadDeclaration {
  if (!isRecord(input)) {
    throw new AttachmentPolicyError(
      'missing_declaration',
      'Attachment upload declaration is required',
    )
  }

  const mimeType = normalizeMimeType(input.mimeType)
  if (mimeType === null) {
    throw new AttachmentPolicyError(
      'invalid_mime_type',
      'Attachment MIME type is invalid',
    )
  }

  if (!policy.allowedMimeTypes.includes(mimeType)) {
    throw new AttachmentPolicyError(
      'disallowed_mime_type',
      'Attachment MIME type is not allowed',
    )
  }

  const sizeBytes = input.sizeBytes
  if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new AttachmentPolicyError(
      'invalid_size',
      'Attachment size must be a positive safe integer',
    )
  }

  if (sizeBytes > policy.maxSizeBytes) {
    throw new AttachmentPolicyError(
      'file_too_large',
      'Attachment exceeds the maximum permitted size',
    )
  }

  const checksumSha256 = input.checksumSha256
  if (!isCanonicalSha256Base64(checksumSha256)) {
    throw new AttachmentPolicyError(
      'invalid_checksum',
      'Attachment SHA-256 checksum must use canonical base64',
    )
  }

  return Object.freeze({
    checksumSha256,
    mimeType,
    sizeBytes,
  })
}

export function createAttachmentObjectKey(options: { scopeId?: string } = {}): string {
  const segments = ['attachments']

  if (options.scopeId !== undefined) {
    if (!UUID_SCOPE_PATTERN.test(options.scopeId)) {
      throw new AttachmentPolicyError(
        'invalid_scope',
        'Attachment scope must be an opaque UUID',
      )
    }
    segments.push(options.scopeId.toLowerCase())
  }

  segments.push(randomUUID())
  return segments.join('/')
}

function normalizeMimeType(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  return MIME_TYPE_PATTERN.test(normalized) ? normalized : null
}

function isCanonicalSha256Base64(value: unknown): value is string {
  if (typeof value !== 'string' || !SHA256_BASE64_PATTERN.test(value)) return false

  const bytes = Buffer.from(value, 'base64')
  return bytes.byteLength === 32 && bytes.toString('base64') === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
