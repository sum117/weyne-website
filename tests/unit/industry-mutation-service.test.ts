import { describe, expect, it } from 'vitest'
import type {
  IndustryCreate,
  IndustryDetail,
  IndustryUpdate,
} from '@/domain/industries/contracts'
import {
  createIndustryMutationService,
  type IndustryAuditEvent,
  type IndustryMutationRepository,
  type IndustryUnitOfWork,
} from '@/domain/industries/mutation-service.server'
import type { CatalogActor } from '@/lib/catalog/authorization.server'

const industryId = '11111111-1111-4111-8111-111111111111'
const createdIndustryId = '22222222-2222-4222-8222-222222222222'
const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const representativeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const occurredAt = new Date('2026-08-17T16:00:00.000Z')

const admin = { id: adminId, role: 'admin' } satisfies CatalogActor
const representative = {
  id: representativeId,
  role: 'representative',
} satisfies CatalogActor

const address = {
  street: 'Rua do Sol',
  number: '100',
  complement: null,
  district: 'Santo Antônio',
  city: 'Recife',
  state: 'PE',
  postalCode: '50010000',
  countryCode: 'BR',
} as const

const firstIndustry: IndustryDetail = {
  id: industryId,
  legalName: 'Aurora Higiene Industrial Ltda.',
  tradeName: 'Aurora Higiene',
  cnpj: '41142260000189',
  address,
  defaultCommissionPercentage: '7.500000',
  notes: null,
  createdAt: '2026-08-17T12:00:00.000Z',
  createdByUserId: adminId,
  updatedAt: '2026-08-17T12:00:00.000Z',
  updatedByUserId: adminId,
  archivedAt: null,
  archivedByUserId: null,
}

class MemoryIndustryRepository implements IndustryMutationRepository {
  records = new Map<string, IndustryDetail>([[firstIndustry.id, firstIndustry]])
  events: IndustryAuditEvent[] = []
  calls = 0
  databaseFailure: Error | null = null
  failAudit = false

  async findById(id: string) {
    this.calls += 1
    return this.records.get(id) ?? null
  }

  async findByCnpj(cnpj: string) {
    this.calls += 1
    return [...this.records.values()].find((industry) => industry.cnpj === cnpj) ?? null
  }

  async create(
    input: IndustryCreate,
    metadata: Readonly<{ id: string; actorUserId: string; occurredAt: Date }>,
  ) {
    this.calls += 1
    if (this.databaseFailure) throw this.databaseFailure
    const timestamp = metadata.occurredAt.toISOString()
    const industry: IndustryDetail = {
      ...input,
      id: metadata.id,
      notes: input.notes ?? null,
      createdAt: timestamp,
      createdByUserId: metadata.actorUserId,
      updatedAt: timestamp,
      updatedByUserId: metadata.actorUserId,
      archivedAt: null,
      archivedByUserId: null,
    }
    this.records.set(industry.id, industry)
    return industry
  }

  async update(
    input: IndustryUpdate,
    metadata: Readonly<{ actorUserId: string; occurredAt: Date }>,
  ) {
    this.calls += 1
    const current = this.records.get(input.id)
    if (!current || current.archivedAt !== null) return null
    const updated = {
      ...current,
      ...Object.fromEntries(Object.entries(input).filter(([field]) => field !== 'id')),
      updatedAt: metadata.occurredAt.toISOString(),
      updatedByUserId: metadata.actorUserId,
    } as IndustryDetail
    this.records.set(updated.id, updated)
    return updated
  }

  async archive(
    id: string,
    metadata: Readonly<{ actorUserId: string; occurredAt: Date }>,
  ) {
    this.calls += 1
    const current = this.records.get(id)
    if (!current || current.archivedAt !== null) return null
    const archived: IndustryDetail = {
      ...current,
      updatedAt: metadata.occurredAt.toISOString(),
      updatedByUserId: metadata.actorUserId,
      archivedAt: metadata.occurredAt.toISOString(),
      archivedByUserId: metadata.actorUserId,
    }
    this.records.set(id, archived)
    return archived
  }

  async appendAudit(event: IndustryAuditEvent) {
    if (this.failAudit) throw new Error('audit storage unavailable')
    this.events.push(structuredClone(event))
  }
}

function unitOfWork(repository: MemoryIndustryRepository): IndustryUnitOfWork {
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
  repository: MemoryIndustryRepository,
  actor: CatalogActor | null = admin,
) {
  return createIndustryMutationService({
    authenticate: async () => actor,
    repository,
    unitOfWork: unitOfWork(repository),
    createId: () => createdIndustryId,
    now: () => occurredAt,
  })
}

const createInput = {
  legalName: 'Indústria Nordeste Ltda.',
  tradeName: 'Indústria Nordeste',
  cnpj: '45.723.174/0001-10',
  address,
  defaultCommissionPercentage: '8.250000',
  notes: 'Atendimento regional',
} as const

describe('industry mutation service', () => {
  it.each(['create', 'update', 'archive'] as const)(
    'denies %s independently before validation or persistence',
    async (operation) => {
      const repository = new MemoryIndustryRepository()
      const service = serviceFor(repository, representative)
      const inputs = {
        create: { unsupported: true },
        update: { unsupported: true },
        archive: { unsupported: true },
      }

      await expect(service[operation](inputs[operation])).resolves.toEqual({
        ok: false,
        error: { category: 'forbidden' },
      })
      expect(repository.calls).toBe(0)
      expect(repository.events).toEqual([])
    },
  )

  it('creates with normalized shared schemas and emits a safe audit snapshot', async () => {
    const repository = new MemoryIndustryRepository()

    const result = await serviceFor(repository).create(createInput)

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: createdIndustryId,
        cnpj: '45723174000110',
        defaultCommissionPercentage: '8.250000',
      },
    })
    expect(repository.events).toEqual([
      {
        actor: admin,
        industryId: createdIndustryId,
        action: 'industry.create',
        occurredAt: occurredAt.toISOString(),
        before: null,
        after: {
          legalName: 'Indústria Nordeste Ltda.',
          tradeName: 'Indústria Nordeste',
          defaultCommissionPercentage: '8.250000',
          archived: false,
        },
        metadata: {
          changedFields: [
            'address',
            'cnpj',
            'defaultCommissionPercentage',
            'legalName',
            'notes',
            'tradeName',
          ],
        },
      },
    ])
    expect(JSON.stringify(repository.events)).not.toContain('45723174000110')
    expect(JSON.stringify(repository.events)).not.toContain('Atendimento regional')
    expect(JSON.stringify(repository.events)).not.toContain('Rua do Sol')
  })

  it('updates the default commission source and audits only approved before and after fields', async () => {
    const repository = new MemoryIndustryRepository()

    const result = await serviceFor(repository).update({
      id: industryId,
      tradeName: 'Aurora Profissional',
      defaultCommissionPercentage: '9.125',
      notes: null,
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: industryId,
        tradeName: 'Aurora Profissional',
        defaultCommissionPercentage: '9.125',
        notes: null,
      },
    })
    expect(repository.events).toEqual([
      {
        actor: admin,
        industryId,
        action: 'industry.update',
        occurredAt: occurredAt.toISOString(),
        before: {
          legalName: firstIndustry.legalName,
          tradeName: firstIndustry.tradeName,
          defaultCommissionPercentage: '7.500000',
          archived: false,
        },
        after: {
          legalName: firstIndustry.legalName,
          tradeName: 'Aurora Profissional',
          defaultCommissionPercentage: '9.125',
          archived: false,
        },
        metadata: {
          changedFields: ['defaultCommissionPercentage', 'notes', 'tradeName'],
        },
      },
    ])
    expect(repository.events[0]?.after).not.toHaveProperty('commissionOverride')
    expect(JSON.stringify(repository.events)).not.toContain(firstIndustry.cnpj)
  })

  it('archives by state transition, audits the transition, and conflicts when repeated', async () => {
    const repository = new MemoryIndustryRepository()
    const service = serviceFor(repository)

    const archived = await service.archive({ id: industryId })
    const repeated = await service.archive({ id: industryId })

    expect(archived).toMatchObject({
      ok: true,
      data: {
        id: industryId,
        archivedAt: occurredAt.toISOString(),
        archivedByUserId: adminId,
      },
    })
    expect(repeated).toEqual({ ok: false, error: { category: 'conflict' } })
    expect(repository.records.has(industryId)).toBe(true)
    expect(repository.events).toEqual([
      {
        actor: admin,
        industryId,
        action: 'industry.archive',
        occurredAt: occurredAt.toISOString(),
        before: {
          legalName: firstIndustry.legalName,
          tradeName: firstIndustry.tradeName,
          defaultCommissionPercentage: firstIndustry.defaultCommissionPercentage,
          archived: false,
        },
        after: {
          legalName: firstIndustry.legalName,
          tradeName: firstIndustry.tradeName,
          defaultCommissionPercentage: firstIndustry.defaultCommissionPercentage,
          archived: true,
        },
        metadata: { changedFields: ['archivedAt'] },
      },
    ])
  })

  it('maps database commission constraints to the shared pt-BR validation boundary', async () => {
    const repository = new MemoryIndustryRepository()
    repository.databaseFailure = Object.assign(new Error('private constraint detail'), {
      code: '23514',
      constraint: 'industries_default_commission_ck',
    })

    await expect(serviceFor(repository).create(createInput)).resolves.toEqual({
      ok: false,
      error: {
        category: 'validation',
        issues: [
          {
            path: ['defaultCommissionPercentage'],
            message: 'Informe uma porcentagem entre 0 e 100 com até 6 casas decimais',
          },
        ],
      },
    })
    expect(repository.events).toEqual([])
    expect(repository.records.has(createdIndustryId)).toBe(false)
  })

  it('maps normalized and concurrent duplicate CNPJs to the same safe pt-BR issue', async () => {
    const existingRepository = new MemoryIndustryRepository()
    const formattedDuplicate = await serviceFor(existingRepository).create({
      ...createInput,
      cnpj: '41.142.260/0001-89',
    })

    expect(formattedDuplicate).toEqual({
      ok: false,
      error: {
        category: 'validation',
        issues: [
          {
            path: ['cnpj'],
            message: 'Já existe uma indústria cadastrada com este CNPJ.',
          },
        ],
      },
    })

    const racingRepository = new MemoryIndustryRepository()
    racingRepository.databaseFailure = Object.assign(new Error('private unique detail'), {
      code: '23505',
      constraint: 'industries_cnpj_uidx',
    })
    await expect(serviceFor(racingRepository).create(createInput)).resolves.toEqual(
      formattedDuplicate,
    )
    expect(racingRepository.events).toEqual([])
  })

  it('rejects an update to another normalized CNPJ without mutating either industry', async () => {
    const repository = new MemoryIndustryRepository()
    repository.records.set(createdIndustryId, {
      ...firstIndustry,
      id: createdIndustryId,
      cnpj: '45723174000110',
      legalName: 'Indústria Nordeste Ltda.',
      tradeName: 'Indústria Nordeste',
    })
    const before = new Map(repository.records)

    const result = await serviceFor(repository).update({
      id: industryId,
      cnpj: '45.723.174/0001-10',
    })

    expect(result).toEqual({
      ok: false,
      error: {
        category: 'validation',
        issues: [
          {
            path: ['cnpj'],
            message: 'Já existe uma indústria cadastrada com este CNPJ.',
          },
        ],
      },
    })
    expect(repository.records).toEqual(before)
    expect(repository.events).toEqual([])
  })

  it('rolls the entity mutation back when the audit append fails', async () => {
    const repository = new MemoryIndustryRepository()
    repository.failAudit = true
    const before = repository.records.get(industryId)

    const result = await serviceFor(repository).update({
      id: industryId,
      legalName: 'Não deve persistir',
    })

    expect(result).toMatchObject({ ok: false, error: { category: 'unexpected' } })
    expect(repository.records.get(industryId)).toEqual(before)
    expect(repository.events).toEqual([])
  })
})
