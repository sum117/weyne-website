import { createHash, randomUUID } from 'node:crypto'

export const QUOTE_PDF_MIME_TYPE = 'application/pdf' as const

export interface QuotePdfLimits {
  readonly maxPages: number
  readonly maxImages: number
  readonly maxImageWidth: number
  readonly maxImageHeight: number
  readonly maxImageBytes: number
  readonly maxTotalImageBytes: number
  readonly maxInputBytes: number
  readonly maxRenderTimeMs: number
  readonly maxWorkingBytes: number
  readonly maxOutputBytes: number
}

export const DEFAULT_QUOTE_PDF_LIMITS: QuotePdfLimits = Object.freeze({
  maxPages: 40,
  maxImages: 40,
  maxImageWidth: 4_096,
  maxImageHeight: 4_096,
  maxImageBytes: 8 * 1024 * 1024,
  maxTotalImageBytes: 40 * 1024 * 1024,
  maxInputBytes: 2 * 1024 * 1024,
  maxRenderTimeMs: 30_000,
  maxWorkingBytes: 256 * 1024 * 1024,
  maxOutputBytes: 25 * 1024 * 1024,
})
export type QuotePdfTemplateVariant = 'summary' | 'commercial'
export type QuotePdfArtifactStatus = 'generating' | 'completed' | 'failed'

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export interface QuotePdfSnapshotImage {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly sizeBytes: number
  readonly checksum?: string
  readonly objectKey?: string
}

export interface ImmutableQuotePdfSnapshot {
  readonly id: string
  readonly version: number
  readonly sourceChecksum: string
  readonly payload: JsonValue
  readonly images: readonly QuotePdfSnapshotImage[]
}

export interface QuotePdfTemplateIdentity {
  readonly id: string
  readonly version: number
  readonly variant: QuotePdfTemplateVariant
}

export interface GenerateQuotePdfRequest {
  readonly quoteId: string
  readonly snapshot: ImmutableQuotePdfSnapshot
  readonly template: QuotePdfTemplateIdentity
}

export interface QuotePdfArtifact {
  readonly id: string
  readonly quoteId: string
  readonly snapshotId: string
  readonly snapshotVersion: number
  readonly templateId: string
  readonly templateVersion: number
  readonly templateVariant: QuotePdfTemplateVariant
  readonly sourceChecksum: string
  readonly status: QuotePdfArtifactStatus
  readonly objectKey: string | null
  readonly mimeType: typeof QUOTE_PDF_MIME_TYPE | null
  readonly sizeBytes: number | null
  readonly outputChecksum: string | null
  readonly pageCount: number | null
  readonly attemptCount: number
  readonly createdAt: Date
  readonly generationStartedAt: Date
  readonly completedAt: Date | null
  readonly failedAt: Date | null
  readonly errorCode: QuotePdfGenerationErrorCode | null
  readonly errorMessage: string | null
  readonly errorDetails: Readonly<Record<string, number | string>> | null
}

export type QuotePdfGenerationErrorCode =
  | 'input_bytes_exceeded'
  | 'input_structure_exceeded'
  | 'snapshot_not_found'
  | 'snapshot_checksum_invalid'
  | 'image_count_exceeded'
  | 'image_metadata_invalid'
  | 'image_dimensions_exceeded'
  | 'image_bytes_exceeded'
  | 'total_image_bytes_exceeded'
  | 'working_memory_exceeded'
  | 'render_timeout'
  | 'render_failed'
  | 'page_count_exceeded'
  | 'output_bytes_exceeded'
  | 'invalid_pdf'
  | 'immutable_storage_conflict'
  | 'storage_failed'
  | 'persistence_failed'
  | 'stale_generation_claim'
  | 'generation_wait_timeout'

export class QuotePdfGenerationError extends Error {
  readonly code: QuotePdfGenerationErrorCode
  readonly details: Readonly<Record<string, number | string>>

  constructor(
    code: QuotePdfGenerationErrorCode,
    message: string,
    details: Readonly<Record<string, number | string>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'QuotePdfGenerationError'
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

export interface QuotePdfRenderRequest {
  readonly quoteId: string
  readonly snapshot: ImmutableQuotePdfSnapshot
  readonly template: QuotePdfTemplateIdentity
  readonly limits: QuotePdfLimits
  readonly signal: AbortSignal
}

export interface QuotePdfRenderResult {
  readonly bytes: Uint8Array
  readonly pageCount: number
}

export interface QuotePdfRenderer {
  render(input: QuotePdfRenderRequest): Promise<QuotePdfRenderResult>
}

export interface QuotePdfArtifactStoragePutInput {
  readonly key: string
  readonly bytes: Uint8Array
  readonly checksum: string
  readonly contentType: typeof QUOTE_PDF_MIME_TYPE
  readonly metadata: Readonly<Record<string, string>>
}

export type QuotePdfArtifactStoragePutResult = Readonly<{
  kind: 'created' | 'existing' | 'conflict'
  checksum: string
  sizeBytes: number
}>

export interface QuotePdfArtifactStorage {
  putImmutable(
    input: QuotePdfArtifactStoragePutInput,
  ): Promise<QuotePdfArtifactStoragePutResult>
}

type ArtifactIdentity = Readonly<{
  quoteId: string
  snapshotId: string
  snapshotVersion: number
  snapshotSourceChecksum: string
  templateId: string
  templateVersion: number
  templateVariant: QuotePdfTemplateVariant
  sourceChecksum: string
}>

export interface QuotePdfArtifactRepository {
  claim(
    identity: ArtifactIdentity,
    now: Date,
    staleBefore: Date,
  ): Promise<Readonly<{ claimed: boolean; artifact: QuotePdfArtifact }>>
  complete(
    artifactId: string,
    expectedAttemptCount: number,
    completion: Readonly<{
      objectKey: string
      sizeBytes: number
      outputChecksum: string
      pageCount: number
      completedAt: Date
    }>,
  ): Promise<QuotePdfArtifact>
  fail(
    artifactId: string,
    expectedAttemptCount: number,
    failure: Readonly<{
      code: QuotePdfGenerationErrorCode
      message: string
      details: Readonly<Record<string, number | string>>
      failedAt: Date
    }>,
  ): Promise<QuotePdfArtifact>
  waitForTerminal(artifactId: string, timeoutMs: number): Promise<QuotePdfArtifact>
}

export interface QuotePdfArtifactServiceDependencies {
  readonly loadSnapshot: (input: Readonly<{
    quoteId: string
    snapshotId: string
    snapshotVersion: number
  }>) => Promise<ImmutableQuotePdfSnapshot | null>
  readonly repository: QuotePdfArtifactRepository
  readonly renderer: QuotePdfRenderer
  readonly storage: QuotePdfArtifactStorage
  readonly limits?: Partial<QuotePdfLimits>
  readonly now?: () => Date
}

export function createQuotePdfSourceChecksum(
  request: GenerateQuotePdfRequest,
): string {
  return sha256Hex(
    stableStringify({
      quoteId: request.quoteId,
      snapshot: request.snapshot,
      template: request.template,
    }),
  )
}

export function createQuotePdfSnapshotChecksum(
  snapshot: Pick<ImmutableQuotePdfSnapshot, 'id' | 'version' | 'payload' | 'images'>,
): string {
  return sha256Hex(
    stableStringify({
      id: snapshot.id,
      version: snapshot.version,
      payload: snapshot.payload,
      images: snapshot.images,
    }),
  )
}

export function createQuotePdfArtifactService(
  dependencies: QuotePdfArtifactServiceDependencies,
) {
  const limits = Object.freeze({
    ...DEFAULT_QUOTE_PDF_LIMITS,
    ...dependencies.limits,
  })
  const now = dependencies.now ?? (() => new Date())

  return Object.freeze({
    async generate(request: GenerateQuotePdfRequest): Promise<QuotePdfArtifact> {
      let persistedSnapshot: ImmutableQuotePdfSnapshot | null
      try {
        persistedSnapshot = await dependencies.loadSnapshot({
          quoteId: request.quoteId,
          snapshotId: request.snapshot.id,
          snapshotVersion: request.snapshot.version,
        })
      } catch (error) {
        throw persistenceError('Immutable quote snapshot could not be loaded', error)
      }
      if (!persistedSnapshot) {
        throw new QuotePdfGenerationError(
          'snapshot_not_found',
          'The immutable quote snapshot does not exist for this quote and version',
        )
      }
      if (!/^[0-9a-f]{64}$/.test(persistedSnapshot.sourceChecksum)) {
        throw new QuotePdfGenerationError(
          'snapshot_checksum_invalid',
          'The persisted quote snapshot has an invalid source checksum',
        )
      }
      validateSnapshotPreflight(persistedSnapshot, limits)
      if (
        createQuotePdfSnapshotChecksum(persistedSnapshot) !==
        persistedSnapshot.sourceChecksum
      ) {
        throw new QuotePdfGenerationError(
          'snapshot_checksum_invalid',
          'The persisted quote snapshot content does not match its source checksum',
        )
      }
      const capturedRequest = deepFreeze(
        structuredClone({ ...request, snapshot: persistedSnapshot }),
      )
      const sourceChecksum = createQuotePdfSourceChecksum(capturedRequest)
      const identity: ArtifactIdentity = {
        quoteId: capturedRequest.quoteId,
        snapshotId: capturedRequest.snapshot.id,
        snapshotVersion: capturedRequest.snapshot.version,
        snapshotSourceChecksum: capturedRequest.snapshot.sourceChecksum,
        templateId: capturedRequest.template.id,
        templateVersion: capturedRequest.template.version,
        templateVariant: capturedRequest.template.variant,
        sourceChecksum,
      }
      let claim: Readonly<{ claimed: boolean; artifact: QuotePdfArtifact }>
      const claimNow = now()
      const staleBefore = new Date(
        claimNow.getTime() - limits.maxRenderTimeMs - 5_000,
      )
      try {
        claim = await dependencies.repository.claim(identity, claimNow, staleBefore)
      } catch (error) {
        throw persistenceError('PDF artifact claim could not be persisted', error)
      }

      if (!claim.claimed) {
        if (claim.artifact.status === 'completed') return claim.artifact
        try {
          return await dependencies.repository.waitForTerminal(
            claim.artifact.id,
            limits.maxRenderTimeMs + 1_000,
          )
        } catch (error) {
          if (error instanceof QuotePdfGenerationError) throw error
          throw persistenceError('PDF artifact status could not be loaded', error)
        }
      }

      try {
        validatePreRenderLimits(capturedRequest.snapshot, limits)
        const result = await renderWithTimeout(
          dependencies.renderer,
          {
            quoteId: capturedRequest.quoteId,
            snapshot: capturedRequest.snapshot,
            template: capturedRequest.template,
            limits,
          },
          limits.maxRenderTimeMs,
        )
        validateRenderedPdf(result, capturedRequest.snapshot, limits)

        const outputChecksum = sha256Hex(result.bytes)
        const objectKey = createArtifactObjectKey(claim.artifact.id, sourceChecksum)
        let stored: QuotePdfArtifactStoragePutResult
        try {
          stored = await dependencies.storage.putImmutable({
            key: objectKey,
            bytes: result.bytes,
            checksum: outputChecksum,
            contentType: QUOTE_PDF_MIME_TYPE,
            metadata: {
              artifactId: claim.artifact.id,
              sourceChecksum,
              outputChecksum,
              snapshotId: capturedRequest.snapshot.id,
              snapshotVersion: String(capturedRequest.snapshot.version),
              snapshotSourceChecksum: capturedRequest.snapshot.sourceChecksum,
              templateId: capturedRequest.template.id,
              templateVersion: String(capturedRequest.template.version),
            },
          })
        } catch (error) {
          throw new QuotePdfGenerationError(
            'storage_failed',
            'The generated PDF could not be persisted to private storage',
            {},
            { cause: error },
          )
        }
        if (
          stored.kind === 'conflict' ||
          stored.checksum !== outputChecksum ||
          stored.sizeBytes !== result.bytes.byteLength
        ) {
          throw new QuotePdfGenerationError(
            'immutable_storage_conflict',
            'Private storage already contains different bytes for this immutable artifact key',
            { expectedSizeBytes: result.bytes.byteLength, storedSizeBytes: stored.sizeBytes },
          )
        }

        try {
          return await dependencies.repository.complete(
            claim.artifact.id,
            claim.artifact.attemptCount,
            {
              objectKey,
              sizeBytes: result.bytes.byteLength,
              outputChecksum,
              pageCount: result.pageCount,
              completedAt: now(),
            },
          )
        } catch (error) {
          if (error instanceof QuotePdfGenerationError) throw error
          throw new QuotePdfGenerationError(
            'persistence_failed',
            'Generated PDF metadata could not be committed',
            {},
            { cause: error },
          )
        }
      } catch (error) {
        const generationError = normalizeGenerationError(error)
        await dependencies.repository
          .fail(claim.artifact.id, claim.artifact.attemptCount, {
            code: generationError.code,
            message: generationError.message,
            details: generationError.details,
            failedAt: now(),
          })
          .catch(() => undefined)
        throw generationError
      }
    },
  })
}

export function createInMemoryQuotePdfArtifactRepository(
  options: Readonly<{ createId?: () => string }> = {},
): QuotePdfArtifactRepository {
  const byIdentity = new Map<string, QuotePdfArtifact>()
  const identityById = new Map<string, string>()
  const waiters = new Map<string, Set<(artifact: QuotePdfArtifact) => void>>()
  const createId = options.createId ?? randomUUID

  const publish = (artifact: QuotePdfArtifact) => {
    const identityKey = identityById.get(artifact.id)
    if (!identityKey) throw new Error(`Unknown quote PDF artifact: ${artifact.id}`)
    byIdentity.set(identityKey, artifact)
    if (artifact.status !== 'generating') {
      for (const resolve of waiters.get(artifact.id) ?? []) resolve(artifact)
      waiters.delete(artifact.id)
    }
    return artifact
  }

  return {
    async claim(identity, now, staleBefore) {
      const identityKey = stableStringify(identity)
      const existing = byIdentity.get(identityKey)
      if (existing?.status === 'completed') {
        return { claimed: false, artifact: existing }
      }
      if (
        existing?.status === 'failed' ||
        (existing?.status === 'generating' &&
          existing.generationStartedAt <= staleBefore)
      ) {
        return {
          claimed: true,
          artifact: publish({
            ...existing,
            status: 'generating',
            attemptCount: existing.attemptCount + 1,
            generationStartedAt: now,
            failedAt: null,
            errorCode: null,
            errorMessage: null,
            errorDetails: null,
          }),
        }
      }
      if (existing?.status === 'generating') {
        return { claimed: false, artifact: existing }
      }

      const artifact: QuotePdfArtifact = Object.freeze({
        id: createId(),
        ...identity,
        status: 'generating',
        objectKey: null,
        mimeType: null,
        sizeBytes: null,
        outputChecksum: null,
        pageCount: null,
        attemptCount: 1,
        createdAt: now,
        generationStartedAt: now,
        completedAt: null,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        errorDetails: null,
      })
      byIdentity.set(identityKey, artifact)
      identityById.set(artifact.id, identityKey)
      return { claimed: true, artifact }
    },

    async complete(artifactId, expectedAttemptCount, completion) {
      const artifact = findById(artifactId, identityById, byIdentity)
      assertActiveClaim(artifact, expectedAttemptCount)
      return publish(
        Object.freeze({
          ...artifact,
          ...completion,
          status: 'completed',
          mimeType: QUOTE_PDF_MIME_TYPE,
          failedAt: null,
          errorCode: null,
          errorMessage: null,
          errorDetails: null,
        }),
      )
    },

    async fail(artifactId, expectedAttemptCount, failure) {
      const artifact = findById(artifactId, identityById, byIdentity)
      assertActiveClaim(artifact, expectedAttemptCount)
      return publish(
        Object.freeze({
          ...artifact,
          status: 'failed',
          failedAt: failure.failedAt,
          errorCode: failure.code,
          errorMessage: failure.message,
          errorDetails: Object.freeze({ ...failure.details }),
        }),
      )
    },

    async waitForTerminal(artifactId, timeoutMs) {
      const artifact = findById(artifactId, identityById, byIdentity)
      if (artifact.status !== 'generating') return artifact

      return new Promise<QuotePdfArtifact>((resolve, reject) => {
        const listeners = waiters.get(artifactId) ?? new Set()
        const listener = (terminal: QuotePdfArtifact) => {
          clearTimeout(timer)
          resolve(terminal)
        }
        listeners.add(listener)
        waiters.set(artifactId, listeners)
        const timer = setTimeout(() => {
          listeners.delete(listener)
          reject(
            new QuotePdfGenerationError(
              'generation_wait_timeout',
              'Timed out waiting for the concurrent PDF generation claim to finish',
              { limit: timeoutMs },
            ),
          )
        }, timeoutMs)
      })
    },
  }
}

function findById(
  artifactId: string,
  identityById: ReadonlyMap<string, string>,
  byIdentity: ReadonlyMap<string, QuotePdfArtifact>,
): QuotePdfArtifact {
  const identityKey = identityById.get(artifactId)
  const artifact = identityKey ? byIdentity.get(identityKey) : undefined
  if (!artifact) throw new Error(`Unknown quote PDF artifact: ${artifactId}`)
  return artifact
}

function assertActiveClaim(
  artifact: QuotePdfArtifact,
  expectedAttemptCount: number,
) {
  if (
    artifact.status !== 'generating' ||
    artifact.attemptCount !== expectedAttemptCount
  ) {
    throw new QuotePdfGenerationError(
      'stale_generation_claim',
      'This PDF generation attempt no longer owns the artifact claim',
      { actual: artifact.attemptCount, expected: expectedAttemptCount },
    )
  }
}

function validateSnapshotPreflight(
  snapshot: ImmutableQuotePdfSnapshot,
  limits: QuotePdfLimits,
) {
  validateSnapshotStructure(snapshot.payload)
  assertLimit(
    snapshot.images.length <= limits.maxImages,
    'image_count_exceeded',
    'Captured quote snapshot contains too many images',
    snapshot.images.length,
    limits.maxImages,
  )

  let estimatedInputBytes =
    Buffer.byteLength(snapshot.id, 'utf8') +
    Buffer.byteLength(snapshot.sourceChecksum, 'utf8') +
    estimateJsonUtf8Bytes(snapshot.payload)
  let totalImageBytes = 0
  for (const image of snapshot.images) {
    if (
      !Number.isInteger(image.width) ||
      image.width <= 0 ||
      !Number.isInteger(image.height) ||
      image.height <= 0 ||
      !Number.isSafeInteger(image.sizeBytes) ||
      image.sizeBytes < 0
    ) {
      throw new QuotePdfGenerationError(
        'image_metadata_invalid',
        `Image ${image.id} has invalid dimensions or byte metadata`,
      )
    }
    assertLimit(
      image.width <= limits.maxImageWidth && image.height <= limits.maxImageHeight,
      'image_dimensions_exceeded',
      `Image ${image.id} exceeds the permitted pixel dimensions`,
      Math.max(image.width, image.height),
      Math.max(limits.maxImageWidth, limits.maxImageHeight),
    )
    assertLimit(
      image.sizeBytes <= limits.maxImageBytes,
      'image_bytes_exceeded',
      `Image ${image.id} exceeds the per-image byte limit`,
      image.sizeBytes,
      limits.maxImageBytes,
    )
    totalImageBytes += image.sizeBytes
    estimatedInputBytes +=
      Buffer.byteLength(image.id, 'utf8') +
      Buffer.byteLength(image.checksum ?? '', 'utf8') +
      Buffer.byteLength(image.objectKey ?? '', 'utf8') +
      64
  }
  assertLimit(
    estimatedInputBytes <= limits.maxInputBytes,
    'input_bytes_exceeded',
    'Captured quote snapshot exceeds the PDF input-size limit',
    estimatedInputBytes,
    limits.maxInputBytes,
  )
  assertLimit(
    totalImageBytes <= limits.maxTotalImageBytes,
    'total_image_bytes_exceeded',
    'Captured quote snapshot images exceed the aggregate byte limit',
    totalImageBytes,
    limits.maxTotalImageBytes,
  )
  assertLimit(
    estimatedInputBytes + totalImageBytes <= limits.maxWorkingBytes,
    'working_memory_exceeded',
    'Estimated PDF working set exceeds the generation memory budget',
    estimatedInputBytes + totalImageBytes,
    limits.maxWorkingBytes,
  )
}

function validatePreRenderLimits(
  snapshot: ImmutableQuotePdfSnapshot,
  limits: QuotePdfLimits,
) {
  const inputBytes = Buffer.byteLength(stableStringify(snapshot), 'utf8')
  assertLimit(
    inputBytes <= limits.maxInputBytes,
    'input_bytes_exceeded',
    'Captured quote snapshot exceeds the PDF input-size limit',
    inputBytes,
    limits.maxInputBytes,
  )
  assertLimit(
    snapshot.images.length <= limits.maxImages,
    'image_count_exceeded',
    'Captured quote snapshot contains too many images',
    snapshot.images.length,
    limits.maxImages,
  )

  let totalImageBytes = 0
  for (const image of snapshot.images) {
    if (
      !Number.isInteger(image.width) ||
      image.width <= 0 ||
      !Number.isInteger(image.height) ||
      image.height <= 0 ||
      !Number.isSafeInteger(image.sizeBytes) ||
      image.sizeBytes < 0
    ) {
      throw new QuotePdfGenerationError(
        'image_metadata_invalid',
        `Image ${image.id} has invalid dimensions or byte metadata`,
      )
    }
    assertLimit(
      image.width <= limits.maxImageWidth && image.height <= limits.maxImageHeight,
      'image_dimensions_exceeded',
      `Image ${image.id} exceeds the permitted pixel dimensions`,
      Math.max(image.width, image.height),
      Math.max(limits.maxImageWidth, limits.maxImageHeight),
    )
    assertLimit(
      image.sizeBytes <= limits.maxImageBytes,
      'image_bytes_exceeded',
      `Image ${image.id} exceeds the per-image byte limit`,
      image.sizeBytes,
      limits.maxImageBytes,
    )
    totalImageBytes += image.sizeBytes
  }
  assertLimit(
    totalImageBytes <= limits.maxTotalImageBytes,
    'total_image_bytes_exceeded',
    'Captured quote snapshot images exceed the aggregate byte limit',
    totalImageBytes,
    limits.maxTotalImageBytes,
  )
  assertLimit(
    inputBytes + totalImageBytes <= limits.maxWorkingBytes,
    'working_memory_exceeded',
    'Estimated PDF working set exceeds the generation memory budget',
    inputBytes + totalImageBytes,
    limits.maxWorkingBytes,
  )
}

function validateRenderedPdf(
  result: QuotePdfRenderResult,
  snapshot: ImmutableQuotePdfSnapshot,
  limits: QuotePdfLimits,
) {
  assertLimit(
    Number.isInteger(result.pageCount) && result.pageCount > 0 && result.pageCount <= limits.maxPages,
    'page_count_exceeded',
    'Rendered PDF exceeds the page-count limit',
    result.pageCount,
    limits.maxPages,
  )
  assertLimit(
    result.bytes.byteLength <= limits.maxOutputBytes,
    'output_bytes_exceeded',
    'Rendered PDF exceeds the output-size limit',
    result.bytes.byteLength,
    limits.maxOutputBytes,
  )
  const inputBytes = Buffer.byteLength(stableStringify(snapshot), 'utf8')
  const imageBytes = snapshot.images.reduce((sum, image) => sum + image.sizeBytes, 0)
  assertLimit(
    inputBytes + imageBytes + result.bytes.byteLength <= limits.maxWorkingBytes,
    'working_memory_exceeded',
    'Estimated PDF working set exceeds the generation memory budget',
    inputBytes + imageBytes + result.bytes.byteLength,
    limits.maxWorkingBytes,
  )

  const prefix = Buffer.from(result.bytes.subarray(0, 5)).toString('ascii')
  const tail = Buffer.from(result.bytes.subarray(Math.max(0, result.bytes.byteLength - 1_024))).toString('ascii')
  if (prefix !== '%PDF-' || !tail.includes('%%EOF')) {
    throw new QuotePdfGenerationError(
      'invalid_pdf',
      'Renderer output is not a structurally valid PDF document',
    )
  }
}

async function renderWithTimeout(
  renderer: QuotePdfRenderer,
  request: Omit<QuotePdfRenderRequest, 'signal'>,
  timeoutMs: number,
): Promise<QuotePdfRenderResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  try {
    return await Promise.race([
      renderer.render({ ...request, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            controller.abort(new Error('PDF render deadline exceeded'))
            reject(
              new QuotePdfGenerationError(
                'render_timeout',
                'PDF rendering exceeded the configured time limit',
                { limit: timeoutMs },
              ),
            )
          },
          timeoutMs,
        )
      }),
    ])
  } catch (error) {
    if (error instanceof QuotePdfGenerationError) throw error
    throw new QuotePdfGenerationError(
      'render_failed',
      'PDF renderer failed for the captured quote snapshot',
      {},
      { cause: error },
    )
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function assertLimit(
  condition: boolean,
  code: QuotePdfGenerationErrorCode,
  message: string,
  actual: number,
  limit: number,
): asserts condition {
  if (!condition) {
    throw new QuotePdfGenerationError(code, message, { actual, limit })
  }
}

function normalizeGenerationError(error: unknown): QuotePdfGenerationError {
  if (error instanceof QuotePdfGenerationError) return error
  return new QuotePdfGenerationError(
    'render_failed',
    'Unexpected failure while generating the quote PDF',
    {},
    { cause: error },
  )
}

function persistenceError(message: string, cause: unknown) {
  if (cause instanceof QuotePdfGenerationError) return cause
  return new QuotePdfGenerationError(
    'persistence_failed',
    message,
    {},
    { cause },
  )
}

function createArtifactObjectKey(artifactId: string, sourceChecksum: string) {
  return `quote-pdfs/${artifactId}/${sourceChecksum}.pdf`
}

function sha256Hex(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function validateSnapshotStructure(value: JsonValue) {
  const stack: Array<Readonly<{ value: JsonValue; depth: number }>> = [
    { value, depth: 0 },
  ]
  let nodes = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    nodes += 1
    if (current.depth > 100 || nodes > 100_000) {
      throw new QuotePdfGenerationError(
        'input_structure_exceeded',
        'Captured quote snapshot is too deeply nested or structurally complex',
        {
          actual: current.depth > 100 ? current.depth : nodes,
          limit: current.depth > 100 ? 100 : 100_000,
        },
      )
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) {
        stack.push({ value: child, depth: current.depth + 1 })
      }
    } else if (current.value && typeof current.value === 'object') {
      for (const child of Object.values(current.value)) {
        stack.push({ value: child, depth: current.depth + 1 })
      }
    }
  }
}

function estimateJsonUtf8Bytes(value: JsonValue) {
  const stack: JsonValue[] = [value]
  let bytes = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    bytes += 8
    if (typeof current === 'string') {
      bytes += Buffer.byteLength(current, 'utf8')
    } else if (Array.isArray(current)) {
      for (const child of current) stack.push(child)
    } else if (current && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        bytes += Buffer.byteLength(key, 'utf8')
        stack.push(child)
      }
    }
  }
  return bytes
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('PDF snapshot JSON numbers must be finite')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`
  }
  throw new TypeError(`Unsupported PDF snapshot value: ${typeof value}`)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
