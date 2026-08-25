import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createInMemoryProductAttachmentAuditSink,
  createInMemoryProductAttachmentRepository,
  createInMemoryProductAttachmentStorage,
  createProductAttachmentService,
  type ProductAttachmentActor,
} from '@/lib/products/attachments.server'

const admin: ProductAttachmentActor = { id: randomUUID(), role: 'admin' }
const representative: ProductAttachmentActor = {
  id: randomUUID(),
  role: 'representative',
}
const productId = randomUUID()
const pdf = Buffer.from(
  [
    '%PDF-1.7',
    '1 0 obj',
    '<< /Type /Catalog >>',
    'endobj',
    'trailer',
    '<< /Root 1 0 R >>',
    '%%EOF',
  ].join('\n'),
)
const checksumSha256 = createHash('sha256').update(pdf).digest('base64')
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngChecksum = createHash('sha256').update(png).digest('base64')
const now = new Date('2026-08-17T18:00:00.000Z')

function setup(options: { uploadTtlSeconds?: number; downloadTtlSeconds?: number } = {}) {
  let currentTime = now
  const repository = createInMemoryProductAttachmentRepository({
    products: [{ id: productId, archived: false }],
  })
  const storage = createInMemoryProductAttachmentStorage()
  const audit = createInMemoryProductAttachmentAuditSink()
  const service = createProductAttachmentService({
    authenticate: async (actor) => actor ?? null,
    repository,
    storage,
    audit,
    now: () => currentTime,
    uploadTtlSeconds: options.uploadTtlSeconds ?? 300,
    downloadTtlSeconds: options.downloadTtlSeconds ?? 60,
  })
  return {
    audit,
    repository,
    service,
    storage,
    setNow(value: Date) {
      currentTime = value
    },
  }
}

function documentUpload(actor: ProductAttachmentActor = admin) {
  return {
    actor,
    productId,
    idempotencyKey: 'upload-document-1',
    category: 'TECHNICAL_SHEET' as const,
    originalFilename: 'ficha-tecnica.pdf',
    declaration: {
      mimeType: 'application/pdf',
      sizeBytes: pdf.byteLength,
      checksumSha256,
    },
    documentMetadata: {
      displayLabel: 'Ficha técnica',
      documentVersion: '2026.08',
      effectiveDate: '2026-08-17',
    },
  }
}

function photoUpload(idempotencyKey: string) {
  return {
    actor: admin,
    productId,
    idempotencyKey,
    category: 'PHOTO' as const,
    originalFilename: `${idempotencyKey}.png`,
    declaration: {
      mimeType: 'image/png',
      sizeBytes: png.byteLength,
      checksumSha256: pngChecksum,
    },
  }
}

describe('secure product attachment service', () => {
  it('initiates a private signed upload and finalizes inspected bytes idempotently', async () => {
    const { audit, repository, service, storage } = setup()

    const initiated = await service.initiateUpload(documentUpload())
    expect(initiated.upload).toMatchObject({
      method: 'PUT',
      expiresAt: '2026-08-17T18:05:00.000Z',
    })
    expect(initiated.upload.url).toContain('signed-upload.test')
    expect(JSON.stringify(initiated)).not.toContain('attachments/')

    storage.seed(repository.snapshot().attachments[0]!.objectKey, pdf)
    const first = await service.finalizeUpload({
      actor: admin,
      attachmentId: initiated.attachment.id,
    })
    const retried = await service.finalizeUpload({
      actor: admin,
      attachmentId: initiated.attachment.id,
    })

    expect(first.uploadStatus).toBe('AVAILABLE')
    expect(retried).toEqual(first)
    expect(repository.snapshot().attachments).toHaveLength(1)
    expect(audit.snapshot().map((event) => event.action)).toEqual([
      'product.attachment.upload.initiated',
      'product.attachment.upload.completed',
    ])
    expect(JSON.stringify(audit.snapshot())).not.toMatch(
      /signed-upload|objectKey|ficha-tecnica/i,
    )
  })

  it('enforces read and mutation authorization independently', async () => {
    const { service } = setup()

    await expect(
      service.initiateUpload(documentUpload(representative)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', retryable: false })

    await expect(
      service.listAttachments({ actor: representative, productId }),
    ).resolves.toEqual([])
  })

  it('rejects invalid bytes, checksum mismatches, and declared-size mismatches', async () => {
    const invalid = setup()
    const invalidInitiated = await invalid.service.initiateUpload(documentUpload())
    invalid.storage.seed(
      invalid.repository.snapshot().attachments[0]!.objectKey,
      Buffer.from('not a pdf but same byte length'.padEnd(pdf.byteLength, '!')),
    )
    await expect(
      invalid.service.finalizeUpload({
        actor: admin,
        attachmentId: invalidInitiated.attachment.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONTENT', retryable: false })
    expect(invalid.repository.snapshot().attachments[0]).toMatchObject({
      uploadStatus: 'FAILED',
      failureCode: 'INVALID_CONTENT',
    })
    expect(invalid.storage.snapshot()).toEqual([])

    const checksumMismatch = setup()
    const checksumInitiated = await checksumMismatch.service.initiateUpload(
      documentUpload(),
    )
    const changedPdf = Buffer.from(pdf)
    const payloadIndex = changedPdf.indexOf('Catalog')
    changedPdf[payloadIndex] = changedPdf[payloadIndex] === 65 ? 66 : 65
    checksumMismatch.storage.seed(
      checksumMismatch.repository.snapshot().attachments[0]!.objectKey,
      changedPdf,
    )
    await expect(
      checksumMismatch.service.finalizeUpload({
        actor: admin,
        attachmentId: checksumInitiated.attachment.id,
      }),
    ).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })

    const sizeMismatch = setup()
    const sizeInitiated = await sizeMismatch.service.initiateUpload(documentUpload())
    sizeMismatch.storage.seed(
      sizeMismatch.repository.snapshot().attachments[0]!.objectKey,
      Buffer.concat([pdf, Buffer.from('extra')]),
    )
    await expect(
      sizeMismatch.service.finalizeUpload({
        actor: admin,
        attachmentId: sizeInitiated.attachment.id,
      }),
    ).rejects.toMatchObject({ code: 'DECLARATION_MISMATCH' })
  })

  it('enforces category limits before creating upload metadata', async () => {
    const { repository, service } = setup()

    await expect(
      service.initiateUpload({
        ...documentUpload(),
        idempotencyKey: 'too-large',
        declaration: {
          ...documentUpload().declaration,
          sizeBytes: 25 * 1024 * 1024 + 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE', status: 413 })
    expect(repository.snapshot().attachments).toEqual([])
  })

  it('fails expired upload attempts without making stored bytes available', async () => {
    const context = setup({ uploadTtlSeconds: 30 })
    const initiated = await context.service.initiateUpload(documentUpload())
    context.storage.seed(context.repository.snapshot().attachments[0]!.objectKey, pdf)
    context.setNow(new Date('2026-08-17T18:00:31.000Z'))

    await expect(
      context.service.finalizeUpload({
        actor: admin,
        attachmentId: initiated.attachment.id,
      }),
    ).rejects.toMatchObject({ code: 'UPLOAD_EXPIRED', status: 410 })
    expect(context.repository.snapshot().attachments[0]).toMatchObject({
      uploadStatus: 'FAILED',
      failureCode: 'UPLOAD_EXPIRED',
    })
    expect(context.storage.snapshot()).toEqual([])
  })

  it('returns only short-lived signed downloads after authorization', async () => {
    const context = setup({ downloadTtlSeconds: 45 })
    const initiated = await context.service.initiateUpload(documentUpload())
    context.storage.seed(context.repository.snapshot().attachments[0]!.objectKey, pdf)
    await context.service.finalizeUpload({
      actor: admin,
      attachmentId: initiated.attachment.id,
    })

    const authorized = await context.service.authorizeDownload({
      actor: representative,
      attachmentId: initiated.attachment.id,
    })
    expect(authorized.download).toMatchObject({
      method: 'GET',
      expiresAt: '2026-08-17T18:00:45.000Z',
    })
    expect(JSON.stringify(authorized.attachment)).not.toMatch(
      /objectKey|attachments\//,
    )
    expect(context.audit.snapshot().at(-1)?.action).toBe(
      'product.attachment.download.authorized',
    )
  })

  it('updates document metadata and deletes the private object with audit events', async () => {
    const context = setup()
    const initiated = await context.service.initiateUpload(documentUpload())
    context.storage.seed(context.repository.snapshot().attachments[0]!.objectKey, pdf)
    await context.service.finalizeUpload({
      actor: admin,
      attachmentId: initiated.attachment.id,
    })

    const updated = await context.service.updateDocumentMetadata({
      actor: admin,
      attachmentId: initiated.attachment.id,
      displayLabel: 'Ficha técnica revisada',
      documentVersion: '2026.09',
      effectiveDate: '2026-09-01',
    })
    expect(updated).toMatchObject({
      displayLabel: 'Ficha técnica revisada',
      documentVersion: '2026.09',
      effectiveDate: '2026-09-01',
    })

    const deleted = await context.service.deleteAttachment({
      actor: admin,
      attachmentId: initiated.attachment.id,
    })
    const retriedDeletion = await context.service.deleteAttachment({
      actor: admin,
      attachmentId: initiated.attachment.id,
    })
    expect(deleted.deletedBy).toBe(admin.id)
    expect(retriedDeletion).toEqual(deleted)
    expect(context.storage.snapshot()).toEqual([])
    await expect(
      context.service.listAttachments({ actor: admin, productId }),
    ).resolves.toEqual([])
    expect(context.audit.snapshot().map((event) => event.action)).toContain(
      'product.attachment.metadata.updated',
    )
    expect(context.audit.snapshot().at(-1)?.action).toBe(
      'product.attachment.deleted',
    )
    expect(
      context.audit
        .snapshot()
        .filter((event) => event.action === 'product.attachment.deleted'),
    ).toHaveLength(1)
  })

  it('keeps initiation retries idempotent and rejects key reuse', async () => {
    const context = setup()
    const first = await context.service.initiateUpload(documentUpload())
    const retried = await context.service.initiateUpload(documentUpload())
    expect(retried.attachment).toEqual(first.attachment)
    expect(context.repository.snapshot().attachments).toHaveLength(1)

    await expect(
      context.service.initiateUpload({
        ...documentUpload(),
        originalFilename: 'outra-ficha.pdf',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
  })

  it('retries the same upload intent after transient signing and audit failures', async () => {
    const signing = setup()
    const signUpload = signing.storage.signUpload.bind(signing.storage)
    signing.storage.signUpload = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary signer failure'))
      .mockImplementation(signUpload)
    await expect(
      signing.service.initiateUpload(documentUpload()),
    ).rejects.toMatchObject({ code: 'STORAGE_ERROR', retryable: true })
    const signedRetry = await signing.service.initiateUpload(documentUpload())
    expect(signedRetry.attachment.id).toBe(
      signing.repository.snapshot().attachments[0]!.id,
    )
    expect(signing.repository.snapshot().attachments).toHaveLength(1)

    const auditing = setup()
    const append = auditing.audit.append.bind(auditing.audit)
    auditing.audit.append = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary audit failure'))
      .mockImplementation(append)
    await expect(
      auditing.service.initiateUpload(documentUpload()),
    ).rejects.toMatchObject({ code: 'STORAGE_ERROR', retryable: true })
    expect(auditing.repository.snapshot().attachments[0]?.uploadStatus).toBe(
      'PENDING',
    )
    await auditing.service.initiateUpload(documentUpload())
    expect(auditing.audit.snapshot()).toHaveLength(1)
  })

  it('rejects PDF-shaped bytes that are not structurally a PDF', async () => {
    const context = setup()
    const spoofed = Buffer.from('%PDF-1.7\nnot really a document\n%%EOF')
    const initiated = await context.service.initiateUpload({
      ...documentUpload(),
      idempotencyKey: 'spoofed-pdf',
      declaration: {
        mimeType: 'application/pdf',
        sizeBytes: spoofed.byteLength,
        checksumSha256: createHash('sha256').update(spoofed).digest('base64'),
      },
    })
    context.storage.seed(
      context.repository.snapshot().attachments[0]!.objectKey,
      spoofed,
    )
    await expect(
      context.service.finalizeUpload({
        actor: admin,
        attachmentId: initiated.attachment.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONTENT' })
  })

  it('reorders photos and selects exactly one primary photo atomically', async () => {
    const context = setup()
    const first = await context.service.initiateUpload(photoUpload('photo-1'))
    const second = await context.service.initiateUpload(photoUpload('photo-2'))

    const reordered = await context.service.reorderPhotos({
      actor: admin,
      productId,
      orderedAttachmentIds: [second.attachment.id, first.attachment.id],
    })
    expect(
      reordered.map(({ id, photoPosition, isPrimary }) => ({
        id,
        photoPosition,
        isPrimary,
      })),
    ).toEqual([
      { id: second.attachment.id, photoPosition: 0, isPrimary: false },
      { id: first.attachment.id, photoPosition: 1, isPrimary: true },
    ])

    const selected = await context.service.selectPrimaryPhoto({
      actor: admin,
      attachmentId: second.attachment.id,
    })
    expect(selected.filter((photo) => photo.isPrimary)).toEqual([
      expect.objectContaining({ id: second.attachment.id, photoPosition: 0 }),
    ])
    expect(
      context.audit
        .snapshot()
        .filter((event) => event.action === 'product.attachment.ordering.updated'),
    ).toHaveLength(2)
  })
})
