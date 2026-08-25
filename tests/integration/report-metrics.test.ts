import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadPostgresReportMetrics } from '@/features/app/reports/report-metrics.server'
import {
  createPostgresOrderRepository,
  type NewOrderSnapshot,
  type PersistedOrder,
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
  harness = await createPostgresTestHarness({ schemaPrefix: 'report_metrics' })
})

beforeEach(async () => {
  await harness.reset()
  quoteSequence = 0
})

afterAll(async () => {
  await harness?.close()
})

async function sourceQuote(owner: string): Promise<string> {
  const id = randomUUID()
  await harness.sql`
    INSERT INTO quotes (
      id, quote_number, owner_user_id, status, valid_until,
      customer_snapshot, commercial_snapshot
    ) VALUES (
      ${id}, ${`ORC-2026-${String(++quoteSequence).padStart(6, '0')}`}, ${owner},
      'converted', '2026-12-31', '{}'::jsonb, '{}'::jsonb
    )
  `
  return id
}

function snapshot(input: {
  sourceQuoteId: string
  clientId: string
  clientName: string
  total: string
  commission: string
  productId?: string
  productName?: string
  industryId?: string
  industryName?: string
}): NewOrderSnapshot {
  const productId = input.productId ?? randomUUID()
  return {
    sourceQuoteId: input.sourceQuoteId,
    sourceQuoteRevision: 1,
    client: {
      id: input.clientId,
      legalName: input.clientName,
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
      grossItemsAmount: input.total,
      perItemDiscountAmount: '0.000000',
      netItemsAmount: input.total,
      generalDiscountRate: '0.000000',
      generalDiscountAmount: '0.000000',
      netAfterDiscountsAmount: input.total,
      ipiAmount: '0.000000',
      configuredTaxAmount: '0.000000',
      freightAmount: '0.000000',
      grandTotalAmount: input.total,
      commissionBasisAmount: input.total,
      commissionAmount: input.commission,
    },
    lines: [
      {
        sourceQuoteLineId: randomUUID(),
        lineNumber: 1,
        product: {
          id: productId,
          internalCode: `TEST-${productId.slice(0, 6)}`,
          manufacturerCode: null,
          description: input.productName ?? 'Produto Teste',
          industryId: input.industryId ?? '11111111-1111-4111-8111-111111111111',
          industryName: input.industryName ?? 'Indústria Teste',
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
          amount: input.total,
        },
        grossAmount: input.total,
        perItemDiscountRate: '0.000000',
        perItemDiscountAmount: '0.000000',
        netBeforeGeneralDiscountAmount: input.total,
        allocatedGeneralDiscountAmount: '0.000000',
        netAfterDiscountsAmount: input.total,
        ipiRate: '0.000000',
        ipiBasisAmount: input.total,
        ipiAmount: '0.000000',
        configuredTaxAmount: '0.000000',
        freightAmount: '0.000000',
        lineTotalAmount: input.total,
        commissionSource: 'product_override',
        commissionRate: '5.000000',
        commissionBasisAmount: input.total,
        commissionAmount: input.commission,
        configuredTaxes: [],
      },
    ],
  }
}

async function createOrder(input: {
  owner: string
  clientId: string
  clientName: string
  occurredAt: string
  total: string
  commission: string
  status?: 'open' | 'invoiced' | 'completed' | 'cancelled'
  industryId?: string
  industryName?: string
}): Promise<PersistedOrder> {
  const repository = createPostgresOrderRepository(harness.database)
  const quoteId = await sourceQuote(input.owner)
  return repository.transaction(async (transaction) => {
    const created = await transaction.createOrder(
      snapshot({
        sourceQuoteId: quoteId,
        clientId: input.clientId,
        clientName: input.clientName,
        total: input.total,
        commission: input.commission,
        industryId: input.industryId,
        industryName: input.industryName,
      }),
      {
        actor: input.owner,
        reason: 'Fixture de reconciliação',
        occurredAt: new Date(input.occurredAt),
      },
    )
    return input.status && input.status !== 'open'
      ? transaction.transitionState({
          orderId: created.id,
          expectedVersion: 1n,
          toStatus: input.status,
          actor: input.owner,
          reason: 'Fixture de status',
          occurredAt: new Date(input.occurredAt),
        })
      : created
  })
}

describe('PostgreSQL report metric boundary', () => {
  it('reconciles one source-order fixture across dashboard and report projections', async () => {
    const alpha = randomUUID()
    const beta = randomUUID()
    const dormant = randomUUID()
    const industryA = randomUUID()
    const industryB = randomUUID()

    await createOrder({
      owner: 'rep-1', clientId: dormant, clientName: 'Cliente Dormente',
      occurredAt: '2026-05-01T12:00:00.000Z', total: '50.000000', commission: '2.500000',
    })
    await createOrder({
      owner: 'rep-1', clientId: alpha, clientName: 'Cliente Alpha',
      occurredAt: '2026-07-01T03:00:00.000Z', total: '100.005000', commission: '5.005000',
      industryId: industryA, industryName: 'Indústria A',
    })
    await createOrder({
      owner: 'rep-1', clientId: alpha, clientName: 'Cliente Alpha',
      occurredAt: '2026-07-15T15:00:00.000Z', total: '200.005000', commission: '10.005000',
      status: 'invoiced', industryId: industryA, industryName: 'Indústria A',
    })
    await createOrder({
      owner: 'rep-2', clientId: beta, clientName: 'Cliente Beta',
      occurredAt: '2026-08-01T02:59:59.999Z', total: '300.005000', commission: '15.005000',
      status: 'completed', industryId: industryB, industryName: 'Indústria B',
    })
    await createOrder({
      owner: 'rep-1', clientId: alpha, clientName: 'Cliente Alpha',
      occurredAt: '2026-07-20T12:00:00.000Z', total: '999.000000', commission: '99.000000',
      status: 'cancelled',
    })

    const snapshot = await loadPostgresReportMetrics(harness.database, {
      clients: [
        { id: alpha, name: 'Cliente Alpha', representativeId: 'rep-1' },
        { id: beta, name: 'Cliente Beta', representativeId: 'rep-2' },
        { id: dormant, name: 'Cliente Dormente', representativeId: 'rep-1' },
        { id: randomUUID(), name: 'Cliente Sem Pedido', representativeId: 'rep-1' },
      ],
      request: {
        from: '2026-07-01',
        to: '2026-07-31',
        asOf: '2026-08-17',
        inactiveDays: 90,
        timeZone: 'America/Fortaleza',
        role: 'admin',
        actorRepresentativeId: null,
        explicitlyAssignedRepresentativeIds: [],
        statuses: [],
      },
    })

    expect(snapshot.byCurrency).toEqual([
      {
        currencyCode: 'BRL',
        orderCount: 3,
        clientCount: 2,
        totalAmount: '600.015000',
        commissionAmount: '30.015000',
      },
    ])
    expect(snapshot.clients.map((row) => [row.name, row.orderCount])).toEqual([
      ['Cliente Alpha', 2],
      ['Cliente Beta', 1],
    ])
    expect(snapshot.industries.map((row) => [row.name, row.orderCount])).toEqual([
      ['Indústria A', 2],
      ['Indústria B', 1],
    ])
    expect(snapshot.inactiveClients.map((row) => row.name)).toEqual([
      'Cliente Dormente',
      'Cliente Sem Pedido',
    ])
  })
})
