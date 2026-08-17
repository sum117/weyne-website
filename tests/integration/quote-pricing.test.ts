import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { persistServerPricedQuote } from '@/features/app/quotes/quote-pricing.server'
import {
  customers,
  industries,
  priceLists,
  productPrices,
  products,
  quotePricingSnapshotLines,
  quotePricingSnapshots,
} from '@/lib/db/schema'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

let harness: PostgresTestHarness

const ids = {
  customer: '10000000-0000-4000-8000-000000000001',
  industry: '10000000-0000-4000-8000-000000000002',
  productA: '10000000-0000-4000-8000-000000000003',
  productB: '10000000-0000-4000-8000-000000000004',
  productC: '10000000-0000-4000-8000-000000000005',
  lineA: '10000000-0000-4000-8000-000000000006',
  lineB: '10000000-0000-4000-8000-000000000007',
  lineC: '10000000-0000-4000-8000-000000000008',
} as const
const priceListId = '00000000-0000-4000-8000-000000000002'

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'quote_pricing',
    migrationNames: [
      '0001_catalog_pricing.sql',
      '0003_server_quote_pricing.sql',
      '0008_industries.sql',
    ],
  })
})

beforeEach(async () => {
  await harness.reset()
  await seedScenario()
})

afterAll(async () => {
  await harness?.close()
})

describe('server-authoritative quote pricing on PostgreSQL', () => {
  it('prices seeded customer/master data and persists every independently expected amount', async () => {
    // Reusable deterministic scenario (all expectations are hand-calculated):
    // PRICE_2; A 3 × 10.005 less 5%; B 2.5 × 19.99 less 10%; C 1 × 25.
    // General discount 7.5% allocates 2.14 / 3.37 / 1.88 by largest remainder.
    // Informational taxes: A IPI 5.125%=1.35 + ICMS 18%=4.75;
    // B IPI 2%=0.83 + ICMS 12%=4.99. Freight 12.345 rounds to 12.35.
    const result = await persistServerPricedQuote(harness.database, request({
      grossItemsAmount: '0.01',
      grandTotalAmount: '999999.99',
    }))

    expect(result.totals).toEqual({
      grossItemsAmount: '105.00',
      perItemDiscountAmount: '6.50',
      netItemsAmount: '98.50',
      generalDiscountAmount: '7.39',
      netAfterDiscountsAmount: '91.11',
      ipiAmount: '2.18',
      configuredTaxAmount: '9.74',
      freightAmount: '12.35',
      grandTotalAmount: '103.46',
      commissionBasisAmount: '91.11',
      commissionAmount: '0.00',
    })

    const persistedHeader = await harness.database
      .select()
      .from(quotePricingSnapshots)
      .where(eq(quotePricingSnapshots.id, result.id))
    expect(persistedHeader).toHaveLength(1)
    expect(persistedHeader[0]).toMatchObject({
      customerId: ids.customer,
      priceListId,
      grossItemsAmount: '105.00',
      lineDiscountAmount: '6.50',
      generalDiscountAmount: '7.39',
      freightAmount: '12.35',
      grandTotalAmount: '103.46',
    })

    const persistedLines = await harness.database
      .select()
      .from(quotePricingSnapshotLines)
      .where(eq(quotePricingSnapshotLines.quotePricingSnapshotId, result.id))
      .orderBy(quotePricingSnapshotLines.lineId)
    expect(persistedLines.map((line) => ({
      lineId: line.lineId,
      unitPrice: line.unitPrice,
      gross: line.grossAmount,
      lineDiscount: line.lineDiscountAmount,
      generalDiscount: line.generalDiscountAmount,
      merchandise: line.netMerchandiseAmount,
      ipi: line.ipiAmount,
      taxes: line.configuredTaxes,
      configuredTax: line.configuredTaxAmount,
    }))).toEqual([
      { lineId: ids.lineA, unitPrice: '10.005000', gross: '30.02', lineDiscount: '1.50', generalDiscount: '2.14', merchandise: '26.38', ipi: '1.35', taxes: [{ code: 'icms', rate: '18.000000', basisAmount: '26.38', amount: '4.75' }], configuredTax: '4.75' },
      { lineId: ids.lineB, unitPrice: '19.990000', gross: '49.98', lineDiscount: '5.00', generalDiscount: '3.37', merchandise: '41.61', ipi: '0.83', taxes: [{ code: 'icms', rate: '12.000000', basisAmount: '41.61', amount: '4.99' }], configuredTax: '4.99' },
      { lineId: ids.lineC, unitPrice: '25.000000', gross: '25.00', lineDiscount: '0.00', generalDiscount: '1.88', merchandise: '23.12', ipi: '0.00', taxes: [], configuredTax: '0.00' },
    ])
  })

  it('recomputes tampered client totals instead of persisting them', async () => {
    const result = await persistServerPricedQuote(harness.database, request({
      grossItemsAmount: '-1000000.00',
      grandTotalAmount: '0.00',
    }))

    expect(result.totals.grandTotalAmount).toBe('103.46')
    const [row] = await harness.database
      .select({ grandTotalAmount: quotePricingSnapshots.grandTotalAmount })
      .from(quotePricingSnapshots)
      .where(eq(quotePricingSnapshots.id, result.id))
    expect(row?.grandTotalAmount).toBe('103.46')
  })
})

function request(clientTotals: Record<string, string>) {
  return {
    customerId: ids.customer,
    priceListId,
    generalDiscountRate: '7.5',
    freightAmount: '12.345',
    clientTotals,
    lines: [
      { lineId: ids.lineA, productId: ids.productA, quantity: '3', lineDiscountRate: '5' },
      { lineId: ids.lineB, productId: ids.productB, quantity: '2.5', lineDiscountRate: '10' },
      { lineId: ids.lineC, productId: ids.productC, quantity: '1', lineDiscountRate: '0' },
    ],
  }
}

async function seedScenario() {
  const database = harness.database
  await database.insert(customers).values({
    id: ids.customer,
    legalName: 'CLIENTE FICTÍCIO PARA TESTE DE ORÇAMENTO',
    taxIdentifier: 'TEST-CNPJ-QUOTE-0001',
  })
  await database.insert(industries).values({
    id: ids.industry,
    legalName: 'INDÚSTRIA FICTÍCIA PARA TESTE DE ORÇAMENTO',
  })
  await database.insert(products).values([
    product(ids.productA, 'QUOTE-A', 'Produto sintético A', '5.125000', '18.000000'),
    product(ids.productB, 'QUOTE-B', 'Produto sintético B', '2.000000', '12.000000'),
    product(ids.productC, 'QUOTE-C', 'Produto sintético C', '0.000000', null),
  ])
  await database.execute(sql`SELECT set_config('app.actor', 'quote-integration-test', false)`)
  await database.execute(sql`SELECT set_config('app.price_change_reason', 'deterministic quote seed', false)`)
  await database.insert(productPrices).values([
    price(ids.productA, '10.005000'),
    price(ids.productB, '19.990000'),
    price(ids.productC, '25.000000'),
  ])

  const selectedList = await database
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(eq(priceLists.id, priceListId))
  expect(selectedList).toEqual([{ id: priceListId }])
}

function product(id: string, internalCode: string, description: string, ipiRate: string, icmsRate: string | null) {
  return {
    id,
    industryId: ids.industry,
    internalCode,
    description,
    unit: 'UN',
    ipiRate,
    icmsRate,
    createdBy: 'quote-integration-test',
    updatedBy: 'quote-integration-test',
  }
}

function price(productId: string, amount: string) {
  return {
    productId,
    priceListId,
    amount,
    updatedBy: 'quote-integration-test',
  }
}
