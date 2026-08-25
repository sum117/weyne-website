import { randomUUID } from 'node:crypto'
import { and, sql, type SQL } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  salesDatePredicate,
  orderStatusPredicate,
  representativePredicate,
  clientPredicate,
  productPredicate,
  industryPredicate,
  commissionEligiblePredicate,
} from '@/lib/analytics/predicates.server'
import {
  analyticsVisibilityPredicate,
  commissionVisiblePredicate,
} from '@/lib/analytics/visibility.server'
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

let harness: PostgresTestHarness
let quoteSequence = 0

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'analytics_contracts',
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

const TENANT = '10000000-0000-4000-8000-000000000001'
const OWNER_A = 'rep-analytics-a'
const OWNER_B = 'rep-analytics-b'

function snapshotFixture(sourceQuoteId = randomUUID()): NewOrderSnapshot {
  return {
    sourceQuoteId,
    sourceQuoteRevision: 1,
    client: {
      id: randomUUID(),
      legalName: 'Cliente Analytics Teste Ltda.',
      tradeName: null,
      taxIdentifier: '00000000000000',
      stateRegistration: null,
      email: null,
      phone: null,
      address: {
        street: 'Rua Teste',
        number: '1',
        complement: null,
        district: 'Centro',
        city: 'Fortaleza',
        state: 'CE',
        postalCode: '60000000',
        countryCode: 'BR',
      },
    },
    currencyCode: 'BRL',
    totals: {
      grossItemsAmount: '100.000000',
      perItemDiscountAmount: '0.000000',
      netItemsAmount: '100.000000',
      generalDiscountRate: '0.000000',
      generalDiscountAmount: '0.000000',
      netAfterDiscountsAmount: '100.000000',
      ipiAmount: '0.000000',
      configuredTaxAmount: '0.000000',
      freightAmount: '0.000000',
      grandTotalAmount: '100.000000',
      commissionBasisAmount: '100.000000',
      commissionAmount: '3.000000',
    },
    lines: [
      {
        sourceQuoteLineId: randomUUID(),
        lineNumber: 1,
        product: {
          id: randomUUID(),
          internalCode: 'TEST-ANALYTICS',
          manufacturerCode: null,
          description: 'Produto Analytics',
          industryId: '11111111-1111-4111-8111-111111111111',
          industryName: 'Indústria Analytics',
          brand: null,
          category: null,
          ncm: null,
          cest: null,
          ean: null,
          dun: null,
          packaging: null,
          unit: 'UN',
        },
        quantity: '1.000000',
        unitPrice: {
          priceListId: randomUUID(),
          productPriceVersionId: randomUUID(),
          source: 'price_list',
          amount: '100.000000',
        },
        grossAmount: '100.000000',
        perItemDiscountRate: '0.000000',
        perItemDiscountAmount: '0.000000',
        netBeforeGeneralDiscountAmount: '100.000000',
        allocatedGeneralDiscountAmount: '0.000000',
        netAfterDiscountsAmount: '100.000000',
        ipiRate: '0.000000',
        ipiBasisAmount: '100.000000',
        ipiAmount: '0.000000',
        configuredTaxAmount: '0.000000',
        freightAmount: '0.000000',
        lineTotalAmount: '100.000000',
        commissionSource: 'product_override',
        commissionRate: '3.000000',
        commissionBasisAmount: '100.000000',
        commissionAmount: '3.000000',
        configuredTaxes: [],
      },
    ],
  }
}

async function seedOrder(input: {
  occurredAt: string
  ownerUserId: string
}): Promise<string> {
  quoteSequence += 1
  const quoteId = randomUUID()
  await harness.sql`
    INSERT INTO quotes (
      id, quote_number, owner_user_id, status, valid_until,
      customer_snapshot, commercial_snapshot
    ) VALUES (
      ${quoteId}, ${`ORC-2026-${String(quoteSequence).padStart(6, '0')}`},
      ${input.ownerUserId}, 'converted', '2026-12-31', '{}'::jsonb, '{}'::jsonb
    )
  `
  const repository = createPostgresOrderRepository(harness.database)
  const created = await repository.transaction((transaction) =>
    transaction.createOrder(snapshotFixture(quoteId), {
      actor: `user:${input.ownerUserId}`,
      reason: 'Approved quote conversion',
      occurredAt: new Date(input.occurredAt),
    }),
  )
  await harness.sql`
    INSERT INTO commercial_resource_scopes (resource_type, resource_id, tenant_id, owner_user_id, resource_status)
    VALUES ('order', ${created.id}::uuid, ${TENANT}::uuid, ${input.ownerUserId}, 'open')
  `
  return created.id
}

async function countMatching(predicate: SQL): Promise<number> {
  const rows = await harness.database.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM orders JOIN quotes q ON q.id = orders.source_quote_id WHERE ${predicate}`,
  )
  return Number((rows as unknown as { count: string }[])[0]?.count ?? '0')
}

async function countMatchingAlias(predicate: SQL): Promise<number> {
  const rows = await harness.database.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM orders o JOIN quotes q ON q.id = o.source_quote_id WHERE ${predicate}`,
  )
  return Number((rows as unknown as { count: string }[])[0]?.count ?? '0')
}

describe('analytics predicates on PostgreSQL', () => {
  it('sales date predicate is a half-open window that includes edges exactly', async () => {
    // 2026-07-01T02:59:59.999Z is 2026-06-30 in Fortaleza (UTC-3) → excluded.
    // 2026-07-01T03:00:00.000Z is local midnight of 2026-07-01 → included.
    // 2026-07-02T02:59:59.999Z is the last instant of 2026-07-01 → included.
    // 2026-07-02T03:00:00.000Z is the exclusive upper edge → excluded.
    await seedOrder({ occurredAt: '2026-07-01T02:59:59.999Z', ownerUserId: OWNER_A })
    const firstEdge = await seedOrder({
      occurredAt: '2026-07-01T03:00:00.000Z',
      ownerUserId: OWNER_A,
    })
    const lastInstant = await seedOrder({
      occurredAt: '2026-07-01T23:59:59.999Z',
      ownerUserId: OWNER_A,
    })
    await seedOrder({ occurredAt: '2026-07-02T03:00:00.000Z', ownerUserId: OWNER_A })

    const ids = new Set<string>()
    const rows = await harness.database.execute<{ id: string }>(
      sql`SELECT orders.id::text AS id FROM orders WHERE ${salesDatePredicate({
        from: '2026-07-01',
        to: '2026-07-01',
        timeZone: 'America/Fortaleza',
      })}`,
    )
    for (const row of rows as unknown as { id: string }[]) ids.add(row.id)
    expect([...ids].sort()).toEqual([firstEdge, lastInstant].sort())
  })

  it('status predicate defaults to included statuses and rejects cancelled', async () => {
    await seedOrder({ occurredAt: '2026-07-10T12:00:00.000Z', ownerUserId: OWNER_A })
    const cancelled = await seedOrder({ occurredAt: '2026-07-10T12:00:00.000Z', ownerUserId: OWNER_A })
    await harness.sql`UPDATE orders SET status = 'cancelled', status_change_reason = 'test' WHERE id = ${cancelled}::uuid`

    expect(await countMatching(orderStatusPredicate())).toBe(1)
    expect(() => orderStatusPredicate(['cancelled'])).toThrow(TypeError)
    expect(() => orderStatusPredicate(['bogus' as never])).toThrow(TypeError)
  })

  it('representative predicate attributes via quotes.owner_user_id', async () => {
    await seedOrder({ occurredAt: '2026-07-10T12:00:00.000Z', ownerUserId: OWNER_A })
    await seedOrder({ occurredAt: '2026-07-10T12:00:00.000Z', ownerUserId: OWNER_A })
    await seedOrder({ occurredAt: '2026-07-10T12:00:00.000Z', ownerUserId: OWNER_B })

    expect(await countMatching(representativePredicate([OWNER_A]))).toBe(2)
    expect(await countMatching(representativePredicate([OWNER_A, OWNER_B]))).toBe(3)
    expect(await countMatching(representativePredicate([]))).toBe(0)
  })

  it('client, product, and industry predicates parameterize over snapshots', async () => {
    const orderId = await seedOrder({
      occurredAt: '2026-07-10T12:00:00.000Z',
      ownerUserId: OWNER_A,
    })
    const [row] = await harness.sql<{ clientId: string; productId: string; industryId: string }[]>`
      SELECT client_id::text AS "clientId", ol.product_id::text AS "productId",
             ol.product_industry_id::text AS "industryId"
      FROM orders o JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.id = ${orderId}::uuid
    `
    expect(await countMatching(clientPredicate([row!.clientId]))).toBe(1)
    expect(await countMatching(clientPredicate([]))).toBe(1)

    // Line-level predicates require the caller to join order_lines.
    const lineCount = async (predicate: SQL): Promise<number> => {
      const rows = await harness.database.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM order_lines WHERE ${predicate}`,
      )
      return Number((rows as unknown as { count: string }[])[0]?.count ?? '0')
    }
    expect(await lineCount(productPredicate([row!.productId]))).toBe(1)
    expect(await lineCount(industryPredicate([row!.industryId]))).toBe(1)
  })

  it('commission eligibility predicate selects the projected amount', async () => {
    const eligible = await seedOrder({
      occurredAt: '2026-07-10T12:00:00.000Z',
      ownerUserId: OWNER_A,
    })
    // Order lines are append-only by trigger, so an order with no eligible
    // lines is created by inserting a second order whose snapshot already
    // carries commission source 'none' and amount zero.
    const ineligibleQuoteId = randomUUID()
    quoteSequence += 1
    await harness.sql`
      INSERT INTO quotes (
        id, quote_number, owner_user_id, status, valid_until,
        customer_snapshot, commercial_snapshot
      ) VALUES (
        ${ineligibleQuoteId}, ${`ORC-2026-${String(quoteSequence).padStart(6, '0')}`},
        ${OWNER_A}, 'converted', '2026-12-31', '{}'::jsonb, '{}'::jsonb
      )
    `
    const repository = createPostgresOrderRepository(harness.database)
    const base = snapshotFixture(ineligibleQuoteId)
    const line = base.lines[0]!
    await repository.transaction((transaction) =>
      transaction.createOrder(
        {
          ...base,
          totals: { ...base.totals, commissionBasisAmount: '0.000000', commissionAmount: '0.000000' },
          lines: [
            {
              ...line,
              grossAmount: '0.000000',
              perItemDiscountAmount: '0.000000',
              netBeforeGeneralDiscountAmount: '0.000000',
              allocatedGeneralDiscountAmount: '0.000000',
              netAfterDiscountsAmount: '0.000000',
              ipiBasisAmount: '0.000000',
              ipiAmount: '0.000000',
              configuredTaxAmount: '0.000000',
              freightAmount: '0.000000',
              lineTotalAmount: '0.000000',
              unitPrice: { ...line.unitPrice, amount: '0.000000' },
              commissionSource: 'none',
              commissionRate: null,
              commissionBasisAmount: '0.000000',
              commissionAmount: '0.000000',
            },
          ],
        },
        {
          actor: `user:${OWNER_A}`,
          reason: 'Approved quote conversion',
          occurredAt: new Date('2026-07-10T12:00:00.000Z'),
        },
      ),
    )

    expect(await countMatching(commissionEligiblePredicate())).toBe(1)
    expect(
      await countMatching(and(commissionEligiblePredicate(), orderStatusPredicate())!),
    ).toBe(1)
    void eligible
  })
})

describe('analytics RBAC visibility on PostgreSQL', () => {
  it('admin sees the tenant, representative sees own, read_only sees only assigned', async () => {
    await seedOrder({ occurredAt: '2026-07-10T12:00:00.000Z', ownerUserId: OWNER_A })
    const other = await seedOrder({ occurredAt: '2026-07-10T12:00:00.000Z', ownerUserId: OWNER_B })

    const admin = { id: 'user:admin', role: 'admin' as const, tenantId: TENANT }
    const representative = { id: OWNER_A, role: 'representative' as const, tenantId: TENANT }
    const reader = { id: 'user:reader', role: 'read_only' as const, tenantId: TENANT }

    expect(await countMatchingAlias(analyticsVisibilityPredicate({ actor: admin }))).toBe(2)
    expect(await countMatchingAlias(analyticsVisibilityPredicate({ actor: representative }))).toBe(1)

    // read_only with no assignment sees nothing; with an assignment sees one.
    expect(await countMatchingAlias(analyticsVisibilityPredicate({ actor: reader }))).toBe(0)
    await harness.sql`
      INSERT INTO commercial_resource_assignments (resource_type, resource_id, user_id)
      VALUES ('order', ${other}::uuid, ${reader.id})
    `
    expect(await countMatchingAlias(analyticsVisibilityPredicate({ actor: reader }))).toBe(1)

    // Commission visibility denies read_only outright even when assigned.
    expect(await countMatchingAlias(commissionVisiblePredicate({ actor: reader }))).toBe(0)
    expect(await countMatchingAlias(commissionVisiblePredicate({ actor: representative }))).toBe(1)
  })

  it('tenant isolation is unconditional, even for admins', async () => {
    await seedOrder({ occurredAt: '2026-07-10T12:00:00.000Z', ownerUserId: OWNER_A })
    const foreignTenant = '20000000-0000-4000-8000-000000000001'
    const foreignAdmin = { id: 'user:foreign-admin', role: 'admin' as const, tenantId: foreignTenant }
    expect(await countMatchingAlias(analyticsVisibilityPredicate({ actor: foreignAdmin }))).toBe(0)
  })

  it('an actor without a tenant fails closed', async () => {
    await seedOrder({ occurredAt: '2026-07-10T12:00:00.000Z', ownerUserId: OWNER_A })
    const tenantless = { id: 'user:x', role: 'admin' as const, tenantId: '' }
    expect(await countMatchingAlias(analyticsVisibilityPredicate({ actor: tenantless }))).toBe(0)
  })

  it('rejects hostile order aliases before any identifier interpolation', async () => {
    const admin = { id: 'user:admin', role: 'admin' as const, tenantId: TENANT }
    for (const alias of ['o; DROP TABLE orders', 'o"--', 'orders o CROSS JOIN x']) {
      expect(() =>
        analyticsVisibilityPredicate({ actor: admin, orderAlias: alias }),
      ).toThrow(RangeError)
    }
    // A valid custom alias interpolates correctly when the caller's query
    // actually names the orders table with it.
    await seedOrder({ occurredAt: '2026-07-10T12:00:00.000Z', ownerUserId: OWNER_A })
    const rows = await harness.database.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM orders AS custom_orders_alias
          JOIN quotes q ON q.id = custom_orders_alias.source_quote_id
          WHERE ${analyticsVisibilityPredicate({
            actor: admin,
            orderAlias: 'custom_orders_alias',
          })}`,
    )
    expect(Number((rows as unknown as { count: string }[])[0]?.count ?? '0')).toBe(1)
  })
})
