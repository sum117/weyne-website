import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { Metadata as SharpMetadata } from 'sharp'
import { hasCapability, type Role } from '@/lib/auth/capabilities'
import {
  DOCUMENT_LOGO_ALLOWED_MIME_TYPES,
  DOCUMENT_LOGO_IMAGE_LIMITS,
  DocumentLogoValidationError,
  documentLogoUploadDeclarationSchema,
  isDocumentLogoObjectKey,
  toPublicDocumentLogoAsset,
  type DocumentLogoErrorCode,
  type DocumentLogoStatus,
  type PublicDocumentLogoAsset,
} from '@/domain/settings/document-logo-assets'

/**
 * Private document logo asset pipeline.
 *
 * Flow: `initiateUpload` stages metadata → the client PUTs bytes to a
 * short-lived signed URL → `finalizeUpload` verifies the stored object
 * (size, checksum, sniffed content type, decodable image, dimensions) and
 * marks it ready → `activateLogo` atomically commits the settings reference
 * together with the asset's `active` flip inside one transaction. A failed or
 * abandoned upload never touches settings: the previous logo stays referenced
 * and usable. Abandoned staged assets are purged (metadata + object) after a
 * grace period; active assets are permanent.
 *
 * Access is never a public URL: previews get short-lived signed URLs through
 * authorized endpoints, and document rendering reads verified bytes via
 * `readActiveLogoForRender`.
 */

export type DocumentLogoActor = Readonly<{
  id: string
  role: Role
}>

export class DocumentLogoApiError extends Error {
  readonly code: DocumentLogoErrorCode

  constructor(code: DocumentLogoErrorCode) {
    super(code)
    this.name = 'DocumentLogoApiError'
    this.code = code
  }
}

export type DocumentLogoRecord = Readonly<{
  id: string
  status: DocumentLogoStatus
  objectKey: string
  originalFilename: string
  mimeType: string
  sizeBytes: bigint
  checksumSha256: string
  width: number | null
  height: number | null
  createdAt: Date
  createdByUserId: string
}>

export interface DocumentLogoRepository {
  findById(assetId: string): Promise<DocumentLogoRecord | null>
  findStagedByChecksum(
    actorId: string,
    checksumSha256: string,
  ): Promise<DocumentLogoRecord | null>
  insert(asset: DocumentLogoRecord): Promise<void>
  markPurged(assetId: string, actorId: string, occurredAt: Date): Promise<void>
  listStagedOlderThan(cutoff: Date): Promise<readonly DocumentLogoRecord[]>
}

/**
 * Atomic activation boundary. The implementation must lock the settings row,
 * compare-and-swap on `expectedVersion`, write the new settings value with the
 * logo id, flip the asset to `active`, and append audit events — all in one
 * transaction that either fully commits or fully rolls back.
 */
export type DocumentLogoActivationTransaction = (input: Readonly<{
  assetId: string
  expectedVersion: number
  nextVersion: number
  actorUserId: string
  occurredAt: Date
  correlationId: string
}>) => Promise<
  | Readonly<{ ok: true; version: number }>
  | Readonly<{ ok: false; outcome: 'not-found' | 'conflict' }>
>

export interface DocumentLogoStorage {
  /** Signs a short-lived direct-upload URL for the staged object key. */
  signUpload(input: Readonly<{
    key: string
    mimeType: string
    sizeBytes: number
    expiresInSeconds: number
    now: Date
  }>): Promise<Readonly<{ url: string; expiresAt: Date }>>
  /** Signs a short-lived preview URL for an existing object key. */
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
  }>): Promise<void>
  delete(key: string): Promise<void>
}

export type DocumentLogoAuditAction =
  | 'document_logo.upload.initiated'
  | 'document_logo.upload.completed'
  | 'document_logo.upload.failed'
  | 'document_logo.activated'
  | 'document_logo.activation.failed'
  | 'document_logo.preview.authorized'
  | 'document_logo.render.read'
  | 'document_logo.purged'

export type DocumentLogoAuditEvent = Readonly<{
  action: DocumentLogoAuditAction
  actorId: string | null
  assetId: string | null
  outcome: 'OK' | DocumentLogoErrorCode
  detail?: string
  occurredAt: Date
}>

export interface DocumentLogoAuditSink {
  append(event: DocumentLogoAuditEvent): Promise<void>
}

/** Current settings reference needed to keep the previous logo safe. */
export interface DocumentLogoSettingsReader {
  currentVersion(): Promise<number | null>
  currentLogoAssetId(): Promise<string | null>
}

const UPLOAD_TTL_SECONDS_DEFAULT = 900
const DOWNLOAD_TTL_SECONDS_DEFAULT = 300
const STAGED_GRACE_MS_DEFAULT = 24 * 60 * 60 * 1_000

type ServiceDependencies = Readonly<{
  repository: DocumentLogoRepository
  storage: DocumentLogoStorage
  activation: DocumentLogoActivationTransaction
  settings: DocumentLogoSettingsReader
  audit: DocumentLogoAuditSink
  authenticate: (
    actor: DocumentLogoActor | null | undefined,
  ) => Promise<DocumentLogoActor | null>
  createId?: () => string
  now?: () => Date
  uploadTtlSeconds?: number
  downloadTtlSeconds?: number
  stagedGraceMs?: number
}>

function requireAdmin(
  actorInput: DocumentLogoActor | null | undefined,
  authenticate: ServiceDependencies['authenticate'],
): Promise<DocumentLogoActor> {
  return (async () => {
    const actor = await authenticate(actorInput)
    if (!actor) throw new DocumentLogoApiError('UNAUTHENTICATED')
    if (!hasCapability(actor.role, 'settings.update')) {
      throw new DocumentLogoApiError('FORBIDDEN')
    }
    return actor
  })()
}

function sha256Base64(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64')
}

async function inspectImage(bytes: Uint8Array): Promise<{
  mimeType: DocumentLogoAllowedMimeType
  width: number
  height: number
}> {
  let metadata: SharpMetadata
  try {
    metadata = await sharp(bytes, { failOn: 'error' }).metadata()
  } catch {
    throw new DocumentLogoValidationError(
      'IMAGE_DECODE_FAILED',
      'O arquivo não é uma imagem válida',
    )
  }
  if (
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.format === undefined
  ) {
    throw new DocumentLogoValidationError(
      'IMAGE_DECODE_FAILED',
      'O arquivo não é uma imagem válida',
    )
  }
  const formatMimeMap = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  } as const
  const mimeType = formatMimeMap[metadata.format as keyof typeof formatMimeMap]
  if (!mimeType) {
    throw new DocumentLogoValidationError(
      'DISALLOWED_FILE_TYPE',
      'O formato da imagem não é permitido',
    )
  }
  if (
    metadata.width > DOCUMENT_LOGO_IMAGE_LIMITS.maxWidth ||
    metadata.height > DOCUMENT_LOGO_IMAGE_LIMITS.maxHeight ||
    metadata.width * metadata.height > DOCUMENT_LOGO_IMAGE_LIMITS.maxPixels
  ) {
    throw new DocumentLogoValidationError(
      'IMAGE_DIMENSIONS_EXCEEDED',
      'As dimensões da imagem excedem o limite suportado',
    )
  }
  return { mimeType, width: metadata.width, height: metadata.height }
}

type DocumentLogoAllowedMimeType =
  (typeof DOCUMENT_LOGO_ALLOWED_MIME_TYPES)[number]

export type DocumentLogoServiceContract = Readonly<{
  initiateUpload: (input: {
    actor?: DocumentLogoActor | null
    declaration: unknown
  }) => Promise<
    | Readonly<{
        assetId: string
        upload: Readonly<{ method: 'PUT'; url: string; expiresAt: string }>
      }>
    | Readonly<{ error: DocumentLogoErrorCode }>
  >
  finalizeUpload: (input: {
    actor?: DocumentLogoActor | null
    assetId: string
  }) => Promise<PublicDocumentLogoAsset | Readonly<{ error: DocumentLogoErrorCode }>>
  activateLogo: (input: {
    actor?: DocumentLogoActor | null
    assetId: string
    expectedVersion: number
  }) => Promise<
    | Readonly<{ ok: true; asset: PublicDocumentLogoAsset; version: number }>
    | Readonly<{ ok: false; error: DocumentLogoErrorCode }>
  >
  previewLogo: (input: {
    actor?: DocumentLogoActor | null
    assetId: string
  }) => Promise<
    | Readonly<{
        preview: Readonly<{ method: 'GET'; url: string; expiresAt: string }>
        asset: PublicDocumentLogoAsset
      }>
    | Readonly<{ error: DocumentLogoErrorCode }>
  >
  readActiveLogoForRender: (input: {
    assetId: string
  }) => Promise<Readonly<{ bytes: Uint8Array; mimeType: string }> | null>
  purgeAbandonedStagedAsset: (input: {
    actor?: DocumentLogoActor | null
    assetId: string
  }) => Promise<
    Readonly<{ purged: boolean }> | Readonly<{ error: DocumentLogoErrorCode }>
  >
  purgeAbandonedStagedAssets: (input: {
    actor?: DocumentLogoActor | null
  }) => Promise<Readonly<{ purged: number; failed: number }>>
}>

export function createDocumentLogoService(
  dependencies: ServiceDependencies,
): DocumentLogoServiceContract {
  const now = dependencies.now ?? (() => new Date())
  const createId = dependencies.createId ?? (() => randomUUID())
  const uploadTtlSeconds = dependencies.uploadTtlSeconds ?? UPLOAD_TTL_SECONDS_DEFAULT
  const downloadTtlSeconds =
    dependencies.downloadTtlSeconds ?? DOWNLOAD_TTL_SECONDS_DEFAULT
  const stagedGraceMs = dependencies.stagedGraceMs ?? STAGED_GRACE_MS_DEFAULT

  async function record(event: DocumentLogoAuditEvent): Promise<void> {
    try {
      await dependencies.audit.append(event)
    } catch {
      // Audit is best-effort on non-critical paths; activation failures are
      // recorded explicitly by the caller because they gate correctness.
    }
  }

  return Object.freeze({
    /**
     * Stages an upload declaration and returns a short-lived signed PUT URL.
     * Nothing here touches settings; a crash at any point leaves only an
     * abandoned staged row that the purge path cleans up safely.
     */
    async initiateUpload(input: {
      actor?: DocumentLogoActor | null
      declaration: unknown
    }): Promise<
      | Readonly<{
          assetId: string
          upload: Readonly<{ method: 'PUT'; url: string; expiresAt: string }>
        }>
      | Readonly<{ error: DocumentLogoErrorCode }>
    > {
      const actor = await requireAdmin(input.actor, dependencies.authenticate)
      const parsed = documentLogoUploadDeclarationSchema.safeParse(input.declaration)
      if (!parsed.success) {
        await record({
          action: 'document_logo.upload.failed',
          actorId: actor.id,
          assetId: null,
          outcome: 'INVALID_REQUEST',
          occurredAt: now(),
        })
        return { error: 'INVALID_REQUEST' }
      }

      // Reuse an identical in-flight staged upload instead of piling up
      // duplicate objects for retries of the same bytes.
      const prior = await dependencies.repository.findStagedByChecksum(
        actor.id,
        parsed.data.checksumSha256,
      )
      if (prior) {
        try {
          const signed = await dependencies.storage.signUpload({
            key: prior.objectKey,
            mimeType: prior.mimeType,
            sizeBytes: Number(prior.sizeBytes),
            expiresInSeconds: uploadTtlSeconds,
            now: now(),
          })
          return {
            assetId: prior.id,
            upload: {
              method: 'PUT',
              url: signed.url,
              expiresAt: signed.expiresAt.toISOString(),
            },
          }
        } catch {
          return { error: 'STORAGE_UNAVAILABLE' }
        }
      }

      const timestamp = now()
      const assetId = createId()
      const objectKey = `document-logos/${assetId}`
      if (!isDocumentLogoObjectKey(objectKey)) {
        throw new DocumentLogoApiError('INVALID_REQUEST')
      }
      const asset: DocumentLogoRecord = Object.freeze({
        id: assetId,
        status: 'staged',
        objectKey,
        originalFilename: parsed.data.filename,
        mimeType: parsed.data.mimeType,
        sizeBytes: BigInt(parsed.data.sizeBytes),
        checksumSha256: Buffer.from(parsed.data.checksumSha256, 'base64').toString('hex'),
        width: null,
        height: null,
        createdAt: timestamp,
        createdByUserId: actor.id,
      })
      try {
        await dependencies.repository.insert(asset)
      } catch {
        return { error: 'STORAGE_UNAVAILABLE' }
      }
      try {
        const signed = await dependencies.storage.signUpload({
          key: objectKey,
          mimeType: asset.mimeType,
          sizeBytes: Number(asset.sizeBytes),
          expiresInSeconds: uploadTtlSeconds,
          now: timestamp,
        })
        await record({
          action: 'document_logo.upload.initiated',
          actorId: actor.id,
          assetId,
          outcome: 'OK',
          occurredAt: timestamp,
        })
        return {
          assetId,
          upload: {
            method: 'PUT',
            url: signed.url,
            expiresAt: signed.expiresAt.toISOString(),
          },
        }
      } catch {
        // Signing failed: stage is abandoned and will be purged by cleanup;
        // no settings state was touched.
        await record({
          action: 'document_logo.upload.failed',
          actorId: actor.id,
          assetId,
          outcome: 'STORAGE_UNAVAILABLE',
          occurredAt: now(),
        })
        return { error: 'STORAGE_UNAVAILABLE' }
      }
    },

    /**
     * Verifies the uploaded object byte-for-byte and records its dimensions.
     * On any mismatch the staged asset is left for purge and the previous
     * settings logo remains untouched.
     */
    async finalizeUpload(input: {
      actor?: DocumentLogoActor | null
      assetId: string
    }): Promise<PublicDocumentLogoAsset | Readonly<{ error: DocumentLogoErrorCode }>> {
      const actor = await requireAdmin(input.actor, dependencies.authenticate)
      const asset = await dependencies.repository.findById(input.assetId)
      if (!asset || asset.status === 'purged') {
        return { error: 'NOT_FOUND' }
      }
      if (asset.status === 'active') {
        return toPublicDocumentLogoAsset(asset)
      }

      let bytes: Uint8Array | null
      try {
        bytes = await dependencies.storage.read(asset.objectKey)
      } catch {
        return { error: 'STORAGE_UNAVAILABLE' }
      }
      if (!bytes) return { error: 'NOT_FOUND' }

      const fail = async (code: DocumentLogoErrorCode) => {
        await record({
          action: 'document_logo.upload.failed',
          actorId: actor.id,
          assetId: asset.id,
          outcome: code,
          occurredAt: now(),
        })
        return { error: code }
      }

      if (BigInt(bytes.byteLength) !== asset.sizeBytes) return fail('SIZE_MISMATCH')
      if (sha256Base64(bytes) !==
        Buffer.from(asset.checksumSha256, 'hex').toString('base64')) {
        return fail('CHECKSUM_MISMATCH')
      }
      let image: Awaited<ReturnType<typeof inspectImage>>
      try {
        image = await inspectImage(bytes)
      } catch (error) {
        if (error instanceof DocumentLogoValidationError) return fail(error.code)
        throw error
      }
      if (!DOCUMENT_LOGO_ALLOWED_MIME_TYPES.includes(image.mimeType)) {
        return fail('DISALLOWED_FILE_TYPE')
      }

      // Persist verified dimensions by replacing the staged row's projection:
      // dimensions live on the same record, so re-insert semantics are handled
      // by the repository contract below.
      await dependencies.repository.insert({
        ...asset,
        width: image.width,
        height: image.height,
      })
      await record({
        action: 'document_logo.upload.completed',
        actorId: actor.id,
        assetId: asset.id,
        outcome: 'OK',
        occurredAt: now(),
      })
      return toPublicDocumentLogoAsset({ ...asset, width: image.width, height: image.height })
    },

    /**
     * Atomically swaps the settings logo reference: locks the settings row,
     * CAS-checks `expectedVersion`, writes the new payload with this asset id,
     * flips the asset to `active`, and appends audit events in one
     * transaction. The previously active logo object is intentionally kept —
     * issued documents may still reference it — so a failure anywhere leaves
     * the last-known valid logo usable.
     */
    async activateLogo(input: {
      actor?: DocumentLogoActor | null
      assetId: string
      expectedVersion: number
    }): Promise<
      | Readonly<{ ok: true; asset: PublicDocumentLogoAsset; version: number }>
      | Readonly<{ ok: false; error: DocumentLogoErrorCode }>
    > {
      const actor = await requireAdmin(input.actor, dependencies.authenticate)
      const asset = await dependencies.repository.findById(input.assetId)
      if (!asset || asset.status === 'purged') {
        return { ok: false, error: 'NOT_FOUND' }
      }
      if (asset.status === 'active') {
        return { ok: false, error: 'INVALID_STATE' }
      }
      const currentVersion = await dependencies.settings.currentVersion()
      if (currentVersion === null) {
        return { ok: false, error: 'NOT_FOUND' }
      }
      if (currentVersion !== input.expectedVersion) {
        return { ok: false, error: 'CONFLICT' }
      }
      const currentLogoAssetId = await dependencies.settings.currentLogoAssetId()

      const result = await dependencies.activation({
        assetId: asset.id,
        expectedVersion: input.expectedVersion,
        nextVersion: input.expectedVersion + 1,
        actorUserId: actor.id,
        occurredAt: now(),
        correlationId: createId(),
      })
      if (!result.ok) {
        await record({
          action: 'document_logo.activation.failed',
          actorId: actor.id,
          assetId: asset.id,
          outcome: result.outcome === 'conflict' ? 'CONFLICT' : 'NOT_FOUND',
          occurredAt: now(),
        })
        return { ok: false, error: result.outcome === 'conflict' ? 'CONFLICT' : 'NOT_FOUND' }
      }

      await record({
        action: 'document_logo.activated',
        actorId: actor.id,
        assetId: asset.id,
        outcome: 'OK',
        detail: JSON.stringify({
          previousLogoAssetId: currentLogoAssetId,
          version: result.version,
        }),
        occurredAt: now(),
      })
      return { ok: true, asset: toPublicDocumentLogoAsset({ ...asset, status: 'active' }), version: result.version }
    },

    /**
     * Short-lived signed preview access for an admin viewer. Returns an
     * ephemeral URL that must never be persisted; there is no public URL.
     */
    async previewLogo(input: {
      actor?: DocumentLogoActor | null
      assetId: string
    }): Promise<
      | Readonly<{
          preview: Readonly<{ method: 'GET'; url: string; expiresAt: string }>
          asset: PublicDocumentLogoAsset
        }>
      | Readonly<{ error: DocumentLogoErrorCode }>
    > {
      const actor = await requireAdmin(input.actor, dependencies.authenticate)
      const asset = await dependencies.repository.findById(input.assetId)
      if (!asset || asset.status === 'purged') {
        return { error: 'NOT_FOUND' }
      }
      let signed
      try {
        signed = await dependencies.storage.signDownload({
          key: asset.objectKey,
          expiresInSeconds: downloadTtlSeconds,
          now: now(),
        })
      } catch {
        return { error: 'STORAGE_UNAVAILABLE' }
      }
      await record({
        action: 'document_logo.preview.authorized',
        actorId: actor.id,
        assetId: asset.id,
        outcome: 'OK',
        occurredAt: now(),
      })
      return {
        preview: {
          method: 'GET',
          url: signed.url,
          expiresAt: signed.expiresAt.toISOString(),
        },
        asset: toPublicDocumentLogoAsset(asset),
      }
    },

    /**
     * Internal render-path read used by PDF generation for the currently
     * referenced logo. Verifies size and checksum before returning bytes so a
     * corrupted or swapped object can never reach a document.
     */
    async readActiveLogoForRender(input: {
      assetId: string
    }): Promise<Readonly<{ bytes: Uint8Array; mimeType: string }> | null> {
      const asset = await dependencies.repository.findById(input.assetId)
      if (!asset || asset.status !== 'active') return null
      let bytes: Uint8Array | null
      try {
        bytes = await dependencies.storage.read(asset.objectKey)
      } catch {
        return null
      }
      if (!bytes) return null
      if (
        BigInt(bytes.byteLength) !== asset.sizeBytes ||
        sha256Base64(bytes) !==
          Buffer.from(asset.checksumSha256, 'hex').toString('base64')
      ) {
        await record({
          action: 'document_logo.render.read',
          actorId: null,
          assetId: asset.id,
          outcome: 'CHECKSUM_MISMATCH',
          occurredAt: now(),
        })
        return null
      }
      await record({
        action: 'document_logo.render.read',
        actorId: null,
        assetId: asset.id,
        outcome: 'OK',
        occurredAt: now(),
      })
      return Object.freeze({ bytes, mimeType: asset.mimeType })
    },

    /**
     * Purges one abandoned staged asset (metadata + object). Active assets
     * are permanent and can never be purged through this path.
     */
    async purgeAbandonedStagedAsset(input: {
      actor?: DocumentLogoActor | null
      assetId: string
    }): Promise<Readonly<{ purged: boolean }> | Readonly<{ error: DocumentLogoErrorCode }>> {
      const actor = await requireAdmin(input.actor, dependencies.authenticate)
      const asset = await dependencies.repository.findById(input.assetId)
      if (!asset || asset.status === 'purged') {
        return { error: 'NOT_FOUND' }
      }
      if (asset.status === 'active') {
        return { error: 'INVALID_STATE' }
      }
      if (now().getTime() - asset.createdAt.getTime() < stagedGraceMs) {
        return { error: 'INVALID_STATE' }
      }
      try {
        await dependencies.storage.delete(asset.objectKey)
      } catch {
        return { error: 'STORAGE_UNAVAILABLE' }
      }
      await dependencies.repository.markPurged(asset.id, actor.id, now())
      await record({
        action: 'document_logo.purged',
        actorId: actor.id,
        assetId: asset.id,
        outcome: 'OK',
        occurredAt: now(),
      })
      return { purged: true }
    },

    /**
     * Cleanup sweep for abandoned staged uploads older than the grace period.
     * Best-effort per asset: individual failures do not abort the sweep and
     * are surfaced in the returned counters.
     */
    async purgeAbandonedStagedAssets(input: {
      actor?: DocumentLogoActor | null
    }): Promise<Readonly<{ purged: number; failed: number }>> {
      const actor = await requireAdmin(input.actor, dependencies.authenticate)
      const cutoff = new Date(now().getTime() - stagedGraceMs)
      const stale = await dependencies.repository.listStagedOlderThan(cutoff)
      let purged = 0
      let failed = 0
      for (const asset of stale) {
        try {
          await dependencies.storage.delete(asset.objectKey)
          await dependencies.repository.markPurged(asset.id, actor.id, now())
          await record({
            action: 'document_logo.purged',
            actorId: actor.id,
            assetId: asset.id,
            outcome: 'OK',
            occurredAt: now(),
          })
          purged += 1
        } catch {
          failed += 1
        }
      }
      return { purged, failed }
    },
  })
}

export function createInMemoryDocumentLogoRepository(): DocumentLogoRepository & {
  seed(asset: DocumentLogoRecord): void
  snapshot(): readonly DocumentLogoRecord[]
} {
  const assets: DocumentLogoRecord[] = []
  return {
    async findById(id) {
      return assets.find((asset) => asset.id === id) ?? null
    },
    async findStagedByChecksum(actorId, checksumSha256) {
      const hex = Buffer.from(checksumSha256, 'base64').toString('hex')
      return (
        assets.find(
          (asset) =>
            asset.status === 'staged' &&
            asset.createdByUserId === actorId &&
            asset.checksumSha256 === hex,
        ) ?? null
      )
    },
    async insert(asset) {
      const index = assets.findIndex((candidate) => candidate.id === asset.id)
      if (index >= 0) {
        assets[index] = Object.freeze({ ...asset })
        return
      }
      assets.push(Object.freeze({ ...asset }))
    },
    async markPurged(assetId, actorId, occurredAt) {
      const index = assets.findIndex((asset) => asset.id === assetId)
      if (index < 0) throw new DocumentLogoApiError('NOT_FOUND')
      assets[index] = Object.freeze({
        ...assets[index]!,
        status: 'purged',
        purgedAt: occurredAt,
        purgedByUserId: actorId,
      } as DocumentLogoRecord)
    },
    async listStagedOlderThan(cutoff) {
      return assets.filter(
        (asset) => asset.status === 'staged' && asset.createdAt < cutoff,
      )
    },
    seed(asset) {
      assets.push(Object.freeze({ ...asset }))
    },
    snapshot() {
      return Object.freeze([...assets])
    },
  }
}

export function createInMemoryDocumentLogoStorage(): DocumentLogoStorage & {
  seed(key: string, bytes: Uint8Array): void
  keys(): readonly string[]
} {
  const objects = new Map<string, Uint8Array>()
  return {
    async signUpload(input) {
      return {
        url: `https://signed-upload.test/${encodeURIComponent(input.key)}?expires=${input.expiresInSeconds}`,
        expiresAt: addSeconds(input.now, input.expiresInSeconds),
      }
    },
    async signDownload(input) {
      if (!objects.has(input.key)) throw new Error('missing object')
      return {
        url: `https://signed-download.test/${encodeURIComponent(input.key)}?expires=${input.expiresInSeconds}`,
        expiresAt: addSeconds(input.now, input.expiresInSeconds),
      }
    },
    async read(key) {
      const bytes = objects.get(key)
      return bytes ? new Uint8Array(bytes) : null
    },
    async putPrivate(input) {
      objects.set(input.key, new Uint8Array(input.bytes))
    },
    async delete(key) {
      objects.delete(key)
    },
    seed(key, bytes) {
      objects.set(key, new Uint8Array(bytes))
    },
    keys() {
      return Object.freeze([...objects.keys()])
    },
  }
}

export function createInMemoryDocumentLogoAuditSink(): DocumentLogoAuditSink & {
  snapshot(): readonly DocumentLogoAuditEvent[]
} {
  const events: DocumentLogoAuditEvent[] = []
  return {
    async append(event) {
      events.push(structuredClone(event))
    },
    snapshot() {
      return Object.freeze(structuredClone(events))
    },
  }
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000)
}

