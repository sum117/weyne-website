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
  type OrderLifecycleError,
  createOrderLifecycleService,
  ORDER_LIFECYCLE_TARGETS,
} from '@/lib/orders/lifecycle.server'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

let harness: PostgresTestHarness

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'order_lifecycle',
    migrationNames: [
      '0002_quote_persistence.sql',
      '0004_order_persistence.sql',
      '0004_carriers.sql',
      '0010_order_line_commission_facts.sql',
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

const admin = { id: 'user:admin-lifecycle', role: 'admin' as const }
const representative = { id: 'user:rep-lifecycle', role: 'representative' as const }
const reader = { id: 'user:reader-lifecycle', role: 'read_only' as const }

function orderSnapshot(sourceQuoteId = randomUUID()): NewOrderSnapshot {
  return {
    sourceQuoteId,
    sourceQuoteRevision: 3,
    client: {
      id: randomUUID(),
      legalName: 'Cliente Fictício Teste Ltda.',
      tradeName: 'Cliente Teste',
      taxIdentifier: '00000000000000',
      stateRegistration: 'ISENTO',
      email: 'cliente@example.invalid',
      phone: '+55 00 00000-0000',
      address: {
        street: 'Rua Fictícia',
        number: '123',
        complement: 'Sala 4',
        district: 'Centro de Testes',
        city: 'Cidade Sintética',
        state: 'ZZ',
        postalCode: '00000000',
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
          description: 'Produto sintético para persistência',
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
        commissionSource: 'none',
        commissionRate: null,
        commissionBasisAmount: '0.000000',
        commissionAmount: '0.000000',
        configuredTaxes: [],
      },
    ],
  }
}

let quoteSequence = 0

async function createOpenOrder(sourceQuoteId = randomUUID()) {
  quoteSequence += 1
  const quoteNumber = `ORC-2026-${String(quoteSequence).padStart(6, '0')}`
  await harness.sql`
    INSERT INTO quotes (
      id, quote_number, owner_user_id, status, valid_until, version,
      customer_snapshot, commercial_snapshot
    ) VALUES (
      ${sourceQuoteId}, ${quoteNumber},
      'integration-test', 'approved', '2026-12-31', 3, '{}'::jsonb, '{}'::jsonb
    )
  `
  const repository = createPostgresOrderRepository(harness.database)
  return repository.transaction((transaction) =>
    transaction.createOrder(orderSnapshot(sourceQuoteId), {
      actor: 'user:integration-test',
      reason: 'Approved quote conversion',
      occurredAt: new Date('2026-08-21T12:00:00.000Z'),
    }),
  )
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

describe('order lifecycle transition targets', () => {
  it('matches the frozen domain workflow graph', () => {
    expect(ORDER_LIFECYCLE_TARGETS.confirmOrder).toEqual({ open: 'confirmed' })
    expect(ORDER_LIFECYCLE_TARGETS.markOrderInvoiced).toEqual({ confirmed: 'invoiced' })
    expect(ORDER_LIFECYCLE_TARGETS.completeOrder).toEqual({ invoiced: 'completed' })
    expect(ORDER_LIFECYCLE_TARGETS.cancelOrder).toEqual({
      open: 'cancelled',
      confirmed: 'cancelled',
      invoiced: 'cancelled',
    })
  })
})

describe('audited order lifecycle transitions on PostgreSQL', () => {
  it('walks the full happy path with atomic version increments and complete audit rows', async () => {
    const created = await createOpenOrder()
    const service = createOrderLifecycleService(harness.database)

    const confirmed = await service.transition({
      orderId: created.id,
      expectedVersion: 1n,
      command: 'confirmOrder',
      actor: admin,
    })
    expect(confirmed).toMatchObject({ status: 'confirmed', version: 2n })

    const invoiced = await service.transition({
      orderId: created.id,
      expectedVersion: 2n,
      command: 'markOrderInvoiced',
      actor: admin,
      reason: 'NF-e 000123 emitida',
    })
    expect(invoiced).toMatchObject({ status: 'invoiced', version: 3n })

    const completed = await service.transition({
      orderId: created.id,
      expectedVersion: 3n,
      command: 'completeOrder',
      actor: admin,
    })
    expect(completed).toMatchObject({ status: 'completed', version: 4n })

    expect(await readAudit(created.id)).toEqual([
      { fromStatus: null, toStatus: 'open', actor: 'user:integration-test', reason: 'Approved quote conversion', version: '1' },
      { fromStatus: 'open', toStatus: 'confirmed', actor: admin.id, reason: 'confirmOrder', version: '2' },
      { fromStatus: 'confirmed', toStatus: 'invoiced', actor: admin.id, reason: 'NF-e 000123 emitida', version: '3' },
      { fromStatus: 'invoiced', toStatus: 'completed', actor: admin.id, reason: 'completeOrder', version: '4' },
    ])
  })

  it('requires and persists a non-blank reason for every cancellation', async () => {
    for (const from of ['open', 'confirmed', 'invoiced'] as const) {
      const created = await createOpenOrder()
      const service = createOrderLifecycleService(harness.database)
      let version = 1n
      if (from !== 'open') {
        const confirmed = await service.transition({
          orderId: created.id,
          expectedVersion: version,
          command: 'confirmOrder',
          actor: admin,
        })
        version = confirmed.version
      }
      if (from === 'invoiced') {
        const invoiced = await service.transition({
          orderId: created.id,
          expectedVersion: version,
          command: 'markOrderInvoiced',
          actor: admin,
        })
        version = invoiced.version
      }

      await expect(
        service.transition({
          orderId: created.id,
          expectedVersion: version,
          command: 'cancelOrder',
          actor: admin,
        }),
      ).rejects.toMatchObject({ code: 'TRANSITION_REASON_REQUIRED' })

      await expect(
        service.transition({
          orderId: created.id,
          expectedVersion: version,
          command: 'cancelOrder',
          actor: admin,
          reason: '   ',
        }),
      ).rejects.toMatchObject({ code: 'TRANSITION_REASON_REQUIRED' })

      const cancelled = await service.transition({
        orderId: created.id,
        expectedVersion: version,
        command: 'cancelOrder',
        actor: admin,
        reason: 'Cliente desistiu da compra',
      })
      expect(cancelled.status).toBe('cancelled')

      const audit = await readAudit(created.id)
      const last = audit.at(-1)!
      expect(last.toStatus).toBe('cancelled')
      expect(last.reason).toBe('Cliente desistiu da compra')
      expect(last.actor).toBe(admin.id)

      // Terminal: no further transitions, even with a fresh version read.
      await expect(
        service.transition({
          orderId: created.id,
          expectedVersion: cancelled.version,
          command: 'cancelOrder',
          actor: admin,
          reason: 'Reabrir não é permitido',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    }
  })

  it('rejects illegal direct transitions and writes no audit entry for failures', async () => {
    const created = await createOpenOrder()
    const service = createOrderLifecycleService(harness.database)

    await expect(
      service.transition({
        orderId: created.id,
        expectedVersion: 1n,
        command: 'completeOrder',
        actor: admin,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })

    await expect(
      service.transition({
        orderId: created.id,
        expectedVersion: 1n,
        command: 'markOrderInvoiced',
        actor: admin,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })

    const audit = await readAudit(created.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ toStatus: 'open', version: '1' })
  })

  it('denies stale versions with CONCURRENT_MODIFICATION and no audit entry', async () => {
    const created = await createOpenOrder()
    const service = createOrderLifecycleService(harness.database)
    await service.transition({
      orderId: created.id,
      expectedVersion: 1n,
      command: 'confirmOrder',
      actor: admin,
    })

    await expect(
      service.transition({
        orderId: created.id,
        expectedVersion: 1n,
        command: 'cancelOrder',
        actor: admin,
        reason: 'Cancelamento obsoleto',
      }),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' })

    const audit = await readAudit(created.id)
    expect(audit).toHaveLength(2)
    expect(audit[1]).toMatchObject({ toStatus: 'confirmed', version: '2' })
  })

  it('enforces RBAC inside the domain boundary for every command', async () => {
    const created = await createOpenOrder()
    const service = createOrderLifecycleService(harness.database)

    for (const actor of [representative, reader]) {
      await expect(
        service.transition({
          orderId: created.id,
          expectedVersion: created.version,
          command: 'confirmOrder',
          actor,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(
        service.transition({
          orderId: created.id,
          expectedVersion: created.version,
          command: 'cancelOrder',
          actor,
          reason: 'Sem permissão',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }

    // Nothing changed: still open at version 1 with only the creation entry.
    expect(await readAudit(created.id)).toHaveLength(1)
    const [row] = await harness.sql<{ status: string; version: string }[]>`
      SELECT status, version::text AS version FROM orders WHERE id = ${created.id}
    `
    expect(row).toEqual({ status: 'open', version: '1' })
  })

  it('resolves concurrent transitions on separate connections to exactly one winner', async () => {
    const created = await createOpenOrder()
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
            command: 'confirmOrder',
            actor: admin,
          }),
        ),
      )

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter(
        (r) => r.status === 'rejected' && (r.reason as OrderLifecycleError)?.code === 'CONCURRENT_MODIFICATION',
      )
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)

      const winner = (fulfilled[0] as PromiseFulfilledResult<{ version: bigint }>).value
      expect(winner.version).toBe(2n)

      const [row] = await harness.sql<{ status: string; version: string }[]>`
        SELECT status, version::text AS version FROM orders WHERE id = ${created.id}
      `
      expect(row).toEqual({ status: 'confirmed', version: '2' })
      expect(await readAudit(created.id)).toHaveLength(2)
    } finally {
      await Promise.all(clients.map((client) => client.end({ timeout: 5 })))
    }
  })

  it('reports ORDER_NOT_FOUND for unknown orders without side effects', async () => {
    const service = createOrderLifecycleService(harness.database)
    await expect(
      service.transition({
        orderId: randomUUID(),
        expectedVersion: 1n,
        command: 'confirmOrder',
        actor: admin,
      }),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
  })
})
