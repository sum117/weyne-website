import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPostgresOrderReadRepository } from '@/domain/orders/read-repository.server'
import { createPostgresOrderVisibilityResolver } from '@/domain/orders/read-visibility.server'
import type { OrderListQuery } from '@/domain/orders/contracts'
import {
  createPostgresOrderRepository,
  type NewOrderSnapshot,
} from '@/lib/orders/repository.server'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const tenantA = '10000000-0000-4000-8000-000000000001'
const tenantB = '20000000-0000-4000-8000-000000000001'

let harness: PostgresTestHarness
let quoteSequence = 0

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'order_read',
    migrationNames: [
      '0002_quote_persistence.sql',
      '0004_order_persistence.sql',
      '0004_carriers.sql',
      '0007_carrier_order_reference.sql',
      '0010_order_line_commission_facts.sql',
      '0090_order_security.sql',
    ],
  })
})

beforeEach(async () => {
  await harness.reset()
  quoteSequence = 0
})

afterAll(async () => {
  await harness?.close()
})

function snapshotFixture(sourceQuoteId = randomUUID()): NewOrderSnapshot {
  return {
    sourceQuoteId,
    sourceQuoteRevision: 3,
    client: {
      id: randomUUID(),
      legalName: 'Cliente Fictício Teste Ltda.',
      tradeName: null,
      taxIdentifier: '00000000000000',
      stateRegistration: null,
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
    currencyCode: 'BRL',
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
        sourceQuoteLineId: randomUUID(),
        lineNumber: 1,
        product: {
          id: randomUUID(),
          industryId: randomUUID(),
          industryName: 'Indústria Teste',
          internalCode: 'TEST-001',
          manufacturerCode: null,
          description: 'Produto sintético para leitura',
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
          priceListId: randomUUID(),
          productPriceVersionId: randomUUID(),
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
  }
}

async function seedOrder(
  snapshot: NewOrderSnapshot,
  scope: { tenantId: string; ownerUserId: string; assignedUserIds?: string[] },
): Promise<string> {
  quoteSequence += 1
  const quoteNumber = `ORC-2026-${String(quoteSequence).padStart(6, '0')}`
  await harness.sql`
    INSERT INTO quotes (
      id, quote_number, owner_user_id, status, valid_until, version,
      customer_snapshot, commercial_snapshot
    ) VALUES (
      ${snapshot.sourceQuoteId}, ${quoteNumber},
      'seed', 'approved', '2026-12-31', 3, '{}'::jsonb, '{}'::jsonb
    )
  `
  const repository = createPostgresOrderRepository(harness.database)
  const created = await repository.transaction((transaction) =>
    transaction.createOrder(snapshot, {
      actor: `user:${scope.ownerUserId}`,
      reason: 'Approved quote conversion',
      occurredAt: new Date('2026-08-17T12:00:00.000Z'),
    }),
  )
  await harness.sql`
    INSERT INTO commercial_resource_scopes (resource_type, resource_id, tenant_id, owner_user_id, resource_status)
    VALUES ('order', ${created.id}::uuid, ${scope.tenantId}::uuid, ${scope.ownerUserId}, 'open')
    ON CONFLICT (resource_type, resource_id) DO NOTHING
  `
  for (const userId of scope.assignedUserIds ?? []) {
    await harness.sql`
      INSERT INTO commercial_resource_assignments (resource_type, resource_id, user_id)
      VALUES ('order', ${created.id}::uuid, ${userId})
    `
  }
  return created.id
}

function emptyQuery(overrides: Partial<OrderListQuery> = {}): OrderListQuery {
  return {
    cursor: undefined,
    limit: 25,
    filters: {},
    sortBy: 'number',
    sortDirection: 'desc',
    ...overrides,
  } as OrderListQuery
}

describe('order read repository and visibility on PostgreSQL', () => {
  it('lists only scoped orders with deterministic ordering, filtering, and keyset pagination', async () => {
    const representative = { id: 'rep-a', role: 'representative' as const, tenantId: tenantA }
    const first = await seedOrder(snapshotFixture(), {
      tenantId: tenantA,
      ownerUserId: representative.id,
    })
    const second = await seedOrder(snapshotFixture(), {
      tenantId: tenantA,
      ownerUserId: representative.id,
    })
    // Out of scope: other tenant and unassigned representative.
    await seedOrder(snapshotFixture(), { tenantId: tenantB, ownerUserId: 'other-owner' })
    await seedOrder(snapshotFixture(), { tenantId: tenantA, ownerUserId: 'another-rep' })

    const database = harness.database
    const repository = createPostgresOrderReadRepository(database)
    const visibility = createPostgresOrderVisibilityResolver(database)

    const visible = await visibility.listVisibleOrderIds(representative)
    expect([...visible].sort()).toEqual([first, second].sort())

    const page = await repository.list(emptyQuery(), visible)
    expect(page.items.map((item) => item.id).sort()).toEqual([first, second].sort())
    expect(page.nextCursor).toBeNull()

    const byNumber = await repository.list(
      emptyQuery({ filters: { number: 'PED-2026-000001' } }),
      visible,
    )
    expect(byNumber.items).toHaveLength(1)

    const byStatus = await repository.list(
      emptyQuery({ filters: { status: 'cancelled' } }),
      visible,
    )
    expect(byStatus.items).toEqual([])

    // Keyset pagination across two pages of three orders.
    const extra = await seedOrder(snapshotFixture(), {
      tenantId: tenantA,
      ownerUserId: representative.id,
    })
    const allVisible = [...visible, extra]
    const pageOne = await repository.list(emptyQuery({ limit: 2 }), allVisible)
    expect(pageOne.items).toHaveLength(2)
    expect(pageOne.nextCursor).toBeTypeOf('string')
    const pageTwo = await repository.list(
      emptyQuery({
        limit: 2,
        cursor: pageOne.nextCursor ?? undefined,
      }),
      allVisible,
    )
    const seen = [...pageOne.items, ...pageTwo.items].map((item) => item.id)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.sort()).toEqual(allVisible.slice().sort())

    // Empty allowlist short-circuits without touching orders.
    const emptyPage = await repository.list(emptyQuery(), [])
    expect(emptyPage).toEqual({ items: [], nextCursor: null })
  })

  it('returns immutable snapshot detail with taxes and reports missing rows', async () => {
    const sourceQuoteId = randomUUID()
    const orderId = await seedOrder(snapshotFixture(sourceQuoteId), {
      tenantId: tenantA,
      ownerUserId: 'rep-a',
    })

    const repository = createPostgresOrderReadRepository(harness.database)
    const detail = await repository.findDetailById(orderId)
    expect(detail).not.toBeNull()
    if (!detail) throw new Error('expected detail')
    expect(detail.number).toMatch(/^PED-\d{4}-\d{6}$/)
    expect(detail.sourceQuoteId).toBe(sourceQuoteId)
    expect(detail.client.legalName).toBe('Cliente Fictício Teste Ltda.')
    expect(detail.lines).toHaveLength(1)
    expect(detail.lines[0]?.configuredTaxes.map((tax) => tax.code)).toEqual(['ICMS'])
    expect(detail.totals.grandTotalAmount).toBe('119.440000')

    // Snapshots are frozen — callers cannot mutate returned data.
    expect(Object.isFrozen(detail)).toBe(true)
    expect(Object.isFrozen(detail.lines[0])).toBe(true)
    expect(() => {
      (detail.totals as unknown as Record<string, string>).grandTotalAmount = '0'
    }).toThrow()

    expect(await repository.findDetailById(randomUUID())).toBeNull()
  })

  it('resolves direct-ID access through the security tables, denying outsiders', async () => {
    const assignedReader = { id: 'reader-a', role: 'read_only' as const, tenantId: tenantA }
    const outsider = { id: 'rep-b', role: 'representative' as const, tenantId: tenantA }
    const foreignAdmin = { id: 'admin-b', role: 'admin' as const, tenantId: tenantB }

    const orderId = await seedOrder(snapshotFixture(), {
      tenantId: tenantA,
      ownerUserId: 'rep-a',
      assignedUserIds: [assignedReader.id],
    })

    const visibility = createPostgresOrderVisibilityResolver(harness.database)

    const readerAccess = await visibility.resolveResourceAccess(assignedReader, orderId)
    expect(readerAccess.ok).toBe(true)
    if (readerAccess.ok) expect(readerAccess.data.authorization).toBe('allow_redacted')

    expect(await visibility.resolveResourceAccess(outsider, orderId)).toMatchObject({
      ok: false,
      error: { category: 'not-found' },
    })
    expect(await visibility.resolveResourceAccess(foreignAdmin, orderId)).toMatchObject({
      ok: false,
      error: { category: 'not-found' },
    })
    expect(
      await visibility.resolveResourceAccess(assignedReader, randomUUID()),
    ).toMatchObject({ ok: false, error: { category: 'not-found' } })

    const owner = { id: 'rep-a', role: 'representative' as const, tenantId: tenantA }
    const ownerAccess = await visibility.resolveResourceAccess(owner, orderId)
    expect(ownerAccess.ok).toBe(true)
    if (ownerAccess.ok) expect(ownerAccess.data.authorization).toBe('allow')

    const admin = { id: 'any-admin', role: 'admin' as const, tenantId: tenantA }
    const adminAccess = await visibility.resolveResourceAccess(admin, orderId)
    expect(adminAccess.ok).toBe(true)
    if (adminAccess.ok) expect(adminAccess.data.authorization).toBe('allow')
  })
})
