import { createHash } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  CommercialSecurityError,
  createPostgresCommercialSecurityService,
  type PrivateObjectStore,
} from '@/lib/orders/security-service.server'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const tenantA = '10000000-0000-4000-8000-000000000001'
const tenantB = '20000000-0000-4000-8000-000000000001'
const orderA = '30000000-0000-4000-8000-000000000001'
const orderB = '30000000-0000-4000-8000-000000000002'
const quoteA = '40000000-0000-4000-8000-000000000001'

const admin = { id: 'admin-a', role: 'admin' as const, tenantId: tenantA }
const representative = {
  id: 'representative-a',
  role: 'representative' as const,
  tenantId: tenantA,
}
const outsider = {
  id: 'representative-b',
  role: 'representative' as const,
  tenantId: tenantA,
}
const reader = { id: 'reader-a', role: 'read_only' as const, tenantId: tenantA }

class MemoryPrivateObjectStore implements PrivateObjectStore {
  readonly objects = new Map<string, Uint8Array>()

  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, Uint8Array.from(body))
  }

  async get(key: string): Promise<Uint8Array> {
    const body = this.objects.get(key)
    if (!body) throw new Error('missing private object')
    return Uint8Array.from(body)
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }
}

let harness: PostgresTestHarness
let sql: Sql
let storage: MemoryPrivateObjectStore

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'order_security',
    migrationNames: ['0000_migration_smoke.sql', '0090_order_security.sql'],
  })
  sql = postgres(databaseUrl, { max: 4 })
})

beforeEach(async () => {
  await harness.reset()
  storage = new MemoryPrivateObjectStore()
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
  await harness?.close()
})

async function createService() {
  const service = createPostgresCommercialSecurityService({
    sql,
    schemaName: harness.schemaName,
    storage,
  })
  await service.registerResource({
    resourceType: 'order',
    resourceId: orderA,
    tenantId: tenantA,
    ownerUserId: representative.id,
    status: 'open',
    assignedUserIds: [reader.id],
  })
  await service.registerResource({
    resourceType: 'quote',
    resourceId: quoteA,
    tenantId: tenantA,
    ownerUserId: representative.id,
    status: 'approved',
    assignedUserIds: [reader.id],
  })
  await service.registerResource({
    resourceType: 'order',
    resourceId: orderB,
    tenantId: tenantB,
    ownerUserId: 'representative-tenant-b',
    status: 'open',
    assignedUserIds: [],
  })
  return service
}

function uploadInput(body: Uint8Array) {
  return {
    originalFilename: 'pedido.pdf',
    mimeType: 'application/pdf',
    sizeBytes: body.byteLength,
    checksumSha256: createHash('sha256').update(body).digest('base64'),
    body,
  }
}

describe('commercial RBAC, private attachments, and security audit on PostgreSQL', () => {
  it('covers allowed and denied direct-ID operations for all three roles', async () => {
    const service = await createService()

    await expect(service.readResource(admin, 'order', orderA)).resolves.toMatchObject({
      authorization: 'allow',
    })
    await expect(
      service.readResource(representative, 'quote', quoteA),
    ).resolves.toMatchObject({ authorization: 'allow' })
    await expect(service.readResource(reader, 'order', orderA)).resolves.toMatchObject({
      authorization: 'allow_redacted',
    })

    await expect(
      service.checkMutationAccess(representative, 'quote.approve', 'quote', quoteA),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.checkMutationAccess(reader, 'order.confirm', 'order', orderA),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.readResource(outsider, 'order', orderA),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      service.readResource(admin, 'order', orderB),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      service.checkMutationAccess(admin, 'quote.approve', 'order', orderA),
    ).rejects.toThrow('Action quote.approve cannot target order')
  })

  it('keeps upload, listing, download, and deletion private and scoped', async () => {
    const service = await createService()
    const body = Buffer.from('private order attachment')
    const attachment = await service.uploadOrderAttachment(
      representative,
      orderA,
      uploadInput(body),
    )

    expect(attachment.objectKey).toMatch(
      new RegExp(`^order-attachments/${tenantA}/${orderA}/[0-9a-f-]{36}$`),
    )
    expect(storage.objects.has(attachment.objectKey)).toBe(true)
    expect('url' in attachment).toBe(false)
    await expect(service.listOrderAttachments(representative, orderA)).resolves.toEqual([
      expect.objectContaining({ id: attachment.id, objectKey: attachment.objectKey }),
    ])
    await expect(
      service.downloadOrderAttachment(representative, orderA, attachment.id),
    ).resolves.toEqual(Uint8Array.from(body))

    await expect(
      service.listOrderAttachments(reader, orderA),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.downloadOrderAttachment(outsider, orderA, attachment.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      service.downloadOrderAttachment(admin, orderB, attachment.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await service.deleteOrderAttachment(representative, orderA, attachment.id)
    expect(storage.objects.has(attachment.objectKey)).toBe(false)
    await expect(service.listOrderAttachments(admin, orderA)).resolves.toEqual([])
    await expect(
      service.downloadOrderAttachment(admin, orderA, attachment.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects tampered uploads before object or metadata persistence', async () => {
    const service = await createService()
    const body = Buffer.from('untampered')
    const input = uploadInput(body)

    await expect(
      service.uploadOrderAttachment(representative, orderA, {
        ...input,
        checksumSha256: createHash('sha256').update('different').digest('base64'),
      }),
    ).rejects.toBeInstanceOf(CommercialSecurityError)
    expect(storage.objects.size).toBe(0)
  })

  it('persists actor, target, action, outcome, and database timestamp audit trails', async () => {
    const service = await createService()
    const attachment = await service.uploadOrderAttachment(
      representative,
      orderA,
      uploadInput(Buffer.from('audit me')),
    )
    await service.readResource(admin, 'order', orderA)
    await service.listOrderAttachments(representative, orderA)
    await service.downloadOrderAttachment(representative, orderA, attachment.id)
    await expect(service.listOrderAttachments(reader, orderA)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await service.deleteOrderAttachment(representative, orderA, attachment.id)

    await sql.unsafe(`SET search_path TO "${harness.schemaName}", public`)
    const events = await sql<
      Array<{
        actorId: string
        targetId: string
        action: string
        outcome: string
        occurredAt: Date
      }>
    >`
      SELECT actor_id AS "actorId", target_id::text AS "targetId", action,
             outcome, occurred_at AS "occurredAt"
      FROM commercial_security_audit
      ORDER BY occurred_at, id
    `

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: representative.id,
          targetId: orderA,
          action: 'order.attachment.upload',
          outcome: 'allowed',
          occurredAt: expect.any(Date),
        }),
        expect.objectContaining({
          actorId: admin.id,
          targetId: orderA,
          action: 'order.read',
          outcome: 'allowed',
          occurredAt: expect.any(Date),
        }),
        expect.objectContaining({
          actorId: reader.id,
          targetId: orderA,
          action: 'order.attachment.list',
          outcome: 'forbidden',
          occurredAt: expect.any(Date),
        }),
        expect.objectContaining({
          actorId: representative.id,
          targetId: attachment.id,
          action: 'order.attachment.delete',
          outcome: 'allowed',
          occurredAt: expect.any(Date),
        }),
      ]),
    )
    expect(events.every((event) => !Number.isNaN(event.occurredAt.getTime()))).toBe(true)
  })
})
