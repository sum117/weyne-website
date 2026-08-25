import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  QuotePdfGenerationError,
  type ImmutableQuotePdfSnapshot,
  type QuotePdfArtifact,
  type QuotePdfTemplateIdentity,
} from '@/lib/quotes/pdf-artifacts.server'
import {
  authorizeQuotePdfDownload,
  authorizeQuotePdfRegeneration,
  authorizeQuotePdfStatus,
  buildQuotePdfResponseHeaders,
  createInMemoryQuotePdfAuditSink,
  createInMemoryQuotePdfDeliveryRepository,
  createInMemoryQuotePdfObjectStore,
  createQuotePdfDeliveryService,
  createQuotePdfFilename,
  QuotePdfDeliveryError,
  type QuotePdfAccessScope,
  type QuotePdfDeliveryActor,
  type QuotePdfDeliveryIdentity,
} from '@/lib/quotes/pdf-delivery.server'

const quoteId = randomUUID()
const snapshotId = randomUUID()
const templateId = randomUUID()

const scope: QuotePdfAccessScope & { quoteNumber: string } = {
  tenantId: 'tenant-1',
  ownerUserId: 'owner-1',
  assignedUserIds: ['assigned-1'],
  quoteNumber: 'ORC-2026-000123',
}

const admin: QuotePdfDeliveryActor = { id: 'admin-1', role: 'admin', tenantId: 'tenant-1' }
const ownerRep: QuotePdfDeliveryActor = { id: 'owner-1', role: 'representative', tenantId: 'tenant-1' }
const assignedRep: QuotePdfDeliveryActor = { id: 'assigned-1', role: 'representative', tenantId: 'tenant-1' }
const readOnly: QuotePdfDeliveryActor = { id: 'assigned-1', role: 'read_only', tenantId: 'tenant-1' }
const crossTenantAdmin: QuotePdfDeliveryActor = { id: 'x', role: 'admin', tenantId: 'tenant-2' }
const outsider: QuotePdfDeliveryActor = { id: 'other', role: 'representative', tenantId: 'tenant-1' }

const identity: QuotePdfDeliveryIdentity = {
  quoteId,
  snapshotId,
  snapshotVersion: 3,
  templateId,
  templateVersion: 2,
}

const snapshot: ImmutableQuotePdfSnapshot = {
  id: snapshotId,
  version: 3,
  sourceChecksum: 'a'.repeat(64),
  payload: { quoteNumber: 'ORC-2026-000123' },
  images: [],
}

const template: QuotePdfTemplateIdentity = {
  id: templateId,
  version: 2,
  variant: 'commercial',
}

const pdfBytes = new Uint8Array(Buffer.from('%PDF-1.7 synthetic quote pdf\n%%EOF'))
const outputChecksum = createHash('sha256').update(pdfBytes).digest('hex')

function completedArtifact(overrides: Partial<QuotePdfArtifact> = {}): QuotePdfArtifact {
  return {
    id: randomUUID(),
    quoteId,
    snapshotId,
    snapshotVersion: 3,
    templateId,
    templateVersion: 2,
    templateVariant: 'commercial',
    sourceChecksum: 'a'.repeat(64),
    status: 'completed',
    objectKey: `quote-pdfs/${randomUUID()}/${outputChecksum}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: pdfBytes.byteLength,
    outputChecksum,
    pageCount: 1,
    attemptCount: 1,
    createdAt: new Date('2026-08-20T12:00:00Z'),
    generationStartedAt: new Date('2026-08-20T12:00:00Z'),
    completedAt: new Date('2026-08-20T12:00:05Z'),
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    errorDetails: null,
    ...overrides,
  }
}

function setup(options: {
  artifact?: QuotePdfArtifact | null
  generateError?: unknown
} = {}) {
  const repository = createInMemoryQuotePdfDeliveryRepository()
  if (options.artifact) repository.seed(options.artifact)
  const storage = createInMemoryQuotePdfObjectStore()
  if (options.artifact?.objectKey && options.artifact.status === 'completed') {
    storage.put(options.artifact.objectKey, pdfBytes)
  }
  const audit = createInMemoryQuotePdfAuditSink()
  const generateCalls: Array<Record<string, unknown>> = []
  const service = createQuotePdfDeliveryService({
    loadQuoteScope: async (id) => (id === quoteId ? scope : null),
    repository,
    storage,
    audit,
    generate: async (input) => {
      generateCalls.push({ ...input })
      if (options.generateError) throw options.generateError
      return completedArtifact({ status: 'generating', objectKey: null })
    },
    now: () => new Date('2026-08-21T12:00:00Z'),
  })
  return { audit, generateCalls, repository, service, storage }
}

describe('quote PDF permission matrix', () => {
  it('allows admins anywhere inside their tenant for every operation', () => {
    expect(authorizeQuotePdfStatus(admin, scope)).toBe('allow')
    expect(authorizeQuotePdfDownload(admin, scope)).toBe('allow')
    expect(authorizeQuotePdfRegeneration(admin, scope)).toBe('allow')
  })

  it('allows in-scope representatives to view, download, and regenerate', () => {
    expect(authorizeQuotePdfDownload(ownerRep, scope)).toBe('allow')
    expect(authorizeQuotePdfDownload(assignedRep, scope)).toBe('allow')
    expect(authorizeQuotePdfRegeneration(ownerRep, scope)).toBe('allow')
  })

  it('denies read-only actors downloads and regeneration but permits status polling', () => {
    expect(authorizeQuotePdfStatus(readOnly, scope)).toBe('allow')
    expect(authorizeQuotePdfDownload(readOnly, scope)).toBe('forbidden')
    expect(authorizeQuotePdfRegeneration(readOnly, scope)).toBe('forbidden')
  })

  it('hides out-of-scope and cross-tenant quotes as not_found without leaking existence', () => {
    expect(authorizeQuotePdfDownload(outsider, scope)).toBe('not_found')
    expect(authorizeQuotePdfDownload(crossTenantAdmin, scope)).toBe('not_found')
    expect(authorizeQuotePdfStatus(crossTenantAdmin, scope)).toBe('not_found')
    expect(authorizeQuotePdfRegeneration(crossTenantAdmin, scope)).toBe('not_found')
  })
})

describe('quote PDF delivery authorization enforcement', () => {
  it('serves inline preview bytes with correct headers for an authorized actor', async () => {
    const artifact = completedArtifact()
    const { service } = setup({ artifact })
    const result = await service.deliver({ actor: admin, identity, disposition: 'inline' })
    expect(Buffer.from(result.bytes).toString()).toContain('%PDF-')
    expect(result.headers['Content-Type']).toBe('application/pdf')
    expect(result.headers['Content-Disposition']).toMatch(/^inline;/)
  })

  it('marks attachment downloads with Content-Disposition attachment', async () => {
    const artifact = completedArtifact()
    const { service } = setup({ artifact })
    const result = await service.deliver({ actor: ownerRep, identity, disposition: 'attachment' })
    expect(result.headers['Content-Disposition']).toMatch(/^attachment;/)
  })

  it('denies read-only download consistently as FORBIDDEN', async () => {
    const { service } = setup({ artifact: completedArtifact() })
    await expect(
      service.deliver({ actor: readOnly, identity, disposition: 'inline' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })

  it('answers unauthorized and cross-tenant requests with NOT_FOUND and no artifact leak', async () => {
    const { service } = setup({ artifact: completedArtifact() })
    for (const actor of [outsider, crossTenantAdmin]) {
      await expect(
        service.deliver({ actor, identity, disposition: 'inline' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
      await expect(service.status({ actor, identity })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
    }
  })

  it('refuses delivery before completion without exposing storage details', async () => {
    const generating = completedArtifact({
      status: 'generating',
      objectKey: null,
      mimeType: null,
      sizeBytes: null,
      outputChecksum: null,
      pageCount: null,
      completedAt: null,
    })
    const { service } = setup({ artifact: generating })
    await expect(
      service.deliver({ actor: admin, identity, disposition: 'inline' }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_NOT_COMPLETED', status: 409 })
  })

  it('fails closed when stored bytes no longer match the immutable checksum', async () => {
    const artifact = completedArtifact()
    const { service, storage } = setup({ artifact })
    storage.put(artifact.objectKey!, new Uint8Array(Buffer.from('%PDF- tampered\n%%EOF')))
    await expect(
      service.deliver({ actor: admin, identity, disposition: 'inline' }),
    ).rejects.toMatchObject({ code: 'STORAGE_INTEGRITY_FAILED' })
  })
})

describe('quote PDF status polling', () => {
  it('returns idle when no artifact exists yet', async () => {
    const { service } = setup({})
    await expect(service.status({ actor: readOnly, identity })).resolves.toEqual({
      kind: 'idle',
    })
  })

  it('projects each pipeline state into a stable polling payload', async () => {
    const generating = completedArtifact({
      status: 'generating',
      objectKey: null,
      mimeType: null,
      sizeBytes: null,
      outputChecksum: null,
      pageCount: null,
      completedAt: null,
    })
    const failed = completedArtifact({
      status: 'failed',
      objectKey: null,
      mimeType: null,
      sizeBytes: null,
      outputChecksum: null,
      pageCount: null,
      completedAt: null,
      failedAt: new Date('2026-08-20T12:01:00Z'),
      errorCode: 'render_timeout',
      errorMessage: 'PDF rendering exceeded the configured time limit',
    })
    const completed = completedArtifact()

    const first = setup({ artifact: generating })
    await expect(first.service.status({ actor: admin, identity })).resolves.toMatchObject({
      kind: 'generating',
      attemptCount: 1,
    })

    const second = setup({ artifact: failed })
    await expect(second.service.status({ actor: admin, identity })).resolves.toMatchObject({
      kind: 'failed',
      errorCode: 'render_timeout',
      retryable: true,
    })

    const third = setup({ artifact: completed })
    await expect(third.service.status({ actor: admin, identity })).resolves.toMatchObject({
      kind: 'completed',
      outputChecksum,
      pageCount: 1,
    })
  })
})

describe('quote PDF generation requests', () => {
  it('reuses the artifact pipeline and audits successful generation', async () => {
    const { audit, generateCalls, service } = setup({})
    const view = await service.generate({ actor: ownerRep, quoteId, snapshot, template })
    expect(view.kind).toBe('generating')
    expect(generateCalls).toHaveLength(1)
    expect(generateCalls[0]).toMatchObject({ quoteId, snapshot, template })
    expect(audit.snapshot()).toHaveLength(1)
    expect(audit.snapshot()[0]).toMatchObject({
      action: 'quote.pdf.generated',
      actorId: ownerRep.id,
      quoteId,
    })
  })

  it('denies read-only regeneration and never reaches the pipeline', async () => {
    const { generateCalls, service } = setup({})
    await expect(
      service.generate({ actor: readOnly, quoteId, snapshot, template }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(generateCalls).toHaveLength(0)
  })

  it('maps pipeline failures onto stable retryable payloads', async () => {
    const retryable = setup({
      generateError: new QuotePdfGenerationError('render_timeout', 'deadline'),
    })
    await expect(
      retryable.service.generate({ actor: admin, quoteId, snapshot, template }),
    ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', retryable: true, reason: 'render_timeout' })

    const permanent = setup({
      generateError: new QuotePdfGenerationError('image_metadata_invalid', 'bad image'),
    })
    await expect(
      permanent.service.generate({ actor: admin, quoteId, snapshot, template }),
    ).rejects.toMatchObject({ code: 'GENERATION_FAILED', retryable: false })
  })

  it('hides generation behind NOT_FOUND for actors outside the quote scope', async () => {
    const { generateCalls, service } = setup({})
    await expect(
      service.generate({ actor: crossTenantAdmin, quoteId, snapshot, template }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(generateCalls).toHaveLength(0)
  })
})

describe('quote PDF response headers and filenames', () => {
  it('builds deterministic sanitized filenames with quote identity and version', () => {
    expect(
      createQuotePdfFilename({ quoteNumber: 'ORC-2026-000123', snapshotVersion: 3, variant: 'commercial' }),
    ).toBe('ORC-2026-000123-v3-comercial.pdf')
    expect(
      createQuotePdfFilename({ quoteNumber: 'Orçamento Especial/Áé', snapshotVersion: 12, variant: 'summary' }),
    ).toBe('Orcamento-Especial-Ae-v12-resumida.pdf')
  })

  it('emits RFC-compatible Content-Disposition with UTF-8 filename*', () => {
    const headers = buildQuotePdfResponseHeaders({
      filename: 'ORC-2026-000123-v3-comercial.pdf',
      disposition: 'attachment',
      sizeBytes: 10,
    })
    expect(headers['Content-Type']).toBe('application/pdf')
    expect(headers['Content-Disposition']).toBe(
      `attachment; filename="ORC-2026-000123-v3-comercial.pdf"; filename*=UTF-8''ORC-2026-000123-v3-comercial.pdf`,
    )
    expect(headers['Cache-Control']).toBe('private, no-cache')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
  })

  it('keeps non-ASCII names out of the ASCII fallback but preserves them via RFC 5987', () => {
    const headers = buildQuotePdfResponseHeaders({
      filename: 'orçamento-v1.pdf',
      disposition: 'inline',
      sizeBytes: 1,
    })
    expect(headers['Content-Disposition']).toContain('filename="orcamento-v1.pdf"')
    expect(headers['Content-Disposition']).toContain(`filename*=UTF-8''or%C3%A7amento-v1.pdf`)
  })
})

describe('quote PDF delivery error contract', () => {
  it('carries stable HTTP statuses for UI handling', () => {
    expect(new QuotePdfDeliveryError('UNAUTHENTICATED').status).toBe(401)
    expect(new QuotePdfDeliveryError('FORBIDDEN').status).toBe(403)
    expect(new QuotePdfDeliveryError('NOT_FOUND').status).toBe(404)
    expect(new QuotePdfDeliveryError('INVALID_REQUEST').status).toBe(400)
    expect(new QuotePdfDeliveryError('ARTIFACT_NOT_COMPLETED').status).toBe(409)
    expect(new QuotePdfDeliveryError('GENERATION_FAILED').status).toBe(422)
    expect(new QuotePdfDeliveryError('STORAGE_UNAVAILABLE', { retryable: true }).retryable).toBe(true)
  })

  it('rejects malformed identities without touching storage', async () => {
    const { service } = setup({ artifact: completedArtifact() })
    await expect(
      service.deliver({
        actor: admin,
        identity: { ...identity, quoteId: 'not-a-uuid' },
        disposition: 'inline',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })
})
