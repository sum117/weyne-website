import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const schemaName = `catalog_${randomUUID().replaceAll('-', '')}`
const migrationUrl = new URL('../../drizzle/0001_catalog_pricing.sql', import.meta.url)
let sql: Sql

beforeAll(async () => {
  sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
  await sql.unsafe(`CREATE SCHEMA ${schemaName}`)
  await sql.unsafe(`SET search_path TO ${schemaName}, public`)

  const migration = await readFile(migrationUrl, 'utf8')
  await sql.unsafe(migration)
  await sql.unsafe(migration)
})

afterAll(async () => {
  if (!sql) return
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
  await sql.end()
})

async function createIndustry(name = `Industry ${randomUUID()}`): Promise<string> {
  const id = randomUUID()
  await sql`
    INSERT INTO industries (id, legal_name)
    VALUES (${id}, ${name})
  `
  return id
}

async function createProduct(
  industryId: string,
  overrides: Readonly<Record<string, string | null>> = {},
): Promise<string> {
  const id = randomUUID()
  const internalCode = overrides.internalCode ?? `INT-${randomUUID()}`
  await sql`
    INSERT INTO products (
      id,
      industry_id,
      internal_code,
      manufacturer_code,
      description,
      brand,
      category,
      ncm,
      cest,
      ean,
      dun,
      packaging,
      unit,
      net_weight,
      gross_weight,
      width,
      height,
      depth,
      dimension_unit,
      ipi_rate,
      icms_rate,
      pis_rate,
      cofins_rate,
      commission_override,
      created_by,
      updated_by
    ) VALUES (
      ${id},
      ${industryId},
      ${internalCode},
      ${overrides.manufacturerCode ?? 'MFG-01'},
      ${overrides.description ?? 'Synthetic product'},
      ${overrides.brand ?? 'Synthetic brand'},
      ${overrides.category ?? 'Synthetic category'},
      ${overrides.ncm ?? '1234.56.78'},
      ${overrides.cest ?? '12.345.67'},
      ${overrides.ean ?? null},
      ${overrides.dun ?? null},
      ${overrides.packaging ?? 'Box'},
      ${overrides.unit ?? 'UN'},
      ${overrides.netWeight ?? '1.123456'},
      ${overrides.grossWeight ?? '1.234567'},
      ${overrides.width ?? '10.000001'},
      ${overrides.height ?? '20.000002'},
      ${overrides.depth ?? '30.000003'},
      ${'dimensionUnit' in overrides ? overrides.dimensionUnit : 'cm'},
      ${overrides.ipiRate ?? '5.123456'},
      ${overrides.icmsRate ?? '18.000000'},
      ${overrides.pisRate ?? '1.650000'},
      ${overrides.cofinsRate ?? '7.600000'},
      ${overrides.commissionOverride ?? '3.333333'},
      'integration-test',
      'integration-test'
    )
  `
  return id
}

describe('catalog and pricing migration', () => {
  it('seeds exactly four immutable canonical price lists idempotently', async () => {
    const lists = await sql<{
      key: string
      position: number
      displayName: string
    }[]>`
      SELECT key, position, display_name AS "displayName"
      FROM price_lists
      ORDER BY position
    `

    expect(lists).toEqual([
      { key: 'PRICE_1', position: 1, displayName: 'Preço 1' },
      { key: 'PRICE_2', position: 2, displayName: 'Preço 2' },
      { key: 'PRICE_3', position: 3, displayName: 'Preço 3' },
      { key: 'PRICE_4', position: 4, displayName: 'Preço 4' },
    ])

    await expect(
      sql`INSERT INTO price_lists (key, display_name, position) VALUES ('PRICE_5', 'Preço 5', 5)`,
    ).rejects.toThrow()
    await expect(sql`DELETE FROM price_lists WHERE key = 'PRICE_1'`).rejects.toThrow(
      /hard delete/i,
    )
  })

  it('stores every Decimal-compatible value as fixed-precision numeric without fidelity loss', async () => {
    const industryId = await createIndustry()
    const productId = await createProduct(industryId, {
      netWeight: '123456789012.123456',
      commissionOverride: '99.999999',
    })
    const priceList = await sql<{ id: string }[]>`
      SELECT id FROM price_lists WHERE key = 'PRICE_1'
    `

    await sql`SELECT set_config('app.actor', 'decimal-test', false)`
    await sql`SELECT set_config('app.price_change_reason', 'Initial precision test', false)`
    await sql`
      INSERT INTO product_prices (product_id, price_list_id, amount, updated_by)
      VALUES (${productId}, ${priceList[0]!.id}, '1234567890123.123456', 'decimal-test')
    `

    const values = await sql<{
      netWeight: string
      commissionOverride: string
      amount: string
    }[]>`
      SELECT
        p.net_weight AS "netWeight",
        p.commission_override AS "commissionOverride",
        pp.amount
      FROM products p
      JOIN product_prices pp ON pp.product_id = p.id
      WHERE p.id = ${productId}
    `

    expect(values[0]).toEqual({
      netWeight: '123456789012.123456',
      commissionOverride: '99.999999',
      amount: '1234567890123.123456',
    })

    const numericColumns = await sql<{ columnName: string; dataType: string }[]>`
      SELECT column_name AS "columnName", data_type AS "dataType"
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
        AND table_name IN ('products', 'product_prices', 'product_price_history')
        AND column_name IN (
          'amount', 'old_amount', 'new_amount', 'net_weight', 'gross_weight',
          'width', 'height', 'depth', 'ipi_rate', 'icms_rate', 'pis_rate',
          'cofins_rate', 'commission_override'
        )
    `
    expect(new Set(numericColumns.map((column) => column.dataType))).toEqual(
      new Set(['numeric']),
    )
  })

  it('normalizes searchable codes while preserving display values and global product identity', async () => {
    const industryId = await createIndustry()
    const productId = await createProduct(industryId, {
      internalCode: ' ab-12.ç/3 ',
      manufacturerCode: ' Fab 99-x ',
      ean: '789-123 456',
      dun: '1.23/45',
    })

    const codes = await sql<{
      internalCode: string
      internalCodeNormalized: string
      manufacturerCodeNormalized: string
      ncmNormalized: string
      cestNormalized: string
      eanNormalized: string
      dunNormalized: string
    }[]>`
      SELECT
        internal_code AS "internalCode",
        internal_code_normalized AS "internalCodeNormalized",
        manufacturer_code_normalized AS "manufacturerCodeNormalized",
        ncm_normalized AS "ncmNormalized",
        cest_normalized AS "cestNormalized",
        ean_normalized AS "eanNormalized",
        dun_normalized AS "dunNormalized"
      FROM products
      WHERE id = ${productId}
    `

    expect(codes[0]).toEqual({
      internalCode: 'ab-12.ç/3',
      internalCodeNormalized: 'AB123',
      manufacturerCodeNormalized: 'FAB99X',
      ncmNormalized: '12345678',
      cestNormalized: '1234567',
      eanNormalized: '789123456',
      dunNormalized: '12345',
    })

    await expect(
      createProduct(industryId, { internalCode: 'AB 12-3' }),
    ).rejects.toThrow()
  })

  it('enforces product checks, archive state, and restrict-only relationships', async () => {
    const industryId = await createIndustry()
    const productId = await createProduct(industryId)

    await expect(
      createProduct(industryId, { internalCode: 'NEG-TAX', ipiRate: '100.000001' }),
    ).rejects.toThrow()
    await expect(
      createProduct(industryId, {
        internalCode: 'DIM-NO-UNIT',
        dimensionUnit: null,
      }),
    ).rejects.toThrow()

    await sql`
      UPDATE products
      SET archived_at = clock_timestamp(), archived_by = 'integration-test'
      WHERE id = ${productId}
    `
    const state = await sql<{ isActive: boolean }[]>`
      SELECT is_active AS "isActive" FROM products WHERE id = ${productId}
    `
    expect(state[0]!.isActive).toBe(false)

    await expect(sql`DELETE FROM industries WHERE id = ${industryId}`).rejects.toThrow()
    await expect(sql`DELETE FROM products WHERE id = ${productId}`).rejects.toThrow(
      /hard delete/i,
    )

    const destructiveForeignKeys = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${schemaName}
        AND c.contype = 'f'
        AND c.confdeltype = 'c'
    `
    expect(destructiveForeignKeys[0]!.count).toBe('0')
  })

  it('records required actor/reason price history and keeps it append-only', async () => {
    const industryId = await createIndustry()
    const productId = await createProduct(industryId)
    const priceList = await sql<{ id: string }[]>`
      SELECT id FROM price_lists WHERE key = 'PRICE_2'
    `

    await sql`SELECT set_config('app.actor', '', false)`
    await sql`SELECT set_config('app.price_change_reason', '', false)`
    await expect(
      sql`
        INSERT INTO product_prices (product_id, price_list_id, amount, updated_by)
        VALUES (${productId}, ${priceList[0]!.id}, '10.000001', 'ignored')
      `,
    ).rejects.toThrow(/actor/i)

    await sql`SELECT set_config('app.actor', 'user:price-admin', false)`
    await sql`SELECT set_config('app.price_change_reason', 'Initial catalog load', false)`
    const current = await sql<{ id: string }[]>`
      INSERT INTO product_prices (product_id, price_list_id, amount, updated_by)
      VALUES (${productId}, ${priceList[0]!.id}, '10.000001', 'user:price-admin')
      RETURNING id
    `

    await sql`SELECT set_config('app.price_change_reason', 'Supplier adjustment', false)`
    await sql`
      UPDATE product_prices
      SET amount = '10.123456'
      WHERE id = ${current[0]!.id}
    `
    await sql`
      UPDATE product_prices
      SET amount = '10.123456'
      WHERE id = ${current[0]!.id}
    `

    const history = await sql<{
      oldAmount: string | null
      newAmount: string
      actor: string
      reason: string
    }[]>`
      SELECT
        old_amount AS "oldAmount",
        new_amount AS "newAmount",
        actor,
        reason
      FROM product_price_history
      WHERE product_price_id = ${current[0]!.id}
      ORDER BY changed_at, id
    `
    expect(history).toEqual([
      {
        oldAmount: null,
        newAmount: '10.000001',
        actor: 'user:price-admin',
        reason: 'Initial catalog load',
      },
      {
        oldAmount: '10.000001',
        newAmount: '10.123456',
        actor: 'user:price-admin',
        reason: 'Supplier adjustment',
      },
    ])

    await expect(
      sql`UPDATE product_price_history SET reason = 'rewritten' WHERE product_price_id = ${current[0]!.id}`,
    ).rejects.toThrow(/append-only/i)
    await expect(
      sql`DELETE FROM product_price_history WHERE product_price_id = ${current[0]!.id}`,
    ).rejects.toThrow(/append-only/i)
    await expect(
      sql`DELETE FROM product_prices WHERE id = ${current[0]!.id}`,
    ).rejects.toThrow(/hard delete/i)
  })

  it('creates active-list, facet, code, and stable history indexes', async () => {
    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = ${schemaName}
    `
    const names = new Set(indexes.map((index) => index.indexname))

    for (const requiredIndex of [
      'products_active_list_idx',
      'products_active_brand_idx',
      'products_active_industry_idx',
      'products_active_category_idx',
      'products_internal_code_normalized_uidx',
      'products_manufacturer_code_normalized_idx',
      'products_ncm_normalized_idx',
      'products_cest_normalized_idx',
      'product_prices_product_idx',
      'product_price_history_lookup_idx',
    ]) {
      expect(names.has(requiredIndex), requiredIndex).toBe(true)
    }
  })
})
