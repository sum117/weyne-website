import { describe, expect, it } from 'vitest'
import {
  orderDetailSchema,
  orderIdInputSchema,
  orderListInputSchema,
} from '@/domain/orders/contracts'
import {
  createOrderReadService,
  type OrderDetailView,
  type OrderVisibilityResolver,
} from '@/domain/orders/read-service.server'
import type { OrderDetail, OrderListOutput, OrderListQuery } from '@/domain/orders/contracts'
import type { CommercialActor } from '@/lib/orders/security-policy.server'

const tenantA = '10000000-0000-4000-8000-000000000001'
const tenantB = '20000000-0000-4000-8000-000000000001'

const admin: CommercialActor = { id: 'admin-a', role: 'admin', tenantId: tenantA }
const representative: CommercialActor = {
  id: 'rep-a',
  role: 'representative',
  tenantId: tenantA,
}
const outsider: CommercialActor = { id: 'rep-b', role: 'representative', tenantId: tenantA }
const reader: CommercialActor = { id: 'reader-a', role: 'read_only', tenantId: tenantA }

const orderA = '30000000-0000-4000-8000-000000000001'
const orderB = '30000000-0000-4000-8000-000000000002'

const quoteA = '40000000-0000-4000-8000-000000000001'

function detailFixture(id: string): OrderDetail {
  return {
    id,
    number: 'PED-2026-000001',
    status: 'open',
    version: 1,
    currencyCode: 'BRL',
    sourceQuoteId: quoteA,
    sourceQuoteRevision: 3,
    client: {
      id: '50000000-0000-4000-8000-000000000001',
      legalName: 'Cliente Fictício Teste Ltda.',
      tradeName: null,
      taxIdentifier: '00000000000000',
      stateRegistration: 'ISENTO',
      email: null,
      phone: null,
      address: {
        street: 'Rua Fictícia',
        number: '123',
        complement: null,
        district: 'Centro',
        city: 'Recife',
        state: 'PE',
        postalCode: '50000000',
        countryCode: 'BR',
      },
    },
    totals: {
      grossItemsAmount: '100.000000',
      perItemDiscountAmount: '10.000000',
      netItemsAmount: '90.000000',
      generalDiscountRate: '5.000000',
      generalDiscountAmount: '4.500000',
      netAfterDiscountsAmount: '85.500000',
      ipiAmount: '8.550000',
      configuredTaxAmount: '15.390000',
      freightAmount: '10.000000',
      grandTotalAmount: '119.440000',
      commissionBasisAmount: '85.500000',
      commissionAmount: '2.565000',
    },
    lines: [
      {
        sourceQuoteLineId: '60000000-0000-4000-8000-000000000001',
        lineNumber: 1,
        product: {
          id: '70000000-0000-4000-8000-000000000001',
          industryId: '71000000-0000-4000-8000-000000000001',
          industryName: 'Indústria Teste',
          internalCode: 'TEST-001',
          manufacturerCode: null,
          description: 'Produto sintético',
          brand: null,
          category: null,
          ncm: null,
          cest: null,
          ean: null,
          dun: null,
          packaging: null,
          unit: 'UN',
        },
        quantity: '10.000000',
        unitPrice: {
          priceListId: '72000000-0000-4000-8000-000000000001',
          productPriceVersionId: '73000000-0000-4000-8000-000000000001',
          source: 'price_list',
          amount: '10.000000',
        },
        grossAmount: '100.000000',
        perItemDiscountRate: '10.000000',
        perItemDiscountAmount: '10.000000',
        netBeforeGeneralDiscountAmount: '90.000000',
        allocatedGeneralDiscountAmount: '4.500000',
        netAfterDiscountsAmount: '85.500000',
        ipiRate: '10.000000',
        ipiBasisAmount: '85.500000',
        ipiAmount: '8.550000',
        configuredTaxAmount: '15.390000',
        freightAmount: '10.000000',
        lineTotalAmount: '119.440000',
        commissionSource: 'product_override',
        commissionRate: '3.000000',
        commissionBasisAmount: '85.500000',
        commissionAmount: '2.565000',
        configuredTaxes: [
          { code: 'ICMS', rate: '18.000000', basisAmount: '85.500000', amount: '15.390000' },
        ],
      },
    ],
    audit: {
      createdAt: '2026-08-17T12:00:00.000Z',
      createdBy: 'user:conversion',
      creationReason: 'Approved quote conversion',
      updatedAt: '2026-08-17T12:00:00.000Z',
      updatedBy: 'user:conversion',
      statusChangedAt: '2026-08-17T12:00:00.000Z',
      statusChangedBy: 'user:conversion',
      statusChangeReason: 'Approved quote conversion',
    },
  }
}

class MemoryOrderStore {
  readonly details = new Map<string, OrderDetail>()
  readonly scopes = new Map<
    string,
    { tenantId: string; ownerUserId: string; assignedUserIds: string[]; status: string }
  >()
  listCalls = 0

  register(id: string, scope: Parameters<MemoryOrderStore['addScope']>[0]) {
    this.details.set(id, detailFixture(id))
    this.addScope(scope)
  }

  addScope(input: Readonly<{
    id: string
    tenantId: string
    ownerUserId: string
    assignedUserIds?: string[]
    status?: string
  }>) {
    this.scopes.set(input.id, {
      tenantId: input.tenantId,
      ownerUserId: input.ownerUserId,
      assignedUserIds: input.assignedUserIds ?? [],
      status: input.status ?? 'open',
    })
  }

  visibleIds(actor: CommercialActor): string[] {
    const result: string[] = []
    for (const [id, scope] of this.scopes) {
      if (scope.tenantId !== actor.tenantId) continue
      if (actor.role === 'admin') {
        result.push(id)
      } else if (
        scope.ownerUserId === actor.id ||
        scope.assignedUserIds.includes(actor.id)
      ) {
        result.push(id)
      }
    }
    return result.sort()
  }
}

function memoryVisibility(store: MemoryOrderStore): OrderVisibilityResolver {
  return {
    async listVisibleOrderIds(actor) {
      return store.visibleIds(actor)
    },
    async resolveResourceAccess(actor, orderId) {
      const scope = store.scopes.get(orderId)
      if (!scope || scope.tenantId !== actor.tenantId) {
        return { ok: false, error: { category: 'not-found' as const } }
      }
      if (actor.role === 'read_only') {
        if (!scope.assignedUserIds.includes(actor.id) && scope.ownerUserId !== actor.id) {
          return { ok: false, error: { category: 'not-found' as const } }
        }
        return { ok: true, data: { scope, authorization: 'allow_redacted' as const } }
      }
      if (
        actor.role === 'representative' &&
        scope.ownerUserId !== actor.id &&
        !scope.assignedUserIds.includes(actor.id)
      ) {
        return { ok: false, error: { category: 'not-found' as const } }
      }
      // Admins see every order in their tenant.
      return { ok: true, data: { scope, authorization: 'allow' as const } }
    },
  }
}

class MemoryRepository {
  constructor(private readonly store: MemoryOrderStore) {}

  async list(query: OrderListQuery, visibleOrderIds: readonly string[]): Promise<OrderListOutput> {
    this.store.listCalls += 1
    let items = [...visibleOrderIds]
      .sort()
      .map((id) => this.store.details.get(id))
      .filter((detail): detail is OrderDetail => Boolean(detail))
      .map((detail) => ({
        id: detail.id,
        number: detail.number,
        status: detail.status,
        clientId: detail.client.id,
        clientLegalName: detail.client.legalName,
        grandTotalAmount: detail.totals.grandTotalAmount,
        createdAt: detail.audit.createdAt,
      }))
    if (query.filters.number) items = items.filter((item) => item.number === query.filters.number)
    if (query.filters.status) items = items.filter((item) => item.status === query.filters.status)
    if (query.filters.clientId) {
      items = items.filter((item) => item.clientId === query.filters.clientId)
    }
    if (query.filters.sourceQuoteId) {
      items = items.filter(
        (item) =>
          this.store.details.get(item.id)?.sourceQuoteId === query.filters.sourceQuoteId,
      )
    }
    const limit = query.limit ?? 25
    const direction = query.sortDirection === 'asc' ? 1 : -1
    items = items
      .slice()
      .sort((left, right) => {
        const key =
          query.sortBy === 'createdAt'
            ? left.createdAt.localeCompare(right.createdAt)
            : query.sortBy === 'grandTotalAmount'
              ? Number(left.grandTotalAmount) - Number(right.grandTotalAmount)
              : left.number.localeCompare(right.number)
        return key !== 0
          ? key * direction
          : left.id.localeCompare(right.id) * direction
      })
    return { items: items.slice(0, limit), nextCursor: null }
  }

  async findDetailById(id: string): Promise<OrderDetail | null> {
    return this.store.details.get(id) ?? null
  }
}

function createService(store = new MemoryOrderStore()) {
  const repository = new MemoryRepository(store)
  return {
    store,
    service: createOrderReadService({
      repository: {
        list: (query, ids) => repository.list(query, ids),
        findDetailById: (id) => repository.findDetailById(id),
      },
      visibility: memoryVisibility(store),
    }),
  }
}

describe('order list request validation', () => {
  it('accepts supported filters and rejects unknown or invalid ones', () => {
    const valid = orderListInputSchema.safeParse({
      filters: {
        number: 'PED-2026-000001',
        sourceQuoteId: quoteA,
        status: 'open',
        clientId: '50000000-0000-4000-8000-000000000001',
        createdFrom: '2026-01-01',
        createdTo: '2026-12-31',
      },
      sortBy: 'createdAt',
      sortDirection: 'desc',
      limit: 50,
    })
    expect(valid.success).toBe(true)

    expect(
      orderListInputSchema.safeParse({ filters: { number: 'ORC-2026-000001' } }).success,
    ).toBe(false)
    expect(orderListInputSchema.safeParse({ filters: { status: 'shipped' } }).success).toBe(false)
    expect(
      orderListInputSchema.safeParse({ filters: { sourceQuoteId: 'not-a-uuid' } }).success,
    ).toBe(false)
    expect(orderListInputSchema.safeParse({ sortBy: 'hacker' }).success).toBe(false)
    expect(
      orderListInputSchema.safeParse({
        filters: { createdFrom: '2026-12-31', createdTo: '2026-01-01' },
      }).success,
    ).toBe(false)
    expect(orderIdInputSchema.safeParse({ id: 'nope' }).success).toBe(false)
  })
})

describe('order read service authorization', () => {
  it('lists only orders inside the caller scope and never leaks other tenants', async () => {
    const { service, store } = createService()
    store.register(orderA, { id: orderA, tenantId: tenantA, ownerUserId: representative.id })
    store.register(orderB, { id: orderB, tenantId: tenantB, ownerUserId: 'someone-else' })

    const representativePage = await service.list(representative, {})
    expect(representativePage.ok).toBe(true)
    if (representativePage.ok) {
      expect(representativePage.data.items.map((item) => item.id)).toEqual([orderA])
    }

    const outsiderPage = await service.list(outsider, {})
    expect(outsiderPage.ok).toBe(true)
    if (outsiderPage.ok) expect(outsiderPage.data.items).toEqual([])

    const crossTenantReader: CommercialActor = { ...reader, tenantId: tenantB }
    const tenantBPage = await service.list(crossTenantReader, {})
    expect(tenantBPage.ok).toBe(true)
    if (tenantBPage.ok) expect(tenantBPage.data.items).toEqual([])
  })

  it('returns the full snapshot detail for authorized representatives with quote-derived data', async () => {
    const { service, store } = createService()
    store.register(orderA, { id: orderA, tenantId: tenantA, ownerUserId: representative.id })

    const result = await service.detail(representative, { id: orderA })
    expect(result.ok).toBe(true)
    if (!result.ok || result.data.kind !== 'full') throw new Error('expected full detail')
    const view = result.data.order
    expect(view.number).toBe('PED-2026-000001')
    expect(view.sourceQuoteId).toBe(quoteA)
    // Snapshot fidelity: values come from conversion time, not live catalog.
    expect(view.lines[0]?.product.description).toBe('Produto sintético')
    expect(view.lines[0]?.unitPrice.amount).toBe('10.000000')
    expect(view.totals.grandTotalAmount).toBe('119.440000')
    expect(view.audit.createdBy).toBe('user:conversion')

    const parsed = orderDetailSchema.safeParse(view)
    expect(parsed.success).toBe(true)
  })

  it('redacts financial and audit fields for authorized read_only actors', async () => {
    const { service, store } = createService()
    store.register(orderA, {
      id: orderA,
      tenantId: tenantA,
      ownerUserId: representative.id,
      assignedUserIds: [reader.id],
    })

    const result = await service.detail(reader, { id: orderA })
    expect(result.ok).toBe(true)
    if (!result.ok || result.data.kind !== 'redacted') {
      throw new Error('expected redacted detail')
    }
    expect(result.data.order).not.toHaveProperty('totals')
    expect(result.data.order).not.toHaveProperty('lines')
    expect(result.data.order).not.toHaveProperty('audit')
    expect(result.data.order.number).toBe('PED-2026-000001')
  })

  it('reports not-found for unauthorized direct-ID access instead of forbidden leaks', async () => {
    const { service, store } = createService()
    store.register(orderA, { id: orderA, tenantId: tenantA, ownerUserId: representative.id })

    const outsiderResult = await service.detail(outsider, { id: orderA })
    expect(outsiderResult).toMatchObject({
      ok: false,
      error: { category: 'not-found' },
    })

    const crossTenantAdmin: CommercialActor = { ...admin, tenantId: tenantB }
    const foreignResult = await service.detail(crossTenantAdmin, { id: orderA })
    expect(foreignResult).toMatchObject({ ok: false, error: { category: 'not-found' } })
  })

  it('reports not-found for a genuinely missing order even for admins', async () => {
    const { service } = createService()
    const result = await service.detail(admin, { id: orderA })
    expect(result).toMatchObject({ ok: false, error: { category: 'not-found' } })
  })

  it('validates the identifier before touching the visibility resolver', async () => {
    const { service, store } = createService()
    const result = await service.detail(admin, { id: 'garbage' })
    expect(result).toMatchObject({
      ok: false,
      error: { category: 'validation' },
    })
    expect(store.listCalls).toBe(0)
  })

  it('applies list filters deterministically within the visible set', async () => {
    const { service, store } = createService()
    store.register(orderA, { id: orderA, tenantId: tenantA, ownerUserId: representative.id })
    store.register(orderB, { id: orderB, tenantId: tenantA, ownerUserId: representative.id })
    store.details.get(orderB)!.number = 'PED-2026-000002'

    const byNumber = await service.list(representative, {
      filters: { number: 'PED-2026-000002' },
    })
    expect(byNumber.ok).toBe(true)
    if (byNumber.ok) {
      expect(byNumber.data.items.map((item) => item.id)).toEqual([orderB])
    }

    const byQuote = await service.list(representative, {
      filters: { sourceQuoteId: quoteA },
    })
    expect(byNumber.ok).toBe(true)
    if (byQuote.ok) {
      expect(byQuote.data.items).toHaveLength(2)
    }

    const byStatus = await service.list(representative, {
      filters: { status: 'cancelled' },
    })
    if (byStatus.ok) expect(byStatus.data.items).toEqual([])

    // Stable sorting: default is number descending.
    const sorted = await service.list(representative, {})
    if (sorted.ok) {
      const numbers = sorted.data.items.map((item) => item.number)
      expect(numbers).toEqual([...numbers].sort().reverse())
      expect(numbers).toContain('PED-2026-000001')
    }
  })

  it('exposes a discriminated detail view contract for downstream UI', async () => {
    const { service, store } = createService()
    store.register(orderA, {
      id: orderA,
      tenantId: tenantA,
      ownerUserId: representative.id,
      assignedUserIds: [reader.id],
    })
    const full = await service.detail(representative, { id: orderA })
    const redacted = await service.detail(reader, { id: orderA })
    const kinds: OrderDetailView['kind'][] = []
    if (full.ok) kinds.push(full.data.kind)
    if (redacted.ok) kinds.push(redacted.data.kind)
    expect(kinds).toEqual(['full', 'redacted'])
  })
})
