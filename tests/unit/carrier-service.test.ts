import { describe, expect, it, vi } from 'vitest'
import type {
  CarrierCreate,
  CarrierDetail,
  CarrierListQuery,
  CarrierUpdate,
} from '@/domain/carriers/contracts'
import {
  createCarrierService,
  type CarrierAuditEvent,
  type CarrierRepository,
  type CarrierUnitOfWork,
} from '@/domain/carriers/service.server'
import {
  createCarrierOperations,
  type CarrierServiceContract,
} from '@/features/app/carriers/carrier.functions'
import type { CatalogActor } from '@/lib/catalog/authorization.server'

const carrierId = '11111111-1111-4111-8111-111111111111'
const createdCarrierId = '22222222-2222-4222-8222-222222222222'
const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const representativeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const readerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const occurredAt = new Date('2026-08-17T15:00:00.000Z')

const actors = {
  admin: { id: adminId, role: 'admin' },
  representative: { id: representativeId, role: 'representative' },
  readOnly: { id: readerId, role: 'read_only' },
} satisfies Record<string, CatalogActor>

const firstCarrier: CarrierDetail = {
  id: carrierId,
  name: 'Transportes Aurora',
  taxId: '41142260000189',
  contactName: 'Marina Alves',
  email: 'contato@aurora.example',
  phone: '81999998888',
  streetAddress: 'Rua do Sol, 100',
  postalCode: '50010000',
  city: 'Recife',
  state: 'PE',
  notes: 'Atendimento regional',
  createdAt: '2026-08-17T12:00:00.000Z',
  createdByUserId: adminId,
  updatedAt: '2026-08-17T12:00:00.000Z',
  updatedByUserId: adminId,
  archivedAt: null,
  archivedByUserId: null,
}

class MemoryCarrierRepository implements CarrierRepository {
  records = new Map<string, CarrierDetail>([[firstCarrier.id, firstCarrier]])
  events: CarrierAuditEvent[] = []
  failAudit = false
  duplicateTaxId = false
  calls = 0

  async findById(id: string) {
    this.calls += 1
    return this.records.get(id) ?? null
  }

  async findActiveById(id: string) {
    this.calls += 1
    const carrier = this.records.get(id)
    return carrier?.archivedAt === null ? carrier : null
  }

  async list(_query: CarrierListQuery) {
    this.calls += 1
    return {
      items: [...this.records.values()].map(({ contactName: _contactName, streetAddress: _streetAddress, postalCode: _postalCode, notes: _notes, createdAt: _createdAt, createdByUserId: _createdByUserId, updatedByUserId: _updatedByUserId, archivedByUserId: _archivedByUserId, ...item }) => item),
      nextCursor: null,
    }
  }

  async create(input: CarrierCreate, metadata: Readonly<{ id: string; actorUserId: string; occurredAt: Date }>) {
    this.calls += 1
    if (this.duplicateTaxId) throw Object.assign(new Error('duplicate internal detail'), { code: '23505' })
    const timestamp = metadata.occurredAt.toISOString()
    const carrier: CarrierDetail = {
      id: metadata.id,
      name: input.name,
      taxId: input.taxId ?? null,
      contactName: input.contactName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      streetAddress: input.streetAddress ?? null,
      postalCode: input.postalCode ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      notes: input.notes ?? null,
      createdAt: timestamp,
      createdByUserId: metadata.actorUserId,
      updatedAt: timestamp,
      updatedByUserId: metadata.actorUserId,
      archivedAt: null,
      archivedByUserId: null,
    }
    this.records.set(carrier.id, carrier)
    return carrier
  }

  async update(input: CarrierUpdate, metadata: Readonly<{ actorUserId: string; occurredAt: Date }>) {
    this.calls += 1
    const current = this.records.get(input.id)
    if (!current || current.archivedAt !== null) return null
    const updated: CarrierDetail = {
      ...current,
      ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id')),
      updatedAt: metadata.occurredAt.toISOString(),
      updatedByUserId: metadata.actorUserId,
    }
    this.records.set(updated.id, updated)
    return updated
  }

  async archive(id: string, metadata: Readonly<{ actorUserId: string; occurredAt: Date }>) {
    this.calls += 1
    const current = this.records.get(id)
    if (!current || current.archivedAt !== null) return null
    const archived: CarrierDetail = {
      ...current,
      updatedAt: metadata.occurredAt.toISOString(),
      updatedByUserId: metadata.actorUserId,
      archivedAt: metadata.occurredAt.toISOString(),
      archivedByUserId: metadata.actorUserId,
    }
    this.records.set(id, archived)
    return archived
  }

  async appendAudit(event: CarrierAuditEvent) {
    if (this.failAudit) throw new Error('audit storage unavailable')
    this.events.push(structuredClone(event))
  }
}

function unitOfWork(repository: MemoryCarrierRepository): CarrierUnitOfWork {
  return {
    async transaction(work) {
      const records = new Map(repository.records)
      const events = structuredClone(repository.events)
      try {
        return await work(repository)
      } catch (error) {
        repository.records = records
        repository.events = events
        throw error
      }
    },
  }
}

function serviceFor(
  repository: MemoryCarrierRepository,
  actor: CatalogActor | null = actors.admin,
) {
  return createCarrierService({
    authenticate: async () => actor,
    repository,
    unitOfWork: unitOfWork(repository),
    createId: () => createdCarrierId,
    now: () => occurredAt,
  })
}

describe('carrier service authorization and references', () => {
  it.each([actors.admin, actors.representative, actors.readOnly])(
    'allows $role to list and resolve historical detail',
    async (actor) => {
      const repository = new MemoryCarrierRepository()
      const service = serviceFor(repository, actor)

      await expect(service.list({})).resolves.toMatchObject({ ok: true })
      await expect(service.detail({ id: carrierId })).resolves.toEqual({
        ok: true,
        data: firstCarrier,
      })
    },
  )

  it.each([actors.representative, actors.readOnly])(
    'denies $role writes before touching persistence',
    async (actor) => {
      const repository = new MemoryCarrierRepository()
      const service = serviceFor(repository, actor)

      const result = await service.archive({ id: carrierId })

      expect(result).toEqual({ ok: false, error: { category: 'forbidden' } })
      expect(repository.calls).toBe(0)
      expect(repository.events).toEqual([])
    },
  )

  it('keeps archived carriers resolvable historically but rejects them for active selection', async () => {
    const repository = new MemoryCarrierRepository()
    const service = serviceFor(repository)

    await expect(service.archive({ id: carrierId })).resolves.toMatchObject({ ok: true })
    await expect(service.detail({ id: carrierId })).resolves.toMatchObject({
      ok: true,
      data: { id: carrierId, archivedAt: occurredAt.toISOString() },
    })
    await expect(service.resolveActive({ id: carrierId })).resolves.toEqual({
      ok: false,
      error: { category: 'reference' },
    })
    await expect(service.archive({ id: carrierId })).resolves.toEqual({
      ok: false,
      error: { category: 'conflict' },
    })
  })
})

describe('carrier service validation, conflicts, and audit', () => {
  it('creates and audits only approved change metadata without sensitive values', async () => {
    const repository = new MemoryCarrierRepository()
    const service = serviceFor(repository)

    const result = await service.create({
      name: '  Expresso Nordeste  ',
      taxId: '41.142.260/0001-89',
      email: 'CONTATO@EXAMPLE.COM',
      notes: 'Valor confidencial',
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: createdCarrierId,
        name: 'Expresso Nordeste',
        taxId: '41142260000189',
        email: 'contato@example.com',
      },
    })
    expect(repository.events).toEqual([
      {
        actor: actors.admin,
        carrierId: createdCarrierId,
        action: 'carrier.create',
        occurredAt: occurredAt.toISOString(),
        metadata: {
          changedFields: ['email', 'name', 'notes', 'taxId'],
        },
      },
    ])
    expect(JSON.stringify(repository.events)).not.toContain('Valor confidencial')
    expect(JSON.stringify(repository.events)).not.toContain('41142260000189')
    expect(JSON.stringify(repository.events)).not.toContain('contato@example.com')
  })

  it('audits update field names and rolls back a mutation when audit storage fails', async () => {
    const repository = new MemoryCarrierRepository()
    const service = serviceFor(repository)

    await expect(service.update({ id: carrierId, name: 'Nova Aurora', notes: null })).resolves.toMatchObject({ ok: true })
    expect(repository.events[0]).toMatchObject({
      carrierId,
      action: 'carrier.update',
      metadata: { changedFields: ['name', 'notes'] },
    })

    repository.failAudit = true
    const before = repository.records.get(carrierId)
    const failed = await service.update({ id: carrierId, city: 'Olinda' })

    expect(failed).toMatchObject({ ok: false, error: { category: 'unexpected' } })
    expect(repository.records.get(carrierId)).toEqual(before)
  })

  it('returns safe validation and duplicate identity conflicts', async () => {
    const repository = new MemoryCarrierRepository()
    const service = serviceFor(repository)

    await expect(service.create({ name: '', unsupported: true })).resolves.toMatchObject({
      ok: false,
      error: { category: 'validation' },
    })
    expect(repository.calls).toBe(0)

    repository.duplicateTaxId = true
    await expect(service.create({ name: 'Duplicada', taxId: '41142260000189' })).resolves.toEqual({
      ok: false,
      error: { category: 'conflict' },
    })
  })
})

describe('carrier public operation boundary', () => {
  it('returns pt-BR forbidden and reference errors without leaking internals', async () => {
    const forbiddenService = serviceFor(new MemoryCarrierRepository(), actors.readOnly)
    const operations = createCarrierOperations({
      getService: async () => forbiddenService,
      logUnexpectedError: vi.fn(),
    })

    await expect(operations.archive({ id: carrierId })).resolves.toEqual({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        status: 403,
        message: 'Você não tem permissão para realizar esta operação.',
      },
    })

    const archivedRepository = new MemoryCarrierRepository()
    await serviceFor(archivedRepository).archive({ id: carrierId })
    const referenceOperations = createCarrierOperations({
      getService: async () => serviceFor(archivedRepository),
      logUnexpectedError: vi.fn(),
    })
    await expect(referenceOperations.resolveActive({ id: carrierId })).resolves.toEqual({
      ok: false,
      error: {
        code: 'REFERENCE_UNAVAILABLE',
        status: 409,
        message: 'A transportadora arquivada não pode ser selecionada.',
      },
    })
  })

  it('sanitizes unexpected database details and logs only on the server', async () => {
    const internal = new Error('SQLSTATE 42P01 secret schema')
    const logUnexpectedError = vi.fn()
    const service = {
      list: vi.fn(async () => ({ ok: false, error: { category: 'unexpected', cause: internal } })),
      detail: vi.fn(),
      resolveActive: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
    } as unknown as CarrierServiceContract
    const operations = createCarrierOperations({ getService: async () => service, logUnexpectedError })

    const result = await operations.list({})

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Não foi possível concluir a operação.',
      },
    })
    expect(JSON.stringify(result)).not.toContain('SQLSTATE')
    expect(logUnexpectedError).toHaveBeenCalledWith(internal)
  })
})
