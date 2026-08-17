import { describe, expect, it, vi } from 'vitest'
import type { IndustryDetail, IndustryListQuery } from '@/domain/industries/contracts'
import {
  createIndustryQueryService,
  type IndustryQueryRepository,
} from '@/domain/industries/query-service.server'
import { CatalogAccessError, type CatalogActor } from '@/lib/catalog/authorization.server'

const industry: IndustryDetail = {
  id: '3cc5f31d-06d7-4284-aad4-8136c4b35631',
  legalName: 'Aurora Higiene Industrial Ltda.',
  tradeName: 'Aurora Higiene',
  cnpj: '41142260000189',
  address: {
    street: 'Rua do Sol',
    number: '100',
    complement: null,
    district: 'Santo Antônio',
    city: 'Recife',
    state: 'PE',
    postalCode: '50010000',
    countryCode: 'BR',
  },
  defaultCommissionPercentage: '7.500000',
  notes: null,
  createdAt: '2026-08-17T12:00:00.000Z',
  createdByUserId: '14ea395b-48e6-4567-b851-7cfa6f7375a4',
  updatedAt: '2026-08-17T12:00:00.000Z',
  updatedByUserId: '14ea395b-48e6-4567-b851-7cfa6f7375a4',
  archivedAt: null,
  archivedByUserId: null,
}

function createRepository(overrides: Partial<IndustryQueryRepository> = {}) {
  return {
    findActiveById: vi.fn(async () => industry),
    list: vi.fn(async () => ({ items: [industry], nextCursor: null })),
    ...overrides,
  } satisfies IndustryQueryRepository
}

function createService(
  repository: IndustryQueryRepository,
  actor: CatalogActor | null = { id: 'reader-a', role: 'read_only' },
) {
  return createIndustryQueryService({
    repository,
    authenticate: async () => actor,
  })
}

describe('industry query service', () => {
  it('authenticates and validates detail lookups before reading active records', async () => {
    const repository = createRepository()
    const service = createService(repository)

    await expect(service.detail({ id: 'not-a-uuid' })).resolves.toMatchObject({
      ok: false,
      error: { category: 'validation' },
    })
    expect(repository.findActiveById).not.toHaveBeenCalled()

    await expect(service.detail({ id: industry.id })).resolves.toEqual({
      ok: true,
      data: industry,
    })
    expect(repository.findActiveById).toHaveBeenCalledWith(industry.id)
  })

  it('returns the same not-found result for missing and archived records', async () => {
    const repository = createRepository({ findActiveById: vi.fn(async () => null) })

    await expect(createService(repository).detail({ id: industry.id })).resolves.toEqual({
      ok: false,
      error: { category: 'not-found' },
    })
  })

  it('normalizes and forwards only allowlisted list input', async () => {
    const repository = createRepository()
    const service = createService(repository)

    await expect(
      service.list({
        limit: '2',
        filters: { search: '  41.142.260/0001-89  ', archiveState: 'all' },
        sortBy: 'cnpj',
        sortDirection: 'desc',
      }),
    ).resolves.toEqual({
      ok: true,
      data: { items: [industry], nextCursor: null },
    })
    expect(repository.list).toHaveBeenCalledWith({
      limit: 2,
      filters: { search: '41.142.260/0001-89', archiveState: 'all' },
      sortBy: 'cnpj',
      sortDirection: 'desc',
    } satisfies IndustryListQuery)

    const rejected = await service.list({ sortBy: 'notes', filters: { sql: 'TRUE' } })
    expect(rejected).toMatchObject({ ok: false, error: { category: 'validation' } })
    expect(repository.list).toHaveBeenCalledTimes(1)
  })

  it('collapses malformed cursors into a safe validation issue', async () => {
    const repository = createRepository({
      list: vi.fn(async () => {
        throw new RangeError('Invalid industry cursor')
      }),
    })

    await expect(createService(repository).list({ cursor: 'opaque-but-invalid' })).resolves.toEqual({
      ok: false,
      error: {
        category: 'validation',
        issues: [{ path: ['cursor'], message: 'Cursor inválido.' }],
      },
    })
  })

  it('rejects unauthenticated callers before repository access', async () => {
    const repository = createRepository()
    const service = createService(repository, null)

    await expect(service.detail({ id: industry.id })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
    await expect(service.list({})).rejects.toBeInstanceOf(CatalogAccessError)
    expect(repository.findActiveById).not.toHaveBeenCalled()
    expect(repository.list).not.toHaveBeenCalled()
  })

  it('sanitizes unexpected repository failures into typed results', async () => {
    const internal = new Error('SQLSTATE 42P01 private schema')
    const repository = createRepository({
      findActiveById: vi.fn(async () => {
        throw internal
      }),
    })

    const result = await createService(repository).detail({ id: industry.id })
    expect(result).toEqual({ ok: false, error: { category: 'unexpected', cause: internal } })
  })
})
