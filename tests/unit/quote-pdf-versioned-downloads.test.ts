import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createInMemoryQuotePdfAuditSink,
  createInMemoryQuotePdfDeliveryRepository,
  createInMemoryQuotePdfObjectStore,
  createQuotePdfDeliveryService,
  type QuotePdfAccessScope,
  type QuotePdfDeliveryActor,
  type QuotePdfArtifact,
} from '@/lib/quotes/pdf-delivery.server'

/**
 * Versioned download acceptance: two immutable quote versions must coexist and
 * every download must answer with exactly the requested version — its bytes,
 * its checksum, its filename — never silently substituting the latest one.
 */

const quoteId = randomUUID()
const scope: QuotePdfAccessScope & { quoteNumber: string } = {
  tenantId: 'tenant-1',
  ownerUserId: 'owner-1',
  assignedUserIds: [],
  quoteNumber: 'ORC-2026-000123',
}
const admin: QuotePdfDeliveryActor = { id: 'admin-1', role: 'admin', tenantId: 'tenant-1' }

/** Distinct deterministic payload per version; v1 embeds the old freight. */
function versionBytes(version: number): Uint8Array {
  return new Uint8Array(
    Buffer.from(`%PDF-1.7 quote ORC-2026-000123 snapshot v${version} freight\n%%EOF`),
  )
}

function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface SeededVersion {
  readonly version: number
  readonly artifact: QuotePdfArtifact
}

function seedVersion(
  repository: ReturnType<typeof createInMemoryQuotePdfDeliveryRepository>,
  storage: ReturnType<typeof createInMemoryQuotePdfObjectStore>,
  input: Readonly<{
    version: number
    templateVersion?: number
    variant?: 'summary' | 'commercial'
  }>,
): SeededVersion {
  const bytes = versionBytes(input.version)
  const artifact: QuotePdfArtifact = {
    id: randomUUID(),
    quoteId,
    snapshotId: randomUUID(),
    snapshotVersion: input.version,
    templateId: randomUUID(),
    templateVersion: input.templateVersion ?? 1,
    templateVariant: input.variant ?? 'commercial',
    sourceChecksum: checksum(bytes),
    status: 'completed',
    objectKey: `quote-pdfs/${quoteId}/${checksum(bytes)}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: bytes.byteLength,
    outputChecksum: checksum(bytes),
    pageCount: 1 + (input.version % 3),
    attemptCount: 1,
    createdAt: new Date('2026-08-20T12:00:00Z'),
    generationStartedAt: new Date('2026-08-20T12:00:00Z'),
    completedAt: new Date('2026-08-20T12:00:05Z'),
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    errorDetails: null,
  }
  repository.seed(artifact)
  storage.put(artifact.objectKey ?? '', bytes)
  return { version: input.version, artifact }
}

function setup() {
  const repository = createInMemoryQuotePdfDeliveryRepository()
  const storage = createInMemoryQuotePdfObjectStore()
  const audit = createInMemoryQuotePdfAuditSink()
  const service = createQuotePdfDeliveryService({
    loadQuoteScope: async (id) => (id === quoteId ? scope : null),
    repository,
    storage,
    audit,
    generate: async () => {
      throw new Error('generation is not exercised by the versioned-download suite')
    },
    now: () => new Date('2026-08-21T12:00:00Z'),
  })
  return { audit, repository, service, storage }
}

describe('versioned quote PDF downloads', () => {
  it('returns each requested immutable version with matching bytes, filename, and content type', async () => {
    const { repository, service, storage } = setup()
    const oldest = seedVersion(repository, storage, { version: 1 })
    const latest = seedVersion(repository, storage, { version: 2 })

    for (const seeded of [oldest, latest]) {
      const result = await service.deliver({
        actor: admin,
        identity: {
          quoteId,
          snapshotId: seeded.artifact.snapshotId,
          snapshotVersion: seeded.version,
          templateId: seeded.artifact.templateId,
          templateVersion: seeded.artifact.templateVersion,
        },
        disposition: 'attachment',
      })

      expect(Buffer.from(result.bytes).toString()).toBe(
        Buffer.from(versionBytes(seeded.version)).toString(),
      )
      expect(checksum(result.bytes)).toBe(seeded.artifact.outputChecksum)
      expect(result.headers['Content-Type']).toBe('application/pdf')
      expect(result.headers['Content-Disposition']).toContain(
        `filename="ORC-2026-000123-v${seeded.version}-comercial.pdf"`,
      )
    }
  })

  it('never substitutes the latest version when an older one is requested', async () => {
    const { repository, service, storage } = setup()
    const oldest = seedVersion(repository, storage, { version: 1 })
    seedVersion(repository, storage, { version: 2 })

    const result = await service.deliver({
      actor: admin,
      identity: {
        quoteId,
        snapshotId: oldest.artifact.snapshotId,
        snapshotVersion: 1,
        templateId: oldest.artifact.templateId,
        templateVersion: oldest.artifact.templateVersion,
      },
      disposition: 'attachment',
    })

    // The v1 request must answer with v1 bytes, not the newer revision.
    expect(Buffer.from(result.bytes).toString()).toBe(
      Buffer.from(versionBytes(1)).toString(),
    )
    expect(result.headers['Content-Disposition']).toContain('-v1-comercial.pdf')
    expect(result.headers['Content-Disposition']).not.toContain('-v2-')
  })

  it('keeps both variants addressable at the same snapshot version', async () => {
    const { repository, service, storage } = setup()
    const summary = seedVersion(repository, storage, { version: 3, variant: 'summary' })
    const commercial = seedVersion(repository, storage, { version: 3, variant: 'commercial' })

    const summaryDownload = await service.deliver({
      actor: admin,
      identity: {
        quoteId,
        snapshotId: summary.artifact.snapshotId,
        snapshotVersion: 3,
        templateId: summary.artifact.templateId,
        templateVersion: summary.artifact.templateVersion,
      },
      disposition: 'attachment',
    })
    const commercialDownload = await service.deliver({
      actor: admin,
      identity: {
        quoteId,
        snapshotId: commercial.artifact.snapshotId,
        snapshotVersion: 3,
        templateId: commercial.artifact.templateId,
        templateVersion: commercial.artifact.templateVersion,
      },
      disposition: 'attachment',
    })

    expect(summaryDownload.headers['Content-Disposition']).toContain('-v3-resumida.pdf')
    expect(commercialDownload.headers['Content-Disposition']).toContain('-v3-comercial.pdf')
  })

  it('answers a version that was never generated with NOT_FOUND instead of a fallback', async () => {
    const { repository, service, storage } = setup()
    seedVersion(repository, storage, { version: 1 })
    seedVersion(repository, storage, { version: 2 })

    await expect(
      service.deliver({
        actor: admin,
        identity: {
          quoteId,
          snapshotId: randomUUID(),
          snapshotVersion: 9,
          templateId: randomUUID(),
          templateVersion: 1,
        },
        disposition: 'attachment',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('audits downloads with the exact served snapshot version', async () => {
    const { audit, repository, service, storage } = setup()
    const oldest = seedVersion(repository, storage, { version: 1 })
    seedVersion(repository, storage, { version: 2 })

    await service.deliver({
      actor: admin,
      identity: {
        quoteId,
        snapshotId: oldest.artifact.snapshotId,
        snapshotVersion: 1,
        templateId: oldest.artifact.templateId,
        templateVersion: oldest.artifact.templateVersion,
      },
      disposition: 'inline',
    })

    const events = audit.snapshot().filter((event) => event.action === 'quote.pdf.download')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ snapshotVersion: 1, outcome: 'inline' })
  })
})
