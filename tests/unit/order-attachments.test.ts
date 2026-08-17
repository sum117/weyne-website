import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AttachmentApiError,
  createInMemoryAttachmentAuditSink,
  createInMemoryAttachmentRepository,
  createInMemoryPrivateAttachmentStorage,
  createOrderAttachmentService,
  toPublicOrderAttachment,
  type AttachmentActor,
  type AttachmentOrder,
} from '@/lib/orders/attachments.server'

const admin: AttachmentActor = { id: randomUUID(), role: 'admin' }
const representative: AttachmentActor = { id: randomUUID(), role: 'representative' }
const readOnly: AttachmentActor = { id: randomUUID(), role: 'read_only' }

const order: AttachmentOrder = {
  id: randomUUID(),
  ownerUserId: representative.id,
  assignedUserIds: [readOnly.id],
  status: 'open',
}

const pdf = Buffer.from('%PDF-1.7\nsynthetic attachment\n%%EOF')
const checksum = createHash('sha256').update(pdf).digest('base64')

function setup(overrides: { maxFilesPerOrder?: number; maxSizeBytes?: number } = {}) {
  const repository = createInMemoryAttachmentRepository({ orders: [order] })
  const storage = createInMemoryPrivateAttachmentStorage()
  const audit = createInMemoryAttachmentAuditSink()
  const service = createOrderAttachmentService({
    repository,
    storage,
    audit,
    policy: {
      allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
      maxFilesPerOrder: overrides.maxFilesPerOrder ?? 3,
      maxSizeBytes: overrides.maxSizeBytes ?? 1024,
    },
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  })
  return { audit, repository, service, storage }
}

const upload = (actor: AttachmentActor = representative) => ({
  actor,
  orderId: order.id,
  idempotencyKey: 'upload-1',
  label: 'Pedido assinado',
  originalFilename: 'pedido-cliente.pdf',
  declaredMimeType: 'application/pdf',
  declaredSizeBytes: pdf.byteLength,
  declaredChecksumSha256: checksum,
  bytes: pdf,
})

describe('secure order attachment service', () => {
  it('round-trips an allowed private file with verified checksum and sanitized audit data', async () => {
    const { audit, service, storage } = setup()

    const created = await service.upload(upload())
    const downloaded = await service.download({
      actor: representative,
      orderId: order.id,
      attachmentId: created.id,
    })

    expect([...downloaded.bytes]).toEqual([...pdf])
    expect(downloaded.checksumSha256).toBe(checksum)
    expect(created).toMatchObject({
      orderId: order.id,
      label: 'Pedido assinado',
      originalFilename: 'pedido-cliente.pdf',
      validatedMimeType: 'application/pdf',
      sizeBytes: pdf.byteLength,
      checksumSha256: checksum,
      state: 'ready',
      createdBy: representative.id,
    })
    expect(created.objectKey).toMatch(/^attachments\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/)
    expect(created.objectKey).not.toContain('pedido')
    expect(storage.publicUrl(created.objectKey)).toBeNull()
    expect(audit.snapshot()).toEqual([
      expect.objectContaining({
        eventType: 'order.attachment.uploaded',
        orderId: order.id,
        attachmentId: created.id,
        actorId: representative.id,
        occurredAt: new Date('2026-08-17T12:00:00.000Z'),
      }),
    ])
    expect(JSON.stringify(audit.snapshot())).not.toMatch(/token|signed|credential|objectKey/i)
  })

  it('validates bytes instead of trusting filename or client MIME', async () => {
    const { service } = setup()

    await expect(
      service.upload({
        ...upload(),
        bytes: Buffer.from('not a pdf'),
        declaredSizeBytes: 9,
        declaredChecksumSha256: createHash('sha256').update('not a pdf').digest('base64'),
      }),
    ).rejects.toMatchObject({ code: 'FILE_SIGNATURE_MISMATCH' })
  })

  it('rejects oversized files and the configured active-file count bound', async () => {
    const tooSmall = setup({ maxSizeBytes: pdf.byteLength - 1 })
    await expect(tooSmall.service.upload(upload())).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    })

    const bounded = setup({ maxFilesPerOrder: 1 })
    await bounded.service.upload(upload())
    await expect(
      bounded.service.upload({ ...upload(admin), idempotencyKey: 'upload-2' }),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_LIMIT_REACHED' })
  })

  it('enforces upload, download, and delete authorization independently', async () => {
    const { service } = setup()
    await expect(service.upload(upload(readOnly))).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const created = await service.upload(upload())
    await expect(
      service.download({ actor: readOnly, orderId: order.id, attachmentId: created.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.delete({
        actor: { id: randomUUID(), role: 'representative' },
        orderId: order.id,
        attachmentId: created.id,
        idempotencyKey: 'delete-1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('makes upload retries idempotent and rejects key reuse for different content', async () => {
    const { repository, service } = setup()

    const first = await service.upload(upload())
    const retried = await service.upload(upload())
    expect(retried).toEqual(first)
    expect(repository.snapshot().attachments).toHaveLength(1)

    await expect(
      service.upload({ ...upload(), label: 'Outro rótulo' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
  })

  it('lists only active metadata after order-level download authorization', async () => {
    const { service } = setup()
    const created = await service.upload(upload())

    await expect(
      service.list({ actor: representative, orderId: order.id }),
    ).resolves.toEqual([created])
    await expect(
      service.list({ actor: readOnly, orderId: order.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('keeps failed uploads unusable and cleans partial objects', async () => {
    const repository = createInMemoryAttachmentRepository({ orders: [order] })
    const storage = createInMemoryPrivateAttachmentStorage({ corruptChecksumOnPut: true })
    const service = createOrderAttachmentService({
      repository,
      storage,
      audit: createInMemoryAttachmentAuditSink(),
      policy: { allowedMimeTypes: ['application/pdf'], maxFilesPerOrder: 3, maxSizeBytes: 1024 },
    })

    await expect(service.upload(upload())).rejects.toMatchObject({ code: 'STORAGE_INTEGRITY_FAILED' })
    expect(repository.snapshot().attachments).toEqual([
      expect.objectContaining({ state: 'failed' }),
    ])
    expect(storage.snapshot()).toEqual([])
    await expect(
      service.download({
        actor: representative,
        orderId: order.id,
        attachmentId: repository.snapshot().attachments[0]!.id,
      }),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_READY' })
  })

  it('uses a retry-safe deleting state and emits deletion audit only after object removal', async () => {
    const { audit, repository, service, storage } = setup()
    const created = await service.upload(upload())

    const deleted = await service.delete({
      actor: representative,
      orderId: order.id,
      attachmentId: created.id,
      idempotencyKey: 'delete-1',
    })

    expect(deleted.state).toBe('deleted')
    expect(storage.snapshot()).toEqual([])
    expect(repository.snapshot().orders).toEqual([order])
    expect(audit.snapshot().at(-1)).toMatchObject({
      eventType: 'order.attachment.deleted',
      actorId: representative.id,
      attachmentId: created.id,
    })
  })

  it('returns stable API error codes', () => {
    expect(new AttachmentApiError('FORBIDDEN').code).toBe('FORBIDDEN')
  })

  it('projects metadata without internal storage or idempotency fields', async () => {
    const { service } = setup()
    const created = await service.upload(upload())

    expect(toPublicOrderAttachment(created)).not.toHaveProperty('objectKey')
    expect(toPublicOrderAttachment(created)).not.toHaveProperty('payloadHash')
    expect(toPublicOrderAttachment(created)).not.toHaveProperty('idempotencyKey')
    expect(toPublicOrderAttachment(created)).toMatchObject({
      id: created.id,
      originalFilename: created.originalFilename,
      checksumSha256: created.checksumSha256,
    })
  })
})
