import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUOTE_PDF_LIMITS,
  QuotePdfGenerationError,
  createInMemoryQuotePdfArtifactRepository,
  createQuotePdfArtifactService,
  createQuotePdfSnapshotChecksum,
  createQuotePdfSourceChecksum,
  type QuotePdfArtifactStorage,
  type QuotePdfRenderRequest,
  type QuotePdfRenderResult,
} from '@/lib/quotes/pdf-artifacts.server'

const PDF = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF', 'ascii')

const snapshotContent = {
  id: '20000000-0000-4000-8000-000000000001',
  version: 3,
  payload: {
    quoteNumber: 'ORC-2026-000123',
    customer: { name: 'Cliente Histórico' },
    totals: { grandTotal: '1250.50' },
  },
  images: [],
} as const

const request = {
  quoteId: '10000000-0000-4000-8000-000000000001',
  snapshot: {
    ...snapshotContent,
    sourceChecksum: createQuotePdfSnapshotChecksum(snapshotContent),
  },
  template: {
    id: '30000000-0000-4000-8000-000000000001',
    version: 2,
    variant: 'commercial' as const,
  },
}

function createMemoryStorage(): QuotePdfArtifactStorage & {
  objects: Map<string, { bytes: Uint8Array; checksum: string }>
  writes: number
} {
  const objects = new Map<string, { bytes: Uint8Array; checksum: string }>()
  return {
    objects,
    writes: 0,
    async putImmutable(input) {
      this.writes += 1
      const existing = objects.get(input.key)
      if (existing) {
        return existing.checksum === input.checksum
          ? { kind: 'existing', checksum: existing.checksum, sizeBytes: existing.bytes.byteLength }
          : { kind: 'conflict', checksum: existing.checksum, sizeBytes: existing.bytes.byteLength }
      }
      objects.set(input.key, { bytes: input.bytes.slice(), checksum: input.checksum })
      return { kind: 'created', checksum: input.checksum, sizeBytes: input.bytes.byteLength }
    },
  }
}

function createRenderer(
  render: (input: QuotePdfRenderRequest) => Promise<QuotePdfRenderResult> = async () => ({
    bytes: PDF,
    pageCount: 1,
  }),
) {
  return { render }
}

describe('quote PDF artifact source identity', () => {
  it('canonicalizes captured snapshot data and includes template identity', () => {
    const reordered = {
      ...request,
      snapshot: {
        ...request.snapshot,
        payload: {
          totals: { grandTotal: '1250.50' },
          customer: { name: 'Cliente Histórico' },
          quoteNumber: 'ORC-2026-000123',
        },
      },
    }

    expect(createQuotePdfSourceChecksum(request)).toBe(
      createQuotePdfSourceChecksum(reordered),
    )
    expect(
      createQuotePdfSourceChecksum({
        ...request,
        template: { ...request.template, version: 3 },
      }),
    ).not.toBe(createQuotePdfSourceChecksum(request))
  })
})

describe('immutable quote PDF artifact generation', () => {
  it('renders from the captured snapshot and reuses the completed artifact', async () => {
    const repository = createInMemoryQuotePdfArtifactRepository()
    const storage = createMemoryStorage()
    const seen: QuotePdfRenderRequest[] = []
    const service = createQuotePdfArtifactService({
      loadSnapshot: async () => request.snapshot,
      repository,
      storage,
      renderer: createRenderer(async (input) => {
        seen.push(input)
        return { bytes: PDF, pageCount: 1 }
      }),
    })

    const first = await service.generate(request)
    const second = await service.generate(request)

    expect(first.status).toBe('completed')
    expect(second).toEqual(first)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.snapshot.payload).toEqual(request.snapshot.payload)
    expect(storage.writes).toBe(1)
    expect(first.mimeType).toBe('application/pdf')
    expect(first.sourceChecksum).toMatch(/^[a-f0-9]{64}$/)
    expect(first.outputChecksum).toMatch(/^[a-f0-9]{64}$/)
  })

  it('collapses simultaneous requests to one render and one immutable object', async () => {
    const repository = createInMemoryQuotePdfArtifactRepository()
    const storage = createMemoryStorage()
    let renders = 0
    const service = createQuotePdfArtifactService({
      loadSnapshot: async () => request.snapshot,
      repository,
      storage,
      renderer: createRenderer(async () => {
        renders += 1
        await new Promise((resolve) => setTimeout(resolve, 15))
        return { bytes: PDF, pageCount: 1 }
      }),
    })

    const artifacts = await Promise.all(
      Array.from({ length: 12 }, () => service.generate(request)),
    )

    expect(new Set(artifacts.map((artifact) => artifact.id))).toHaveLength(1)
    expect(artifacts.every((artifact) => artifact.status === 'completed')).toBe(true)
    expect(renders).toBe(1)
    expect(storage.writes).toBe(1)
  })

  it('retries a failed claim without duplicating a successful artifact', async () => {
    const repository = createInMemoryQuotePdfArtifactRepository()
    const storage = createMemoryStorage()
    let renders = 0
    const service = createQuotePdfArtifactService({
      loadSnapshot: async () => request.snapshot,
      repository,
      storage,
      renderer: createRenderer(async () => {
        renders += 1
        if (renders === 1) throw new Error('renderer unavailable')
        return { bytes: PDF, pageCount: 1 }
      }),
    })

    await expect(service.generate(request)).rejects.toMatchObject({
      code: 'render_failed',
    })
    const recovered = await service.generate(request)
    const repeated = await service.generate(request)

    expect(recovered.status).toBe('completed')
    expect(recovered.attemptCount).toBe(2)
    expect(repeated.id).toBe(recovered.id)
    expect(renders).toBe(2)
    expect(storage.writes).toBe(1)
  })

  it('rejects invalid PDF bytes before private persistence', async () => {
    const storage = createMemoryStorage()
    const service = createQuotePdfArtifactService({
      loadSnapshot: async () => request.snapshot,
      repository: createInMemoryQuotePdfArtifactRepository(),
      storage,
      renderer: createRenderer(async () => ({
        bytes: Buffer.from('<html>not a pdf</html>'),
        pageCount: 1,
      })),
    })

    await expect(service.generate(request)).rejects.toMatchObject({
      code: 'invalid_pdf',
    })
    expect(storage.writes).toBe(0)
  })

  it('renders the persisted snapshot instead of caller-supplied mutable payload', async () => {
    const persistedContent = {
      ...request.snapshot,
      payload: { quoteNumber: 'ORC-PERSISTED' },
    }
    const persisted = {
      ...persistedContent,
      sourceChecksum: createQuotePdfSnapshotChecksum(persistedContent),
    }
    let renderedQuoteNumber: unknown
    const service = createQuotePdfArtifactService({
      loadSnapshot: async () => persisted,
      repository: createInMemoryQuotePdfArtifactRepository(),
      storage: createMemoryStorage(),
      renderer: createRenderer(async ({ snapshot }) => {
        renderedQuoteNumber = (snapshot.payload as { quoteNumber: string }).quoteNumber
        return { bytes: PDF, pageCount: 1 }
      }),
    })

    await service.generate(request)

    expect(renderedQuoteNumber).toBe('ORC-PERSISTED')
  })
})

describe('quote PDF resource limits', () => {
  it.each([
    ['image_count_exceeded', { images: Array.from({ length: DEFAULT_QUOTE_PDF_LIMITS.maxImages + 1 }, (_, index) => ({ id: `image-${index}`, width: 10, height: 10, sizeBytes: 10 })) }],
    ['image_dimensions_exceeded', { images: [{ id: 'large', width: DEFAULT_QUOTE_PDF_LIMITS.maxImageWidth + 1, height: 10, sizeBytes: 10 }] }],
    ['image_bytes_exceeded', { images: [{ id: 'heavy', width: 10, height: 10, sizeBytes: DEFAULT_QUOTE_PDF_LIMITS.maxImageBytes + 1 }] }],
    ['image_metadata_invalid', { images: [{ id: 'negative', width: 10, height: 10, sizeBytes: -1 }] }],
  ] as const)('fails cleanly with %s before rendering', async (code, snapshotPatch) => {
    let rendered = false
    const limitedContent = { ...request.snapshot, ...snapshotPatch }
    const limitedSnapshot = {
      ...limitedContent,
      sourceChecksum: createQuotePdfSnapshotChecksum(limitedContent),
    }
    const service = createQuotePdfArtifactService({
      loadSnapshot: async () => limitedSnapshot,
      repository: createInMemoryQuotePdfArtifactRepository(),
      storage: createMemoryStorage(),
      renderer: createRenderer(async () => {
        rendered = true
        return { bytes: PDF, pageCount: 1 }
      }),
    })

    await expect(
      service.generate({
        ...request,
        snapshot: limitedSnapshot,
      }),
    ).rejects.toMatchObject({ code })
    expect(rendered).toBe(false)
  })

  it('enforces page, output, and render-time bounds with actionable errors', async () => {
    let timeoutSignalAborted = false
    const scenarios = [
      {
        expected: 'page_count_exceeded',
        renderer: createRenderer(async () => ({
          bytes: PDF,
          pageCount: DEFAULT_QUOTE_PDF_LIMITS.maxPages + 1,
        })),
        limits: {},
      },
      {
        expected: 'output_bytes_exceeded',
        renderer: createRenderer(async () => ({ bytes: PDF, pageCount: 1 })),
        limits: { maxOutputBytes: PDF.byteLength - 1 },
      },
      {
        expected: 'render_timeout',
        renderer: createRenderer(async ({ signal }) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              timeoutSignalAborted = true
              resolve()
            })
          })
          return { bytes: PDF, pageCount: 1 }
        }),
        limits: { maxRenderTimeMs: 5 },
      },
    ] as const

    for (const scenario of scenarios) {
      const service = createQuotePdfArtifactService({
        loadSnapshot: async () => request.snapshot,
        repository: createInMemoryQuotePdfArtifactRepository(),
        storage: createMemoryStorage(),
        renderer: scenario.renderer,
        limits: scenario.limits,
      })
      await expect(service.generate(request)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof QuotePdfGenerationError &&
          error.code === scenario.expected &&
          Boolean(error.details.limit),
      )
    }
    expect(timeoutSignalAborted).toBe(true)
  })
})
