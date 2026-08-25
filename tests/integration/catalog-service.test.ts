import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '@/lib/db/schema'
import { createProductCatalogService } from '@/features/app/products/catalog.service.server'
import type { CatalogActor } from '@/lib/catalog/authorization.server'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const schemaName = `catalog_service_${randomUUID().replaceAll('-', '')}`
const migrationUrl = new URL('../../drizzle/0001_catalog_pricing.sql', import.meta.url)
const auditMigrationUrl = new URL('../../drizzle/0002_catalog_audit.sql', import.meta.url)
const actor: CatalogActor = { id: 'user:catalog-admin', role: 'admin' }
let sql: Sql
let service: ReturnType<typeof createProductCatalogService>
let industryId: string

beforeAll(async () => {
  sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
  await sql.unsafe(`CREATE SCHEMA ${schemaName}`)
  await sql.unsafe(`SET search_path TO ${schemaName}, public`)
  await sql.unsafe(await readFile(migrationUrl, 'utf8'))
  await sql.unsafe(await readFile(auditMigrationUrl, 'utf8'))
  const rows = await sql<{ id: string }[]>`
    INSERT INTO industries (legal_name) VALUES ('Indústria Teste') RETURNING id
  `
  industryId = rows[0]!.id
  service = createProductCatalogService(drizzle(sql, { schema }), {
    fallbackCommission: '4.250000',
    authenticate: async () => actor,
  })
})

afterAll(async () => {
  if (!sql) return
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
  await sql.end()
})

describe('product catalog service', () => {
  it('validates and creates a product while preserving display codes', async () => {
    const created = await service.create({
      product: {
        industryId,
        internalCode: ' ab-12.ç/3 ',
        manufacturerCode: ' Fab 99-x ',
        description: '  Detergente concentrado  ',
        brand: 'Marca Azul',
        category: 'Higiene',
        ncm: '1234.56.78',
        cest: '12.345.67',
        ean: '789-123 456',
        dun: null,
        packaging: 'Caixa',
        unit: 'UN',
        netWeight: '1.123456',
        grossWeight: '1.234567',
        width: '10.000001',
        height: '20.000002',
        depth: '30.000003',
        dimensionUnit: 'cm',
        ipiRate: '5.123456',
        icmsRate: '18.000000',
        pisRate: '1.650000',
        cofinsRate: '7.600000',
        commissionOverride: null,
      },
    })

    if (!created.ok) {
      if (created.error.category === 'unexpected') throw created.error.cause
      throw new Error(JSON.stringify(created.error))
    }
    expect(created.data.internalCode).toBe('ab-12.ç/3')
    expect(created.data.internalCodeNormalized).toBe('AB123')
    expect(created.data.manufacturerCode).toBe('Fab 99-x')
    expect(created.data.manufacturerCodeNormalized).toBe('FAB99X')
    expect(created.data.description).toBe('Detergente concentrado')
    expect(created.data.netWeight).toBe('1.123456')
    expect(created.data.prices).toHaveLength(4)
    expect(created.data.prices.map((price) => price.key)).toEqual([
      'PRICE_1',
      'PRICE_2',
      'PRICE_3',
      'PRICE_4',
    ])
    expect(created.data.prices.every((price) => price.amount === null)).toBe(true)
    expect(created.data.effectiveCommission).toEqual({
      rate: '4.250000',
      source: 'fallback',
    })
  })

  it('rejects invalid Decimal, packaging, code, dimension, and media input', async () => {
    const invalid = await service.create({
      product: {
        industryId,
        internalCode: '---',
        manufacturerCode: null,
        description: 'Produto inválido',
        brand: null,
        category: null,
        ncm: null,
        cest: null,
        ean: null,
        dun: null,
        packaging: '',
        unit: '',
        netWeight: '-0.1',
        grossWeight: null,
        width: '1.000000',
        height: null,
        depth: null,
        dimensionUnit: null,
        ipiRate: '100.000001',
        icmsRate: null,
        pisRate: null,
        cofinsRate: null,
        commissionOverride: null,
        media: [],
      },
    })

    expect(invalid).toMatchObject({ ok: false, error: { category: 'validation' } })
    if (invalid.ok || invalid.error.category !== 'validation') return
    const paths = invalid.error.issues.map((issue) => issue.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining([
      'product.internalCode',
      'product.packaging',
      'product.unit',
      'product.netWeight',
      'product.ipiRate',
      'product',
    ]))

    const missingDimensionUnit = await service.create({
      product: {
        industryId,
        internalCode: `DIM-${randomUUID()}`,
        manufacturerCode: null,
        description: 'Dimensão sem unidade',
        brand: null,
        category: null,
        ncm: null,
        cest: null,
        ean: null,
        dun: null,
        packaging: null,
        unit: 'UN',
        netWeight: null,
        grossWeight: null,
        width: '1.000000',
        height: null,
        depth: null,
        dimensionUnit: null,
        ipiRate: null,
        icmsRate: null,
        pisRate: null,
        cofinsRate: null,
        commissionOverride: null,
      },
    })
    expect(missingDimensionUnit).toMatchObject({
      ok: false,
      error: { category: 'validation', issues: [{ path: ['product', 'dimensionUnit'] }] },
    })
  })

  it('patches only supplied fields and applies product commission precedence', async () => {
    const created = await service.create({
      product: {
        industryId,
        internalCode: `PATCH-${randomUUID()}`,
        manufacturerCode: 'KEEP-001',
        description: 'Descrição original',
        brand: 'Marca original',
        category: 'Categoria original',
        ncm: null,
        cest: null,
        ean: null,
        dun: null,
        packaging: 'Caixa',
        unit: 'CX',
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
      },
    })
    if (!created.ok) throw new Error(JSON.stringify(created.error))

    const updated = await service.update({
      id: created.data.id,
      product: { description: 'Descrição revisada', commissionOverride: '6.500000' },
    })

    expect(updated).toMatchObject({ ok: true })
    if (!updated.ok) return
    expect(updated.data.description).toBe('Descrição revisada')
    expect(updated.data.manufacturerCode).toBe('KEEP-001')
    expect(updated.data.brand).toBe('Marca original')
    expect(updated.data.effectiveCommission).toEqual({ rate: '6.500000', source: 'product' })

    const invalidDimensions = await service.update({
      id: created.data.id,
      product: { width: '2.000000' },
    })
    expect(invalidDimensions).toMatchObject({ ok: false, error: { category: 'validation' } })
  })

  it('projects exact current prices for all four lists', async () => {
    const created = await service.create({
      product: {
        industryId,
        internalCode: `PRICE-${randomUUID()}`,
        manufacturerCode: null,
        description: 'Produto com preços',
        brand: null,
        category: null,
        ncm: null,
        cest: null,
        ean: null,
        dun: null,
        packaging: null,
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
      },
    })
    if (!created.ok) throw new Error(JSON.stringify(created.error))
    await sql`SELECT set_config('app.actor', 'user:price-admin', false)`
    await sql`SELECT set_config('app.price_change_reason', 'Carga inicial', false)`
    await sql`
      INSERT INTO product_prices (product_id, price_list_id, amount, updated_by)
      SELECT ${created.data.id}, id, (position * 10)::numeric + 0.123456, 'user:price-admin'
      FROM price_lists
    `

    const detail = await service.detail({ id: created.data.id })

    expect(detail).toMatchObject({ ok: true })
    if (!detail.ok) return
    expect(detail.data.prices.map((price) => price.amount)).toEqual([
      '10.123456',
      '20.123456',
      '30.123456',
      '40.123456',
    ])
    expect(JSON.stringify(detail.data)).not.toContain('10.123455999')
  })

  it('searches normalized identifiers, returns facets, paginates deterministically, and controls archived visibility', async () => {
    const created = await service.create({
      product: {
        industryId,
        internalCode: `FACET-${randomUUID()}`,
        manufacturerCode: 'SEARCH-99.X',
        description: 'Produto facetado',
        brand: 'Marca Faceta',
        category: 'Categoria Faceta',
        ncm: '8765.43.21',
        cest: '98.765.43',
        ean: null,
        dun: null,
        packaging: null,
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
      },
    })
    if (!created.ok) throw new Error(JSON.stringify(created.error))

    const searched = await service.list({
      limit: 1,
      filters: { identifier: 'search 99x', status: 'active' },
      sortBy: 'internalCode',
      sortDirection: 'asc',
    })
    expect(searched).toMatchObject({
      ok: true,
      data: {
        items: [{ id: created.data.id }],
        facets: {
          brands: [{ value: 'Marca Faceta', count: 1 }],
          categories: [{ value: 'Categoria Faceta', count: 1 }],
          ncm: [{ value: '8765.43.21', count: 1 }],
          cest: [{ value: '98.765.43', count: 1 }],
        },
      },
    })

    const firstPage = await service.list({
      limit: 1,
      filters: { status: 'active' },
      sortBy: 'internalCode',
      sortDirection: 'asc',
    })
    expect(firstPage).toMatchObject({ ok: true, data: { pageInfo: { hasNextPage: true } } })
    if (!firstPage.ok || firstPage.data.pageInfo.nextCursor === null) return
    const secondPage = await service.list({
      cursor: firstPage.data.pageInfo.nextCursor,
      limit: 1,
      filters: { status: 'active' },
      sortBy: 'internalCode',
      sortDirection: 'asc',
    })
    expect(secondPage).toMatchObject({ ok: true })
    if (!secondPage.ok) return
    expect(secondPage.data.items[0]?.id).not.toBe(firstPage.data.items[0]?.id)

    const archived = await service.archive({ id: created.data.id, archived: true })
    expect(archived).toMatchObject({ ok: true, data: { isActive: false } })
    const activeOnly = await service.list({ filters: { identifier: 'search99x', status: 'active' } })
    expect(activeOnly).toMatchObject({ ok: true, data: { items: [] } })
    const archivedOnly = await service.list({ filters: { identifier: 'search99x', status: 'archived' } })
    expect(archivedOnly).toMatchObject({ ok: true, data: { items: [{ id: created.data.id }] } })
    const restored = await service.archive({ id: created.data.id, archived: false })
    expect(restored).toMatchObject({ ok: true, data: { isActive: true, archivedAt: null } })
  })
})
