import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createProductCatalogService } from '@/features/app/products/catalog.service.server'
import { CatalogAccessError, type CatalogActor } from '@/lib/catalog/authorization.server'
import { createPricingService } from '@/lib/catalog/pricing.server'
import { catalogAudit, productPriceHistory, productPrices, products } from '@/lib/db/schema'
import { createPostgresTestHarness, type PostgresTestHarness } from '../support/postgres-harness'

let harness: PostgresTestHarness
let actor: CatalogActor | null
let industryId: string

const authenticate = async () => actor

function product(internalCode = `RBAC-${randomUUID()}`) {
  return {
    industryId,
    internalCode,
    manufacturerCode: null,
    description: 'Produto controlado',
    brand: 'Marca segura',
    category: 'Higiene',
    ncm: null,
    cest: null,
    ean: null,
    dun: null,
    packaging: 'Caixa',
    unit: 'UN',
    netWeight: null,
    grossWeight: null,
    width: null,
    height: null,
    depth: null,
    dimensionUnit: null,
    ipiRate: null,
    icmsRate: null,
    pisRate: null,
    cofinsRate: null,
    commissionOverride: null,
  }
}

function catalog() {
  return createProductCatalogService(harness.database, {
    fallbackCommission: '4.250000',
    authenticate,
  })
}

function pricing() {
  return createPricingService({ database: harness.database, authenticate })
}

async function seedProduct() {
  actor = { id: 'admin-a', role: 'admin' }
  const result = await catalog().create({ product: product() })
  if (!result.ok) throw new Error('Expected product creation')
  return result.data
}

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'catalog_rbac_audit',
    migrationNames: ['0001_catalog_pricing.sql', '0002_catalog_audit.sql'],
  })
})

beforeEach(async () => {
  await harness.reset()
  actor = { id: 'admin-a', role: 'admin' }
  industryId = randomUUID()
  await harness.sql`INSERT INTO industries (id, legal_name) VALUES (${industryId}, 'Indústria Teste')`
})

afterAll(async () => { await harness?.close() })

describe('catalog RBAC and audit on PostgreSQL', () => {
  it('denies writes before database changes while allowing role-appropriate reads', async () => {
    actor = { id: 'representative-a', role: 'representative' }
    await expect(catalog().create({ product: product() })).rejects.toBeInstanceOf(CatalogAccessError)
    expect(await harness.database.select().from(products)).toEqual([])
    expect(await harness.database.select().from(catalogAudit)).toEqual([])

    const created = await seedProduct()
    actor = { id: 'representative-a', role: 'representative' }
    await expect(pricing().updatePrice({
      productId: created.id,
      priceListId: created.prices[0]!.priceListId,
      amount: '9.000000',
      expectedVersion: null,
      reason: 'Tentativa sem permissão',
    })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(await harness.database.select().from(productPrices)).toEqual([])
    expect(await harness.database.select().from(productPriceHistory)).toEqual([])
    expect((await harness.database.select().from(catalogAudit)).filter((event) => event.operation === 'price.update')).toEqual([])

    actor = { id: 'reader-a', role: 'read_only' }
    await expect(catalog().detail({ id: created.id })).resolves.toMatchObject({ ok: true })
    await expect(catalog().list({ filters: { status: 'active' } })).resolves.toMatchObject({ ok: true })
    await expect(pricing().getCurrentPrices({ productId: created.id })).resolves.toMatchObject({ ok: true })
    await expect(pricing().getPriceHistory({ productId: created.id, priceListId: created.prices[0]!.priceListId }))
      .rejects.toMatchObject({ code: 'NOT_SUPPORTED', status: 404 })
  })

  it('audits product create, update, and archive with safe before and after details', async () => {
    const created = await seedProduct()
    await catalog().update({ id: created.id, product: { description: 'Produto revisado' } })
    await catalog().archive({ id: created.id, archived: true })

    const events = await harness.database.select().from(catalogAudit)
    expect(events.map((event) => event.operation)).toEqual(['product.create', 'product.update', 'product.archive'])
    expect(events.every((event) => event.actorId === 'admin-a')).toBe(true)
    expect(events.every((event) => event.targetType === 'product' && event.targetId === created.id)).toBe(true)
    expect(events.every((event) => event.occurredAt instanceof Date)).toBe(true)
    expect(events[0]!.beforeState).toBeNull()
    expect(events[0]!.afterState).toMatchObject({ description: 'Produto controlado', isActive: true })
    expect(events[1]!.beforeState).toMatchObject({ description: 'Produto controlado' })
    expect(events[1]!.afterState).toMatchObject({ description: 'Produto revisado' })
    expect(JSON.stringify(events)).not.toContain('createdBy')
    expect(JSON.stringify(events)).not.toContain('updatedBy')
  })

  it('rolls back a product mutation when required audit insertion fails', async () => {
    await harness.database.execute(sql.raw(`
      CREATE FUNCTION fail_catalog_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic catalog audit failure'; END $$;
      CREATE TRIGGER fail_catalog_audit_trg BEFORE INSERT ON catalog_audit
      FOR EACH ROW EXECUTE FUNCTION fail_catalog_audit();
    `))

    const result = await catalog().create({ product: product('ROLLBACK-PRODUCT') })
    expect(result).toMatchObject({ ok: false, error: { category: 'unexpected' } })
    expect(await harness.database.select().from(products)).toEqual([])
  })

  it('derives price-history and audit actors from authentication and rolls both back on audit failure', async () => {
    const created = await seedProduct()
    const list = created.prices[0]!
    actor = { id: 'admin-price', role: 'admin' }
    const updated = await pricing().updatePrice({
      productId: created.id,
      priceListId: list.priceListId,
      amount: '12.345678',
      expectedVersion: null,
      reason: 'Reajuste autorizado',
      actor: 'spoofed-client',
    })
    expect(updated).toMatchObject({ ok: false, error: { category: 'validation' } })

    const createdPrice = await pricing().updatePrice({
      productId: created.id,
      priceListId: list.priceListId,
      amount: '12.345678',
      expectedVersion: null,
      reason: 'Reajuste autorizado',
    })
    expect(createdPrice).toMatchObject({ ok: true })

    const history = await harness.database.select().from(productPriceHistory)
    const audit = (await harness.database.select().from(catalogAudit)).find((event) => event.operation === 'price.update')
    expect(history[0]).toMatchObject({ actor: 'admin-price', reason: 'Reajuste autorizado' })
    expect(audit).toMatchObject({ actorId: 'admin-price', reason: 'Reajuste autorizado' })

    await harness.database.execute(sql.raw(`
      CREATE FUNCTION fail_price_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.operation = 'price.update' THEN RAISE EXCEPTION 'synthetic price audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_price_audit_trg BEFORE INSERT ON catalog_audit
      FOR EACH ROW EXECUTE FUNCTION fail_price_audit();
    `))
    const failed = await pricing().updatePrice({
      productId: created.id,
      priceListId: list.priceListId,
      amount: '20.000000',
      expectedVersion: '1',
      reason: 'Deve reverter',
    })
    expect(failed).toMatchObject({ ok: false, error: { category: 'unexpected' } })
    expect(await harness.database.select({ amount: productPrices.amount, version: productPrices.version }).from(productPrices))
      .toEqual([{ amount: '12.345678', version: 1n }])
    expect(await harness.database.select().from(productPriceHistory)).toHaveLength(1)
  })
})
