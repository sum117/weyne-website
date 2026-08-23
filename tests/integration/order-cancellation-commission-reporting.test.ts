import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as dbSchema from '@/lib/db/schema'
import {
  createPostgresOrderRepository,
  type NewOrderSnapshot,
} from '@/lib/orders/repository.server'
import {
  createOrderLifecycleService,
  type OrderLifecycleActor,
} from '@/lib/orders/lifecycle.server'
import { createPostgresOrderHistorySource } from '@/domain/orders/history-source.server'
import { loadPostgresReportMetrics } from '@/features/app/reports/report-metrics.server'
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
    schemaPrefix: 'cancel_commission',
  })
})

beforeEach(async () => {
  await harness.reset()
  quoteSequence = 0
})

afterAll(async () => {
  await harness?.close()
})

const admin: OrderLifecycleActor = { id: 'user:admin-commission', role: 'admin' }
const OWNER = 'rep-commission-1'

function orderSnapshot(input: {
  sourceQuoteId: string
  total: string
  commission: string
}): NewOrderSnapshot {
  return {
    sourceQuoteId: input.sourceQuoteId,
    sourceQuoteRevision: 1,
    client: {
      id: randomUUID(),
      legalName: 'Cliente Comissão Teste Ltda.',
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
          id: randomUUID(),
          internalCode: 'TEST-COMM',
          manufacturerCode: null,
          description: 'Produto Comissão',
          industryId: '11111111-1111-4111-8111-111111111111',
          industryName: 'Indústria Comissão',
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
        commissionRate: '3.000000',
        commissionBasisAmount: input.total,
        commissionAmount: input.commission,
        configuredTaxes: [],
      },
    ],
  }
}

async function createOpenOrder(input: {
  total: string
  commission: string
  occurredAt?: string
}) {
  quoteSequence += 1
  const quoteId = randomUUID()
  await harness.sql`
    INSERT INTO quotes (
      id, quote_number, owner_user_id, status, valid_until,
      customer_snapshot, commercial_snapshot
    ) VALUES (
      ${quoteId}, ${`ORC-2026-${String(quoteSequence).padStart(6, '0')}`}, ${OWNER},
      'converted', '2026-12-31', '{}'::jsonb, '{}'::jsonb
    )
  `
  const repository = createPostgresOrderRepository(harness.database)
  const occurredAt = new Date(input.occurredAt ?? '2026-08-10T12:00:00.000Z')
  return repository.transaction((transaction) =>
    transaction.createOrder(
      orderSnapshot({ sourceQuoteId: quoteId, total: input.total, commission: input.commission }),
      { actor: admin.id, reason: 'Approved quote conversion', occurredAt },
    ),
  )
}

type OrderMoneyRow = {
  status: string
  version: string
  grandTotalAmount: string
  commissionBasisAmount: string
  commissionAmount: string
}

async function readOrderMoney(orderId: string): Promise<OrderMoneyRow> {
  const [row] = await harness.sql<OrderMoneyRow[]>`
    SELECT status, version::text AS version,
           grand_total_amount AS "grandTotalAmount",
           commission_basis_amount AS "commissionBasisAmount",
           commission_amount AS "commissionAmount"
    FROM orders WHERE id = ${orderId}
  `
  if (!row) throw new Error(`Order ${orderId} not found`)
  return row
}

async function ledgerTotals(): Promise<{ orderCount: number; commissionSum: string }> {
  const [row] = await harness.sql<{ orderCount: string; commissionSum: string }[]>`
    SELECT COUNT(*)::text AS "orderCount", COALESCE(SUM(commission_amount), 0)::text AS "commissionSum"
    FROM orders
  `
  return { orderCount: Number(row!.orderCount), commissionSum: row!.commissionSum }
}

type AuditRow = {
  fromStatus: string | null
  toStatus: string
  actor: string
  reason: string
  version: string
}

async function readAudit(orderId: string): Promise<AuditRow[]> {
  return harness.sql<AuditRow[]>`
    SELECT from_status AS "fromStatus", to_status AS "toStatus",
           actor, reason, version::text AS version
    FROM order_state_audit
    WHERE order_id = ${orderId}
    ORDER BY version
  `
}

const REPORT_REQUEST = {
  from: '2026-08-01',
  to: '2026-08-30',
  asOf: '2026-08-30',
  inactiveDays: 90,
  timeZone: 'America/Fortaleza',
  role: 'admin' as const,
  actorRepresentativeId: null,
  explicitlyAssignedRepresentativeIds: [],
  statuses: [],
}

async function commissionReport(): Promise<string> {
  const snapshot = await loadPostgresReportMetrics(harness.database, {
    clients: [],
    request: REPORT_REQUEST,
  })
  expect(snapshot.byCurrency.length).toBeLessThanOrEqual(1)
  return snapshot.byCurrency[0]?.commissionAmount ?? '0.000000'
}

describe('cancellation and commission reporting on PostgreSQL', () => {
  it('keeps the projected commission immutable across eligible transitions and reports it until cancellation', async () => {
    const created = await createOpenOrder({ total: '85.500000', commission: '2.565000' })
    const service = createOrderLifecycleService(harness.database)

    // Pre-cancellation: the open order's projected commission is visible.
    expect(await commissionReport()).toBe('2.565000')

    const confirmed = await service.transition({
      orderId: created.id,
      expectedVersion: 1n,
      command: 'confirmOrder',
      actor: admin,
    })
    const invoiced = await service.transition({
      orderId: created.id,
      expectedVersion: confirmed.version,
      command: 'markOrderInvoiced',
      actor: admin,
    })

    // Transitions never reprice or re-derive the commission snapshot.
    let money = await readOrderMoney(created.id)
    expect(money).toEqual({
      status: 'invoiced',
      version: '3',
      grandTotalAmount: '85.500000',
      commissionBasisAmount: '85.500000',
      commissionAmount: '2.565000',
    })
    expect(await commissionReport()).toBe('2.565000')

    const completed = await service.transition({
      orderId: created.id,
      expectedVersion: invoiced.version,
      command: 'completeOrder',
      actor: admin,
    })
    expect(completed.status).toBe('completed')
    money = await readOrderMoney(created.id)
    expect(money.commissionAmount).toBe('2.565000')

    // Completed orders keep contributing exactly once.
    expect(await commissionReport()).toBe('2.565000')
    expect(await ledgerTotals()).toEqual({ orderCount: 1, commissionSum: '2.565000' })
  })

  it('excludes a cancelled order from reports while preserving its stored projection exactly once', async () => {
    const survivor = await createOpenOrder({ total: '100.000000', commission: '3.000000' })
    const doomed = await createOpenOrder({ total: '200.000000', commission: '6.000000' })
    const service = createOrderLifecycleService(harness.database)

    expect(await commissionReport()).toBe('9.000000')

    await service.transition({
      orderId: doomed.id,
      expectedVersion: 1n,
      command: 'confirmOrder',
      actor: admin,
    })
    expect(await commissionReport()).toBe('9.000000')

    const cancelled = await service.transition({
      orderId: doomed.id,
      expectedVersion: 2n,
      command: 'cancelOrder',
      actor: admin,
      reason: 'Cliente desistiu da compra',
    })
    expect(cancelled.status).toBe('cancelled')

    // The cancelled order keeps its immutable snapshot columns untouched:
    // exclusion happens at reporting time, not by zeroing stored data.
    const money = await readOrderMoney(doomed.id)
    expect(money).toEqual({
      status: 'cancelled',
      version: '3',
      grandTotalAmount: '200.000000',
      commissionBasisAmount: '200.000000',
      commissionAmount: '6.000000',
    })

    // Post-cancellation report drops exactly the cancelled amount.
    expect(await commissionReport()).toBe('3.000000')

    // No reversal rows, no negative entries, no double counting anywhere.
    expect(await ledgerTotals()).toEqual({ orderCount: 2, commissionSum: '9.000000' })

    // Reports are pure reads: repeating the query is stable.
    expect(await commissionReport()).toBe('3.000000')
    expect(survivor.version).toBe(1n)
  })

  it('makes repeated cancellation requests safe: one effect, no duplicate audit or report impact', async () => {
    const created = await createOpenOrder({ total: '50.000000', commission: '1.500000' })
    const service = createOrderLifecycleService(harness.database)

    const cancelled = await service.transition({
      orderId: created.id,
      expectedVersion: 1n,
      command: 'cancelOrder',
      actor: admin,
      reason: 'Primeiro cancelamento',
    })
    expect(cancelled).toMatchObject({ status: 'cancelled', version: 2n })

    // Replay with the current version: terminal state rejects the command.
    await expect(
      service.transition({
        orderId: created.id,
        expectedVersion: cancelled.version,
        command: 'cancelOrder',
        actor: admin,
        reason: 'Cancelamento repetido',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })

    // Replay with a stale version: optimistic concurrency rejects it first.
    await expect(
      service.transition({
        orderId: created.id,
        expectedVersion: 1n,
        command: 'cancelOrder',
        actor: admin,
        reason: 'Cancelamento obsoleto',
      }),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' })

    // Exactly one state-changing audit entry beyond creation, and the report
    // still reflects a single exclusion.
    const audit = await readAudit(created.id)
    expect(audit.map((row) => [row.fromStatus, row.toStatus, row.version])).toEqual([
      [null, 'open', '1'],
      ['open', 'cancelled', '2'],
    ])
    expect(audit.at(-1)).toMatchObject({ reason: 'Primeiro cancelamento', actor: admin.id })
    expect(await commissionReport()).toBe('0.000000')
    expect(await ledgerTotals()).toEqual({ orderCount: 1, commissionSum: '1.500000' })
  })

  it('resolves two concurrent cancellations of the same order to exactly one winner', async () => {
    const created = await createOpenOrder({ total: '70.000000', commission: '2.100000' })
    const clients = [postgres(databaseUrl, { max: 1 }), postgres(databaseUrl, { max: 1 })]
    try {
      await Promise.all(
        clients.map((client) =>
          client.unsafe(`SET search_path TO "${harness.schemaName}", public`),
        ),
      )
      const services = clients.map((client) =>
        createOrderLifecycleService(drizzle(client, { schema: dbSchema })),
      )

      const results = await Promise.allSettled(
        services.map((service) =>
          service.transition({
            orderId: created.id,
            expectedVersion: 1n,
            command: 'cancelOrder',
            actor: admin,
            reason: 'Cancelamento concorrente',
          }),
        ),
      )

      const fulfilled = results.filter((result) => result.status === 'fulfilled')
      const rejected = results.filter(
        (result) =>
          result.status === 'rejected' &&
          (result.reason as { code?: string })?.code === 'CONCURRENT_MODIFICATION',
      )
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)

      expect(await readAudit(created.id)).toHaveLength(2)
      expect(await commissionReport()).toBe('0.000000')
      expect(await ledgerTotals()).toEqual({ orderCount: 1, commissionSum: '2.100000' })
    } finally {
      await Promise.all(clients.map((client) => client.end({ timeout: 5 })))
    }
  })

  it('keeps lifecycle history consistent with the commission outcome after cancellation', async () => {
    const created = await createOpenOrder({ total: '90.000000', commission: '2.700000' })
    const service = createOrderLifecycleService(harness.database)
    const confirmed = await service.transition({
      orderId: created.id,
      expectedVersion: 1n,
      command: 'confirmOrder',
      actor: admin,
    })
    await service.transition({
      orderId: created.id,
      expectedVersion: confirmed.version,
      command: 'cancelOrder',
      actor: admin,
      reason: 'Pedido cancelado pelo cliente',
    })

    // Audit chain is contiguous, matches the persisted version, and ends at
    // the cancellation with its mandatory reason.
    const audit = await readAudit(created.id)
    expect(audit.map((row) => Number(row.version))).toEqual([1, 2, 3])
    const money = await readOrderMoney(created.id)
    expect(Number(money.version)).toBe(audit.length)
    expect(audit.at(-1)).toMatchObject({
      fromStatus: 'confirmed',
      toStatus: 'cancelled',
      reason: 'Pedido cancelado pelo cliente',
    })

    // The unified history surface exposes the same chain through the
    // allowlisted event types only.
    const source = createPostgresOrderHistorySource(harness.database)
    const rows = await source.loadAuditRows(created.id)
    expect(rows.map((row) => [row.type, row.description])).toEqual([
      ['order.created', 'Pedido criado: Approved quote conversion'],
      ['order.status_changed', 'Situação do pedido atualizada: confirmOrder'],
      ['order.status_changed', 'Situação do pedido atualizada: Pedido cancelado pelo cliente'],
    ])

    // History consistency does not resurrect the excluded commission.
    expect(await commissionReport()).toBe('0.000000')
  })
})
