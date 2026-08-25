import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { productPriceHistory, productPrices } from '@/lib/db/schema'
import { createPricingService } from '@/lib/catalog/pricing.server'
import { createPostgresTestHarness, type PostgresTestHarness } from '../support/postgres-harness'

let harness: PostgresTestHarness
const authenticatedActor = { id: 'actor:authenticated-admin', role: 'admin' as const }
const pricingService = () => createPricingService({
  database: harness.database,
  authenticate: async () => authenticatedActor,
})
beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'pricing_service',
    migrationNames: ['0001_catalog_pricing.sql', '0002_catalog_audit.sql'],
  })
})
beforeEach(async () => { await harness.reset() })
afterAll(async () => { await harness?.close() })

async function seedProduct(seed: string = randomUUID()) {
  const industryId = randomUUID()
  const productId = randomUUID()
  await harness.sql`INSERT INTO industries (id, legal_name) VALUES (${industryId}, ${`Indústria ${seed}`})`
  await harness.sql`
    INSERT INTO products (id, industry_id, internal_code, description, unit, created_by, updated_by)
    VALUES (${productId}, ${industryId}, ${`TEST-${seed}`}, ${`Produto ${seed}`}, 'UN', 'test', 'test')
  `
  return { id: productId }
}

async function currentLists(productId: string) {
  const result = await pricingService().getCurrentPrices({ productId })
  if (!result.ok) throw new Error('Expected current price lists')
  return result.data.prices
}

describe('pricing service on PostgreSQL', () => {
  it('retrieves exactly four lists and stores exact Decimal values on every list', async () => {
    const product = await seedProduct('all-lists')
    const service = pricingService()
    const lists = await currentLists(product.id!)
    expect(lists.map((price) => [price.priceList.key, price.priceList.position, price.amount])).toEqual([
      ['PRICE_1', 1, null], ['PRICE_2', 2, null], ['PRICE_3', 3, null], ['PRICE_4', 4, null],
    ])

    for (const [index, price] of lists.entries()) {
      const result = await service.updatePrice({
        productId: product.id,
        priceListId: price.priceList.id,
        amount: index === 3 ? '1234567890123.123456' : `${index + 1}.00000${index + 1}`,
        expectedVersion: null,
        reason: ` Initial list ${index + 1} `,
      })
      expect(result).toMatchObject({ ok: true, data: { status: 'created', price: { version: '1' } } })
    }

    const current = await service.getCurrentPrices({ productId: product.id })
    expect(current).toMatchObject({
      ok: true,
      data: { prices: [
        { amount: '1.000001' }, { amount: '2.000002' },
        { amount: '3.000003' }, { amount: '1234567890123.123456' },
      ] },
    })
  })

  it('updates atomically, suppresses no-op history, and returns stale-version conflicts', async () => {
    const product = await seedProduct('update')
    const service = pricingService()
    const list = (await currentLists(product.id!))[0]!
    const created = await service.updatePrice({ productId: product.id, priceListId: list.priceList.id,
      amount: '10.000001', expectedVersion: null, reason: 'Initial value' })
    expect(created).toMatchObject({ ok: true, data: { status: 'created', price: { version: '1' } } })

    const updated = await service.updatePrice({ productId: product.id, priceListId: list.priceList.id,
      amount: '10.123456', expectedVersion: '1', reason: 'Supplier adjustment' })
    expect(updated).toMatchObject({ ok: true, data: { status: 'updated', price: { version: '2' } } })

    const noOp = await service.updatePrice({ productId: product.id, priceListId: list.priceList.id,
      amount: '10.123456', expectedVersion: '2', reason: 'No effective change' })
    expect(noOp).toMatchObject({ ok: true, data: { status: 'unchanged', price: { version: '2' } } })

    const stale = await service.updatePrice({ productId: product.id, priceListId: list.priceList.id,
      amount: '99', expectedVersion: '1', reason: 'Stale browser' })
    expect(stale).toEqual({ ok: false, error: { category: 'conflict' } })

    const history = await service.getPriceHistory({ productId: product.id, priceListId: list.priceList.id, limit: 10 })
    expect(history).toMatchObject({ ok: true, data: { nextCursor: null, items: [
      { oldAmount: '10.000001', newAmount: '10.123456', actor: authenticatedActor.id, reason: 'Supplier adjustment', version: '2' },
      { oldAmount: null, newAmount: '10.000001', actor: authenticatedActor.id, reason: 'Initial value', version: '1' },
    ] } })
  })

  it('returns stable keyset pages ordered by server timestamp and id', async () => {
    const product = await seedProduct('pagination')
    const service = pricingService()
    const list = (await currentLists(product.id!))[1]!
    let version: string | null = null
    for (const amount of ['1', '2', '3']) {
      const result = await service.updatePrice({ productId: product.id, priceListId: list.priceList.id,
        amount, expectedVersion: version, reason: `change ${amount}` })
      if (!result.ok) throw new Error('Expected update')
      version = result.data.price.version
    }
    const first = await service.getPriceHistory({ productId: product.id, priceListId: list.priceList.id, limit: 2 })
    expect(first).toMatchObject({ ok: true, data: { items: [{ newAmount: '3.000000' }, { newAmount: '2.000000' }] } })
    if (!first.ok || !first.data.nextCursor) throw new Error('Expected next cursor')
    const second = await service.getPriceHistory({ productId: product.id, priceListId: list.priceList.id,
      cursor: first.data.nextCursor, limit: 2 })
    expect(second).toMatchObject({ ok: true, data: { items: [{ newAmount: '1.000000' }], nextCursor: null } })
  })

  it('rejects spoofed actors, invalid reasons, amounts, identifiers, and versions before writing', async () => {
    const product = await seedProduct('validation')
    const service = pricingService()
    const list = (await currentLists(product.id!))[0]!
    for (const input of [
      { productId: product.id, priceListId: list.priceList.id, amount: '1', expectedVersion: null, actor: 'spoofed', reason: 'valid' },
      { productId: product.id, priceListId: list.priceList.id, amount: '1', expectedVersion: null, reason: ' ' },
      { productId: product.id, priceListId: list.priceList.id, amount: '1.0000001', expectedVersion: null, reason: 'valid' },
    ]) {
      expect(await service.updatePrice(input)).toMatchObject({ ok: false, error: { category: 'validation' } })
    }
    expect(await service.updatePrice({ productId: product.id, priceListId: randomUUID(), amount: '1',
      expectedVersion: null, reason: 'valid' })).toEqual({ ok: false, error: { category: 'not-found' } })
    expect(await harness.database.select().from(productPrices)).toEqual([])
  })

  it('rolls back the current value when immutable history append fails', async () => {
    const product = await seedProduct('rollback')
    const service = pricingService()
    const list = (await currentLists(product.id!))[0]!
    await service.updatePrice({ productId: product.id, priceListId: list.priceList.id, amount: '5',
      expectedVersion: null, reason: 'Initial' })
    await harness.database.execute(sql.raw(`
      CREATE FUNCTION fail_price_history_append() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic history failure'; END $$;
      CREATE TRIGGER fail_price_history_append_trg BEFORE INSERT ON product_price_history
      FOR EACH ROW EXECUTE FUNCTION fail_price_history_append();
    `))

    const failed = await service.updatePrice({ productId: product.id, priceListId: list.priceList.id, amount: '6',
      expectedVersion: '1', reason: 'Must roll back' })
    expect(failed).toMatchObject({ ok: false, error: { category: 'unexpected' } })
    expect(await harness.database.select({ amount: productPrices.amount, version: productPrices.version }).from(productPrices))
      .toEqual([{ amount: '5.000000', version: 1n }])
    expect(await harness.database.select().from(productPriceHistory)).toHaveLength(1)
  })

  it('keeps history immutable outside the database trigger', async () => {
    const product = await seedProduct('immutable')
    const service = pricingService()
    const list = (await currentLists(product.id!))[0]!
    await service.updatePrice({ productId: product.id, priceListId: list.priceList.id, amount: '5',
      expectedVersion: null, reason: 'Initial' })
    const history = await harness.database.select().from(productPriceHistory)
    await expect(harness.database.update(productPriceHistory).set({ reason: 'rewrite' })
      .where(eq(productPriceHistory.id, history[0]!.id))).rejects.toThrow()
  })
})
