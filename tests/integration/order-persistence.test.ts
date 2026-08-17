import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as dbSchema from '@/lib/db/schema'
import { orderLines, orders } from '@/lib/db/schema'
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
    schemaPrefix: 'orders',
    migrationNames: [
      '0002_quote_persistence.sql',
      '0004_order_persistence.sql',
      '0004_carriers.sql',
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
          manufacturerCode: 'FAB-001',
          description: 'Produto sintético para persistência',
          brand: 'Marca Teste',
          category: 'Categoria Teste',
          ncm: '12345678',
          cest: '1234567',
          ean: null,
          dun: null,
          packaging: 'CX',
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
          {
            code: 'ICMS',
            rate: '18.000000',
            basisAmount: '85.500000',
            amount: '15.390000',
          },
        ],
      },
    ],
  }
}

async function createApprovedQuote(id: string): Promise<void> {
  quoteSequence += 1
  const quoteNumber = `ORC-2026-${String(quoteSequence).padStart(6, '0')}`
  await harness.sql`
    INSERT INTO quotes (
      id, quote_number, owner_user_id, status, valid_until, version,
      customer_snapshot, commercial_snapshot
    ) VALUES (
      ${id}, ${quoteNumber},
      'integration-test', 'approved', '2026-12-31', 3, '{}'::jsonb, '{}'::jsonb
    )
  `
}

describe('order persistence', () => {
  it('persists immutable quote snapshots and enforces one order per source quote', async () => {
    const repository = createPostgresOrderRepository(harness.database)
    const snapshot = orderSnapshot()
    await createApprovedQuote(snapshot.sourceQuoteId)

    const created = await repository.transaction((transaction) =>
      transaction.createOrder(snapshot, {
        actor: 'user:integration-test',
        reason: 'Approved quote conversion',
        occurredAt: new Date('2026-08-17T12:00:00.000Z'),
      }),
    )

    expect(created.number).toBe('PED-2026-000001')
    expect(created.status).toBe('open')
    expect(created.version).toBe(1n)

    const rows = await harness.database
      .select({
        sourceQuoteId: orders.sourceQuoteId,
        clientLegalName: orders.clientLegalName,
        grandTotalAmount: orders.grandTotalAmount,
        productDescription: orderLines.productDescription,
        quantity: orderLines.quantity,
        unitPriceAmount: orderLines.unitPriceAmount,
      })
      .from(orders)
      .innerJoin(orderLines, eq(orderLines.orderId, orders.id))

    expect(rows).toEqual([
      {
        sourceQuoteId: snapshot.sourceQuoteId,
        clientLegalName: snapshot.client.legalName,
        grandTotalAmount: '119.440000',
        productDescription: snapshot.lines[0]!.product.description,
        quantity: '10.000000',
        unitPriceAmount: '10.000000',
      },
    ])

    await expect(
      repository.transaction((transaction) =>
        transaction.createOrder(snapshot, {
          actor: 'user:integration-test',
          reason: 'Duplicate conversion',
          occurredAt: new Date('2026-08-17T12:01:00.000Z'),
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505' } })

    const [line] = await harness.database.select({ id: orderLines.id }).from(orderLines)
    await expect(
      harness.sql`UPDATE order_lines SET quantity = '99.000000' WHERE id = ${line!.id}`,
    ).rejects.toThrow(/immutable/i)
  })

  it('rolls back both the allocated number and order rows', async () => {
    const repository = createPostgresOrderRepository(harness.database)
    const rolledBack = orderSnapshot()
    const committed = orderSnapshot()
    await createApprovedQuote(rolledBack.sourceQuoteId)
    await createApprovedQuote(committed.sourceQuoteId)

    await expect(
      repository.transaction(async (transaction) => {
        await transaction.createOrder(rolledBack, {
          actor: 'user:rollback-test',
          reason: 'Conversion that must roll back',
          occurredAt: new Date('2026-08-17T12:00:00.000Z'),
        })
        throw new Error('simulate quote update failure')
      }),
    ).rejects.toThrow('simulate quote update failure')

    const created = await repository.transaction((transaction) =>
      transaction.createOrder(committed, {
        actor: 'user:rollback-test',
        reason: 'Successful conversion',
        occurredAt: new Date('2026-08-17T12:01:00.000Z'),
      }),
    )
    expect(created.number).toBe('PED-2026-000001')
    expect(await repository.transaction((transaction) =>
      transaction.findBySourceQuote(rolledBack.sourceQuoteId),
    )).toBeNull()

    const [sourceQuote] = await harness.sql<{ status: string }[]>`
      SELECT status FROM quotes WHERE id = ${rolledBack.sourceQuoteId}
    `
    expect(sourceQuote?.status).toBe('approved')
  })

  it('allocates a gapless unique sequence across concurrent PostgreSQL connections', async () => {
    const snapshots = Array.from({ length: 12 }, () => orderSnapshot())
    for (const snapshot of snapshots) await createApprovedQuote(snapshot.sourceQuoteId)

    const clients = snapshots.map(() => postgres(databaseUrl, { max: 1 }))
    try {
      await Promise.all(
        clients.map((client) =>
          client.unsafe(`SET search_path TO "${harness.schemaName}", public`),
        ),
      )
      const created = await Promise.all(
        clients.map((client, index) =>
          createPostgresOrderRepository(drizzle(client, { schema: dbSchema }))
            .transaction((transaction) =>
              transaction.createOrder(snapshots[index]!, {
                actor: 'user:concurrency-test',
                reason: 'Concurrent conversion',
                occurredAt: new Date('2026-08-17T12:00:00.000Z'),
              }),
            ),
        ),
      )

      expect(created.map((order) => order.number).sort()).toEqual(
        Array.from({ length: 12 }, (_, index) =>
          `PED-2026-${String(index + 1).padStart(6, '0')}`,
        ),
      )
    } finally {
      await Promise.all(clients.map((client) => client.end({ timeout: 5 })))
    }
  })

  it('updates lifecycle state and audit atomically with optimistic concurrency', async () => {
    const repository = createPostgresOrderRepository(harness.database)
    const snapshot = orderSnapshot()
    await createApprovedQuote(snapshot.sourceQuoteId)
    const created = await repository.transaction((transaction) =>
      transaction.createOrder(snapshot, {
        actor: 'user:lifecycle-test',
        reason: 'Conversion',
      }),
    )

    const confirmed = await repository.transaction((transaction) =>
      transaction.transitionState({
        orderId: created.id,
        expectedVersion: 1n,
        toStatus: 'confirmed',
        actor: 'user:lifecycle-test',
        reason: 'Client confirmed',
      }),
    )
    expect(confirmed).toMatchObject({ status: 'confirmed', version: 2n })

    await expect(
      repository.transaction((transaction) =>
        transaction.transitionState({
          orderId: created.id,
          expectedVersion: 1n,
          toStatus: 'cancelled',
          actor: 'user:stale-editor',
          reason: 'Stale cancellation',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONCURRENT_MODIFICATION' })

    const audit = await harness.sql<{ fromStatus: string | null; toStatus: string; version: string }[]>`
      SELECT from_status AS "fromStatus", to_status AS "toStatus", version::text
      FROM order_state_audit
      WHERE order_id = ${created.id}
      ORDER BY version
    `
    expect(audit).toEqual([
      { fromStatus: null, toStatus: 'open', version: '1' },
      { fromStatus: 'open', toStatus: 'confirmed', version: '2' },
    ])
  })
})
