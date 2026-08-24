import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createPostgresQuotePdfArtifactRepository,
  findQuotePdfArtifactByIdentity,
  loadPersistedQuotePdfSnapshot,
  loadQuotePdfScope,
} from '@/lib/quotes/pdf-artifact-postgres.server'
import {
  createQuotePdfArtifactService,
  createQuotePdfSnapshotChecksum,
  type QuotePdfArtifactStorage,
} from '@/lib/quotes/pdf-artifacts.server'
import {
  createQuotePdfDeliveryService,
  QuotePdfDeliveryError,
} from '@/lib/quotes/pdf-delivery.server'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

const PDF_BYTES = new Uint8Array(
  Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF', 'ascii'),
)
const tenantId = '10000000-0000-4000-8000-000000000001'
const otherTenantId = '20000000-0000-4000-8000-000000000001'
const quoteId = '30000000-0000-4000-8000-000000000001'
const snapshotId = '40000000-0000-4000-8000-000000000001'
const templateId = '50000000-0000-4000-8000-000000000001'
const ownerId = 'representative-owner'
const readerId = 'representative-reader'
const outsiderId = 'representative-outsider'

class PrivatePdfStorage implements QuotePdfArtifactStorage {
  readonly objects = new Map<string, Uint8Array>()
  writes = 0

  async putImmutable(input: Parameters<QuotePdfArtifactStorage['putImmutable']>[0]) {
    this.writes += 1
    const existing = this.objects.get(input.key)
    if (existing) {
      const checksum = sha256(existing)
      return {
        kind: checksum === input.checksum ? ('existing' as const) : ('conflict' as const),
        checksum,
        sizeBytes: existing.byteLength,
      }
    }
    this.objects.set(input.key, input.bytes.slice())
    return {
      kind: 'created' as const,
      checksum: input.checksum,
      sizeBytes: input.bytes.byteLength,
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const bytes = this.objects.get(key)
    return bytes?.slice() ?? null
  }
}

let harness: PostgresTestHarness
let storage: PrivatePdfStorage
let renders: number

const identity = {
  quoteId,
  snapshotId,
  snapshotVersion: 1,
  templateId,
  templateVersion: 1,
}

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'quote_pdf_security',
    migrationNames: [
      '0002_quote_persistence.sql',
      '0090_order_security.sql',
      '0006_quote_pdf_artifacts.sql',
    ],
  })
})

beforeEach(async () => {
  await harness.reset()
  storage = new PrivatePdfStorage()
  renders = 0

  const snapshotContent = {
    id: snapshotId,
    version: 1,
    payload: { quoteNumber: 'ORC-2026-000001', customer: { name: 'Cliente Histórico' } },
    images: [],
  }
  const sourceChecksum = createQuotePdfSnapshotChecksum(snapshotContent)

  await harness.sql`
    INSERT INTO quotes (
      id, quote_number, owner_user_id, status, valid_until, version,
      customer_snapshot, commercial_snapshot
    ) VALUES (
      ${quoteId}::uuid, 'ORC-2026-000001', ${ownerId}, 'draft', '2026-12-31', 1,
      ${JSON.stringify({ id: 'customer-1' })}::text::jsonb,
      ${JSON.stringify({ lines: [] })}::text::jsonb
    )
  `
  await harness.sql`
    INSERT INTO commercial_resource_scopes (
      resource_type, resource_id, tenant_id, owner_user_id, resource_status
    ) VALUES ('quote', ${quoteId}::uuid, ${tenantId}::uuid, ${ownerId}, 'draft')
  `
  await harness.sql`
    INSERT INTO commercial_resource_assignments (resource_type, resource_id, user_id)
    VALUES ('quote', ${quoteId}::uuid, ${readerId})
  `
  await harness.sql`
    INSERT INTO quote_snapshots (id, quote_id, version, payload, source_checksum, captured_by)
    VALUES (
      ${snapshotId}::uuid, ${quoteId}::uuid, 1,
      ${JSON.stringify(snapshotContent.payload)}::text::jsonb,
      ${sourceChecksum}, 'integration-test'
    )
  `
})

afterAll(async () => {
  await harness?.close()
})

function artifactService() {
  return createQuotePdfArtifactService({
    loadSnapshot: (input) =>
      loadPersistedQuotePdfSnapshot(harness.sql, harness.schemaName, input),
    repository: createPostgresQuotePdfArtifactRepository({
      sql: harness.sql,
      schemaName: harness.schemaName,
    }),
    storage,
    renderer: {
      async render() {
        renders += 1
        await new Promise((resolve) => setTimeout(resolve, 25))
        return { bytes: PDF_BYTES, pageCount: 1 }
      },
    },
  })
}

function deliveryService() {
  const artifacts = artifactService()
  return createQuotePdfDeliveryService({
    loadQuoteScope: (id) => loadQuotePdfScope(harness.sql, harness.schemaName, id),
    repository: {
      findByIdentity: (request) =>
        findQuotePdfArtifactByIdentity(harness.sql, harness.schemaName, request),
    },
    storage,
    audit: { append: async () => undefined },
    generate: artifacts.generate,
  })
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('quote PDF PostgreSQL security and idempotency', () => {
  it('persists one immutable private artifact for concurrent generation and streams it only to authorized actors', async () => {
    const generator = artifactService()
    const snapshot = await loadPersistedQuotePdfSnapshot(harness.sql, harness.schemaName, identity)
    if (!snapshot) throw new Error('seeded quote PDF snapshot was not found')
    const request = {
      quoteId,
      snapshot,
      template: { id: templateId, version: 1, variant: 'commercial' as const },
    }

    const [first, second] = await Promise.all([
      generator.generate(request),
      generator.generate(request),
    ])

    expect(first).toMatchObject({ status: 'completed', attemptCount: 1 })
    expect(second).toEqual(first)
    expect(renders).toBe(1)
    expect(storage.writes).toBe(1)
    expect(storage.objects.size).toBe(1)

    const persisted = await findQuotePdfArtifactByIdentity(
      harness.sql,
      harness.schemaName,
      identity,
    )
    expect(persisted).toMatchObject({
      id: first.id,
      status: 'completed',
      mimeType: 'application/pdf',
      sizeBytes: PDF_BYTES.byteLength,
      outputChecksum: sha256(PDF_BYTES),
      pageCount: 1,
    })
    expect(persisted?.objectKey).toMatch(/^quote-pdfs\/[0-9a-f-]{36}\/[0-9a-f]{64}\.pdf$/)
    await expect(
      harness.sql`UPDATE quote_pdf_artifacts SET object_key = 'tampered.pdf' WHERE id = ${first.id}::uuid`,
    ).rejects.toMatchObject({ code: '55000' })

    const delivery = deliveryService()
    const ownerDownload = await delivery.deliver({
      actor: { id: ownerId, role: 'representative', tenantId },
      identity,
      disposition: 'attachment',
    })
    expect(ownerDownload.bytes).toEqual(PDF_BYTES)
    expect(ownerDownload.headers).toMatchObject({
      'Content-Type': 'application/pdf',
      'Content-Disposition': expect.stringContaining('attachment; filename="ORC-2026-000001-v1-comercial.pdf"'),
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
    })

    await expect(
      delivery.status({
        actor: { id: readerId, role: 'read_only', tenantId },
        identity,
      }),
    ).resolves.toMatchObject({ kind: 'completed', artifactId: first.id })
    await expect(
      delivery.deliver({
        actor: { id: readerId, role: 'read_only', tenantId },
        identity,
        disposition: 'inline',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })

    for (const actor of [
      { id: outsiderId, role: 'representative' as const, tenantId },
      { id: 'other-tenant-admin', role: 'admin' as const, tenantId: otherTenantId },
    ]) {
      await expect(
        delivery.deliver({ actor, identity, disposition: 'inline' }),
      ).rejects.toEqual(new QuotePdfDeliveryError('NOT_FOUND'))
    }
  })
})
