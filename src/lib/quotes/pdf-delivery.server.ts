import { createHash } from 'node:crypto'
import {
  QUOTE_PDF_MIME_TYPE,
  QuotePdfGenerationError,
  type QuotePdfArtifact,
  type QuotePdfGenerationErrorCode,
  type ImmutableQuotePdfSnapshot,
  type QuotePdfTemplateIdentity,
} from './pdf-artifacts.server'

export type { QuotePdfArtifact } from './pdf-artifacts.server'

export type QuotePdfDeliveryRole = 'admin' | 'representative' | 'read_only'

export interface QuotePdfDeliveryActor {
  readonly id: string
  readonly role: QuotePdfDeliveryRole
  readonly tenantId: string
}

export interface QuotePdfAccessScope {
  readonly tenantId: string
  readonly ownerUserId: string
  readonly assignedUserIds: readonly string[]
}

export type QuotePdfAuthorizationOutcome = 'allow' | 'forbidden' | 'not_found'

/**
 * Viewing/downloading matrix. Mirrors the strictest existing precedent
 * (order attachments): read-only actors may inspect generation status for
 * quotes in their scope, but only admins and in-scope representatives may
 * retrieve document bytes or trigger regeneration.
 */
export function authorizeQuotePdfDownload(
  actor: QuotePdfDeliveryActor,
  scope: QuotePdfAccessScope,
): QuotePdfAuthorizationOutcome {
  const visibility = resolveVisibility(actor, scope)
  if (visibility !== 'allow') return visibility
  if (actor.role === 'read_only') return 'forbidden'
  return 'allow'
}

/** Regeneration is a mutation: it follows the quote command matrix shape. */
export function authorizeQuotePdfRegeneration(
  actor: QuotePdfDeliveryActor,
  scope: QuotePdfAccessScope,
): QuotePdfAuthorizationOutcome {
  const visibility = resolveVisibility(actor, scope)
  if (visibility !== 'allow') return visibility
  if (actor.role === 'read_only') return 'forbidden'
  return 'allow'
}

/** Status polling is a redacted-safe read permitted inside scope. */
export function authorizeQuotePdfStatus(
  actor: QuotePdfDeliveryActor,
  scope: QuotePdfAccessScope,
): QuotePdfAuthorizationOutcome {
  return resolveVisibility(actor, scope)
}

function resolveVisibility(
  actor: QuotePdfDeliveryActor,
  scope: QuotePdfAccessScope,
): QuotePdfAuthorizationOutcome {
  if (actor.tenantId !== scope.tenantId) return 'not_found'
  if (actor.role === 'admin') return 'allow'
  const inScope =
    scope.ownerUserId === actor.id || scope.assignedUserIds.includes(actor.id)
  return inScope ? 'allow' : 'not_found'
}

export type QuotePdfDeliveryErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'ARTIFACT_NOT_COMPLETED'
  | 'GENERATION_FAILED'
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_INTEGRITY_FAILED'

const ERROR_STATUS: Readonly<Record<QuotePdfDeliveryErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  ARTIFACT_NOT_COMPLETED: 409,
  GENERATION_FAILED: 422,
  STORAGE_UNAVAILABLE: 503,
  STORAGE_INTEGRITY_FAILED: 503,
}

const RETRYABLE_GENERATION_CODES: readonly QuotePdfGenerationErrorCode[] = [
  'render_timeout',
  'storage_failed',
  'persistence_failed',
  'stale_generation_claim',
  'generation_wait_timeout',
]

export class QuotePdfDeliveryError extends Error {
  readonly code: QuotePdfDeliveryErrorCode
  readonly status: number
  readonly retryable: boolean
  /** Stable pipeline error code surfaced for UI messaging, never internal text. */
  readonly reason: string | null

  constructor(
    code: QuotePdfDeliveryErrorCode,
    options: Readonly<{ retryable?: boolean; reason?: string | null }> = {},
  ) {
    super(code)
    this.name = 'QuotePdfDeliveryError'
    this.code = code
    this.status = ERROR_STATUS[code]
    this.retryable = options.retryable ?? false
    this.reason = options.reason ?? null
  }
}

export type QuotePdfTemplateVariantLabel = 'summary' | 'commercial'

export type QuotePdfArtifactStatusView =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'generating'
      readonly artifactId: string
      readonly attemptCount: number
      readonly startedAt: string
    }
  | {
      readonly kind: 'failed'
      readonly artifactId: string
      readonly attemptCount: number
      readonly errorCode: QuotePdfGenerationErrorCode
      readonly message: string
      readonly retryable: boolean
    }
  | {
      readonly kind: 'completed'
      readonly artifactId: string
      readonly snapshotVersion: number
      readonly templateVariant: QuotePdfTemplateVariantLabel
      readonly sizeBytes: number
      readonly pageCount: number
      readonly outputChecksum: string
      readonly completedAt: string
    }

export interface QuotePdfDeliveryIdentity {
  readonly quoteId: string
  readonly snapshotId: string
  readonly snapshotVersion: number
  readonly templateId: string
  readonly templateVersion: number
}

export interface QuotePdfDeliveryRepository {
  findByIdentity(identity: QuotePdfDeliveryIdentity): Promise<QuotePdfArtifact | null>
}

export interface QuotePdfPrivateObjectReader {
  get(key: string): Promise<Uint8Array | null>
}

export type QuotePdfDeliveryAuditAction =
  | 'quote.pdf.generated'
  | 'quote.pdf.download'

export interface QuotePdfDeliveryAuditEvent {
  readonly action: QuotePdfDeliveryAuditAction
  readonly actorId: string
  readonly quoteId: string
  readonly artifactId: string
  readonly snapshotVersion: number
  readonly templateVariant: QuotePdfTemplateVariantLabel
  readonly occurredAt: Date
  /** 'rendered' for a fresh claim, 'reused' when an immutable artifact answered. */
  readonly outcome: 'rendered' | 'reused' | 'inline' | 'attachment'
}

export interface QuotePdfDeliveryAuditSink {
  append(event: QuotePdfDeliveryAuditEvent): Promise<void>
}

export interface QuotePdfDeliveryServiceDependencies {
  readonly loadQuoteScope: (
    quoteId: string,
  ) => Promise<(QuotePdfAccessScope & { readonly quoteNumber: string }) | null>
  readonly repository: QuotePdfDeliveryRepository
  readonly storage: QuotePdfPrivateObjectReader
  readonly audit: QuotePdfDeliveryAuditSink
  readonly generate: (input: Readonly<{
    quoteId: string
    snapshot: ImmutableQuotePdfSnapshot
    template: QuotePdfTemplateIdentity
  }>) => Promise<QuotePdfArtifact>
  readonly now?: () => Date
}

export function createQuotePdfDeliveryService(
  dependencies: QuotePdfDeliveryServiceDependencies,
) {
  const now = dependencies.now ?? (() => new Date())

  async function requireScope(quoteId: string) {
    if (!isUuid(quoteId)) {
      throw new QuotePdfDeliveryError('INVALID_REQUEST')
    }
    const scope = await dependencies.loadQuoteScope(quoteId)
    if (!scope) throw new QuotePdfDeliveryError('NOT_FOUND')
    return scope
  }

  async function requireArtifact(identity: QuotePdfDeliveryIdentity): Promise<QuotePdfArtifact> {
    validateIdentity(identity)
    const artifact = await dependencies.repository.findByIdentity(identity)
    if (!artifact) throw new QuotePdfDeliveryError('NOT_FOUND')
    return artifact
  }

  return Object.freeze({
    /**
     * Stable polling payload for the UI. Never exposes object keys, storage
     * locations, or signed URLs.
     */
    async status(input: Readonly<{
      actor: QuotePdfDeliveryActor
      identity: QuotePdfDeliveryIdentity
    }>): Promise<QuotePdfArtifactStatusView> {
      const scope = await requireScope(input.identity.quoteId)
      requireAuthorized(authorizeQuotePdfStatus(input.actor, scope))
      const artifact = await dependencies.repository.findByIdentity(input.identity)
      if (!artifact) return { kind: 'idle' }
      return toStatusView(artifact)
    },

    /**
     * Requests generation or regeneration. Completed immutable artifacts are
     * reused verbatim; failed artifacts are retried through the pipeline's
     * atomic claim protocol.
     */
    async generate(input: Readonly<{
      actor: QuotePdfDeliveryActor
      quoteId: string
      snapshot: ImmutableQuotePdfSnapshot
      template: QuotePdfTemplateIdentity
    }>): Promise<QuotePdfArtifactStatusView> {
      const scope = await requireScope(input.quoteId)
      requireAuthorized(authorizeQuotePdfRegeneration(input.actor, scope))

      let artifact: QuotePdfArtifact
      try {
        artifact = await dependencies.generate({
          quoteId: input.quoteId,
          snapshot: input.snapshot,
          template: input.template,
        })
      } catch (error) {
        throw toDeliveryError(error)
      }

      await dependencies.audit.append({
        action: 'quote.pdf.generated',
        actorId: input.actor.id,
        quoteId: artifact.quoteId,
        artifactId: artifact.id,
        snapshotVersion: artifact.snapshotVersion,
        templateVariant: artifact.templateVariant,
        occurredAt: now(),
        outcome: 'rendered',
      })
      return toStatusView(artifact)
    },

    /**
     * Streams the completed artifact's bytes for inline preview or attachment
     * download. Verifies stored bytes against the recorded immutable checksum
     * before responding.
     */
    async deliver(input: Readonly<{
      actor: QuotePdfDeliveryActor
      identity: QuotePdfDeliveryIdentity
      disposition: 'inline' | 'attachment'
    }>): Promise<{
      bytes: Uint8Array
      headers: Readonly<Record<string, string>>
    }> {
      const scope = await requireScope(input.identity.quoteId)
      requireAuthorized(authorizeQuotePdfDownload(input.actor, scope))
      const artifact = await requireArtifact(input.identity)
      if (artifact.status !== 'completed' || !artifact.objectKey) {
        throw new QuotePdfDeliveryError('ARTIFACT_NOT_COMPLETED')
      }

      const bytes = await dependencies.storage.get(artifact.objectKey)
      if (!bytes) {
        throw new QuotePdfDeliveryError('STORAGE_UNAVAILABLE', { retryable: true })
      }
      if (
        bytes.byteLength !== artifact.sizeBytes ||
        sha256Hex(bytes) !== artifact.outputChecksum
      ) {
        throw new QuotePdfDeliveryError('STORAGE_INTEGRITY_FAILED')
      }

      await dependencies.audit.append({
        action: 'quote.pdf.download',
        actorId: input.actor.id,
        quoteId: artifact.quoteId,
        artifactId: artifact.id,
        snapshotVersion: artifact.snapshotVersion,
        templateVariant: artifact.templateVariant,
        occurredAt: now(),
        outcome: input.disposition,
      })

      return {
        bytes,
        headers: buildQuotePdfResponseHeaders({
          filename: createQuotePdfFilename({
            quoteNumber: scope.quoteNumber,
            snapshotVersion: artifact.snapshotVersion,
            variant: artifact.templateVariant,
          }),
          disposition: input.disposition,
          sizeBytes: bytes.byteLength,
        }),
      }
    },
  })
}

function requireAuthorized(outcome: QuotePdfAuthorizationOutcome): void {
  if (outcome === 'not_found') throw new QuotePdfDeliveryError('NOT_FOUND')
  if (outcome === 'forbidden') throw new QuotePdfDeliveryError('FORBIDDEN')
}

function toStatusView(artifact: QuotePdfArtifact): QuotePdfArtifactStatusView {
  switch (artifact.status) {
    case 'generating':
      return {
        kind: 'generating',
        artifactId: artifact.id,
        attemptCount: artifact.attemptCount,
        startedAt: artifact.generationStartedAt.toISOString(),
      }
    case 'failed':
      return {
        kind: 'failed',
        artifactId: artifact.id,
        attemptCount: artifact.attemptCount,
        errorCode: artifact.errorCode ?? 'render_failed',
        message: artifact.errorMessage ?? 'A geração do PDF falhou.',
        retryable: RETRYABLE_GENERATION_CODES.includes(
          artifact.errorCode ?? 'render_failed',
        ),
      }
    case 'completed':
      return {
        kind: 'completed',
        artifactId: artifact.id,
        snapshotVersion: artifact.snapshotVersion,
        templateVariant: artifact.templateVariant,
        sizeBytes: artifact.sizeBytes ?? 0,
        pageCount: artifact.pageCount ?? 0,
        outputChecksum: artifact.outputChecksum ?? '',
        completedAt: (artifact.completedAt ?? artifact.createdAt).toISOString(),
      }
  }
}

function toDeliveryError(error: unknown): QuotePdfDeliveryError {
  if (error instanceof QuotePdfDeliveryError) return error
  if (error instanceof QuotePdfGenerationError) {
    if (error.code === 'snapshot_not_found') {
      return new QuotePdfDeliveryError('NOT_FOUND')
    }
    const retryable = RETRYABLE_GENERATION_CODES.includes(error.code)
    return new QuotePdfDeliveryError(retryable ? 'STORAGE_UNAVAILABLE' : 'GENERATION_FAILED', {
      retryable,
      reason: error.code,
    })
  }
  return new QuotePdfDeliveryError('GENERATION_FAILED', { reason: 'render_failed' })
}

function validateIdentity(identity: QuotePdfDeliveryIdentity): void {
  if (
    !isUuid(identity.quoteId) ||
    !isUuid(identity.snapshotId) ||
    !isUuid(identity.templateId) ||
    !Number.isInteger(identity.snapshotVersion) ||
    identity.snapshotVersion <= 0 ||
    !Number.isInteger(identity.templateVersion) ||
    identity.templateVersion <= 0
  ) {
    throw new QuotePdfDeliveryError('INVALID_REQUEST')
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Deterministic, sanitized download name carrying quote identity and the
 * immutable snapshot version, e.g. `ORC-2026-000123-v3-comercial.pdf`.
 */
export function createQuotePdfFilename(input: Readonly<{
  quoteNumber: string
  snapshotVersion: number
  variant: QuotePdfTemplateVariantLabel
}>): string {
  const safeNumber = sanitizeFilenameSegment(input.quoteNumber) || 'orcamento'
  const version = Number.isInteger(input.snapshotVersion) && input.snapshotVersion > 0
    ? input.snapshotVersion
    : 1
  const variant = input.variant === 'commercial' ? 'comercial' : 'resumida'
  return `${safeNumber}-v${version}-${variant}.pdf`
}

function sanitizeFilenameSegment(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120)
}

/**
 * RFC-compatible Content-Disposition plus safe cache headers for immutable
 * private artifacts. The ASCII fallback keeps legacy clients working; the
 * RFC 5987 `filename*` parameter carries the UTF-8 name.
 */
export function buildQuotePdfResponseHeaders(input: Readonly<{
  filename: string
  disposition: 'inline' | 'attachment'
  sizeBytes: number
}>): Readonly<Record<string, string>> {
  const fallback = sanitizeFilenameSegment(
    input.filename.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''),
  )
  const encoded = percentEncodeUtf8(input.filename)
  return Object.freeze({
    'Content-Type': QUOTE_PDF_MIME_TYPE,
    'Content-Length': String(input.sizeBytes),
    'Content-Disposition': `${input.disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    // Bytes are immutable per artifact identity, but access is authorized:
    // private caching is fine, shared caches and stale copies are not.
    'Cache-Control': 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
}

function percentEncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let out = ''
  for (const byte of bytes) {
    const isUnreserved =
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x2d ||
      byte === 0x2e ||
      byte === 0x5f ||
      byte === 0x7e
    out += isUnreserved
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

export function createInMemoryQuotePdfDeliveryRepository(): QuotePdfDeliveryRepository & {
  seed(artifact: QuotePdfArtifact): void
  snapshot(): readonly QuotePdfArtifact[]
} {
  const artifacts = new Map<string, QuotePdfArtifact>()
  const keyOf = (identity: QuotePdfDeliveryIdentity) =>
    [
      identity.quoteId,
      identity.snapshotId,
      identity.snapshotVersion,
      identity.templateId,
      identity.templateVersion,
    ].join('|')
  return {
    async findByIdentity(identity) {
      const found = artifacts.get(keyOf(identity))
      return found ? structuredClone(found) : null
    },
    seed(artifact) {
      artifacts.set(
        keyOf({
          quoteId: artifact.quoteId,
          snapshotId: artifact.snapshotId,
          snapshotVersion: artifact.snapshotVersion,
          templateId: artifact.templateId,
          templateVersion: artifact.templateVersion,
        }),
        structuredClone(artifact),
      )
    },
    snapshot() {
      return [...artifacts.values()].map((artifact) => structuredClone(artifact))
    },
  }
}

export function createInMemoryQuotePdfObjectStore(): QuotePdfPrivateObjectReader & {
  put(key: string, bytes: Uint8Array): void
  keys(): readonly string[]
} {
  const objects = new Map<string, Uint8Array>()
  return {
    async get(key) {
      const bytes = objects.get(key)
      return bytes ? new Uint8Array(bytes) : null
    },
    put(key, bytes) {
      objects.set(key, new Uint8Array(bytes))
    },
    keys() {
      return [...objects.keys()]
    },
  }
}

export function createInMemoryQuotePdfAuditSink(): QuotePdfDeliveryAuditSink & {
  snapshot(): readonly QuotePdfDeliveryAuditEvent[]
} {
  const events: QuotePdfDeliveryAuditEvent[] = []
  return {
    async append(event) {
      events.push(structuredClone(event))
    },
    snapshot() {
      return structuredClone(events)
    },
  }
}
