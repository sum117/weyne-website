import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createProductCatalogService, type ProductFields } from '@/features/app/products/catalog.service.server'
import { createPricingService } from '@/lib/catalog/pricing.server'
import type { CatalogActor } from '@/lib/catalog/authorization.server'
import * as schema from '@/lib/db/schema'
import { createPostgresTestHarness, type PostgresTestHarness } from '../support/postgres-harness'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

let harness: PostgresTestHarness
let industryId: string
const auxiliaryClients: Sql[] = []

function product(overrides: Partial<ProductFields> = {}): ProductFields {
  return {
    industryId,
    internalCode: `ACCEPT-${randomUUID()}`,
    manufacturerCode: 'FAB-99.X',
    description: 'Produto de aceitação',
    brand: 'Marca Aceitação',
    category: 'Higiene',
    ncm: '1234.56.78',
    cest: '12.345.67',
    ean: null,
    dun: null,
    packaging: 'Caixa',
    unit: 'UN',
    netWeight: '1.123456',
    grossWeight: '1.234567',
    width: null,
    height: null,
    depth: null,
    dimensionUnit: null,
    ipiRate: '5.123456',
    icmsRate: '18.000000',
    pisRate: '1.650000',
    cofinsRate: '7.600000',
    commissionOverride: null,
    ...overrides,
  }
}

async function participant(applicationName: string, actor: CatalogActor) {
  const client = postgres(databaseUrl!, {
    max: 1,
    prepare: false,
    connection: { application_name: applicationName },
    onnotice: () => undefined,
  })
  auxiliaryClients.push(client)
  await client.unsafe(`SET search_path TO "${harness.schemaName}", public`)
  const database = drizzle(client, { schema })
  const authenticate = async () => actor
  return {
    catalog: createProductCatalogService(database, {
      fallbackCommission: '4.250000',
      authenticate,
    }),
    pricing: createPricingService({ database, authenticate }),
  }
}

async function waitUntilApplicationsBlock(applicationNames: readonly string[]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await harness.sql<{
      applicationName: string
      waitEventType: string | null
    }[]>`
      SELECT application_name AS "applicationName", wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE application_name LIKE 'catalog-acceptance-race-%'
    `
    const state = new Map(rows.map((row) => [row.applicationName, row.waitEventType]))
    if (applicationNames.every((name) => state.get(name) === 'Lock')) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for PostgreSQL row-lock contention: ${applicationNames.join(', ')}`)
}

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'catalog_pricing_acceptance',
    migrationNames: ['0001_catalog_pricing.sql', '0002_catalog_audit.sql'],
  })
})

beforeEach(async () => {
  await harness.reset()
  industryId = randomUUID()
  await harness.sql`
    INSERT INTO industries (id, legal_name)
    VALUES (${industryId}, 'Indústria de aceitação')
  `
})

afterEach(async () => {
  await Promise.all(auxiliaryClients.splice(0).map((client) => client.end({ timeout: 5 })))
})

afterAll(async () => {
  await harness?.close()
})

describe('catalog and pricing final PostgreSQL acceptance', () => {
  it('serializes simultaneous partial product updates into an exact audit chain without losing fields', async () => {
    const creator = await participant('catalog-acceptance-creator', { id: 'admin:creator', role: 'admin' })
    const created = await creator.catalog.create({ product: product() })
    if (!created.ok) throw new Error('Expected product creation')

    const updaterA = await participant('catalog-acceptance-race-product-a', { id: 'admin:description', role: 'admin' })
    const updaterB = await participant('catalog-acceptance-race-product-b', { id: 'admin:brand', role: 'admin' })
    const blocker = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => undefined })
    auxiliaryClients.push(blocker)
    await blocker.unsafe(`SET search_path TO "${harness.schemaName}", public`)
    await blocker.unsafe('BEGIN')
    let committed = false

    try {
      await blocker`SELECT id FROM products WHERE id = ${created.data.id} FOR UPDATE`
      const updates = Promise.all([
        updaterA.catalog.update({ id: created.data.id, product: { description: 'Descrição concorrente' } }),
        updaterB.catalog.update({ id: created.data.id, product: { brand: 'Marca concorrente' } }),
      ])
      await waitUntilApplicationsBlock([
        'catalog-acceptance-race-product-a',
        'catalog-acceptance-race-product-b',
      ])
      await blocker.unsafe('COMMIT')
      committed = true
      expect(await updates).toEqual([
        expect.objectContaining({ ok: true }),
        expect.objectContaining({ ok: true }),
      ])
    } finally {
      if (!committed) await blocker.unsafe('ROLLBACK')
    }

    const detail = await creator.catalog.detail({ id: created.data.id })
    expect(detail).toMatchObject({
      ok: true,
      data: { description: 'Descrição concorrente', brand: 'Marca concorrente' },
    })

    const audits = await harness.sql<{
      actorId: string
      beforeState: Record<string, unknown>
      afterState: Record<string, unknown>
    }[]>`
      SELECT actor_id AS "actorId", before_state AS "beforeState", after_state AS "afterState"
      FROM catalog_audit
      WHERE operation = 'product.update' AND target_id = ${created.data.id}
      ORDER BY occurred_at, id
    `
    expect(audits).toHaveLength(2)
    expect(audits[1]!.beforeState).toEqual(audits[0]!.afterState)
    expect(new Set(audits.map((event) => event.actorId))).toEqual(
      new Set(['admin:description', 'admin:brand']),
    )

    for (const audit of audits) {
      if (audit.actorId === 'admin:description') {
        expect(audit.afterState.description).toBe('Descrição concorrente')
        expect(audit.afterState.brand).toBe(audit.beforeState.brand)
      } else {
        expect(audit.afterState.brand).toBe('Marca concorrente')
        expect(audit.afterState.description).toBe(audit.beforeState.description)
      }
    }
  })

  it('allows exactly one same-version price race and commits one matching current/history/audit transaction', async () => {
    const creator = await participant('catalog-acceptance-price-creator', { id: 'admin:creator', role: 'admin' })
    const created = await creator.catalog.create({ product: product({ internalCode: 'PRICE-RACE' }) })
    if (!created.ok) throw new Error('Expected product creation')
    const priceListId = created.data.prices[0]!.priceListId

    const initial = await creator.pricing.updatePrice({
      productId: created.data.id,
      priceListId,
      amount: '10.000001',
      expectedVersion: null,
      reason: 'Carga inicial exata',
    })
    expect(initial).toMatchObject({ ok: true, data: { price: { version: '1' } } })

    const contenderA = await participant('catalog-acceptance-race-price-a', { id: 'admin:price-a', role: 'admin' })
    const contenderB = await participant('catalog-acceptance-race-price-b', { id: 'admin:price-b', role: 'admin' })
    const results = await Promise.all([
      contenderA.pricing.updatePrice({
        productId: created.data.id,
        priceListId,
        amount: '20.123456',
        expectedVersion: '1',
        reason: 'Reajuste concorrente A',
      }),
      contenderB.pricing.updatePrice({
        productId: created.data.id,
        priceListId,
        amount: '30.654321',
        expectedVersion: '1',
        reason: 'Reajuste concorrente B',
      }),
    ])

    const successes = results.filter((result) => result.ok)
    const conflicts = results.filter((result) => !result.ok && result.error.category === 'conflict')
    expect(successes).toHaveLength(1)
    expect(conflicts).toHaveLength(1)
    const winner = successes[0]
    if (!winner?.ok) throw new Error('Expected one winning update')
    const winnerAmount = winner.data.price.amount
    const winnerActor = winnerAmount === '20.123456' ? 'admin:price-a' : 'admin:price-b'
    const winnerReason = winnerAmount === '20.123456'
      ? 'Reajuste concorrente A'
      : 'Reajuste concorrente B'

    const current = await creator.pricing.getCurrentPrices({ productId: created.data.id })
    expect(current).toMatchObject({ ok: true })
    if (!current.ok) throw new Error('Expected current prices')
    expect(current.data.prices[0]).toMatchObject({
      amount: winnerAmount,
      version: '2',
      updatedBy: winnerActor,
    })
    expect(current.data.prices).toHaveLength(4)
    expect(JSON.stringify(current)).not.toMatch(/20\.123455|30\.654320/)

    const history = await creator.pricing.getPriceHistory({
      productId: created.data.id,
      priceListId,
      limit: 10,
    })
    expect(history).toMatchObject({
      ok: true,
      data: {
        nextCursor: null,
        items: [
          {
            oldAmount: '10.000001',
            newAmount: winnerAmount,
            actor: winnerActor,
            reason: winnerReason,
            version: '2',
          },
          {
            oldAmount: null,
            newAmount: '10.000001',
            actor: 'admin:creator',
            reason: 'Carga inicial exata',
            version: '1',
          },
        ],
      },
    })
    if (!history.ok) throw new Error('Expected price history')
    expect(new Set(history.data.items.map((item) => item.id)).size).toBe(2)
    expect(Date.parse(history.data.items[0]!.changedAt)).toBeGreaterThanOrEqual(
      Date.parse(history.data.items[1]!.changedAt),
    )

    const priceAudits = await harness.sql<{
      actorId: string
      reason: string
      afterAmount: string
    }[]>`
      SELECT actor_id AS "actorId", reason, after_state ->> 'amount' AS "afterAmount"
      FROM catalog_audit
      WHERE operation = 'price.update' AND target_id = ${winner.data.price.id}
      ORDER BY occurred_at, id
    `
    expect(priceAudits).toEqual([
      { actorId: 'admin:creator', reason: 'Carga inicial exata', afterAmount: '10.000001' },
      { actorId: winnerActor, reason: winnerReason, afterAmount: winnerAmount },
    ])
  })

  it('keeps archived rows, exposes no hard-delete/media API, and uses catalog search indexes', async () => {
    const admin = await participant('catalog-acceptance-contract', { id: 'admin:contract', role: 'admin' })
    const created = await admin.catalog.create({ product: product({ internalCode: ' IDX-77.X ' }) })
    if (!created.ok) throw new Error('Expected product creation')

    expect('delete' in admin.catalog).toBe(false)
    expect('media' in admin.catalog).toBe(false)
    expect(await admin.catalog.update({ id: created.data.id, product: { media: [] } })).toMatchObject({
      ok: false,
      error: { category: 'validation' },
    })
    expect(await admin.catalog.archive({ id: created.data.id, archived: true })).toMatchObject({
      ok: true,
      data: { isActive: false },
    })
    await expect(harness.sql`DELETE FROM products WHERE id = ${created.data.id}`).rejects.toThrow(/hard delete/i)
    const stored = await harness.sql<{ count: string; isActive: boolean }[]>`
      SELECT count(*)::text AS count, bool_and(is_active) AS "isActive"
      FROM products WHERE id = ${created.data.id}
    `
    expect(stored).toEqual([{ count: '1', isActive: false }])

    await admin.catalog.archive({ id: created.data.id, archived: false })
    await harness.sql`SET enable_seqscan = off`
    try {
      const normalizedPlan = await harness.sql`
        EXPLAIN (FORMAT JSON)
        SELECT id FROM products WHERE internal_code_normalized = 'IDX77X'
      `
      const facetPlan = await harness.sql`
        EXPLAIN (FORMAT JSON)
        SELECT industry_id, count(*) FROM products
        WHERE archived_at IS NULL AND industry_id = ${industryId}
        GROUP BY industry_id
      `
      expect(JSON.stringify(normalizedPlan)).toContain('products_internal_code_normalized_uidx')
      expect(JSON.stringify(facetPlan)).toContain('products_active_industry_idx')
    } finally {
      await harness.sql`RESET enable_seqscan`
    }
  })
})
