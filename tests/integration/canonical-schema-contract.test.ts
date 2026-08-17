import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import postgres, { type Sql, type TransactionSql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import * as canonical from '@/lib/db/schema/canonical'
import { resolveTestDatabaseUrl } from '../support/postgres-harness'

const TABLES = [
  canonical.users,
  canonical.sessions,
  canonical.accounts,
  canonical.verifications,
  canonical.representatives,
  canonical.customers,
  canonical.industries,
  canonical.carriers,
  canonical.products,
  canonical.productAssets,
  canonical.priceLists,
  canonical.productPrices,
  canonical.commissionRules,
  canonical.quotes,
  canonical.quoteLines,
  canonical.orders,
  canonical.orderLines,
  canonical.quoteEvents,
  canonical.orderEvents,
  canonical.attachments,
  canonical.recordAssignments,
  canonical.idempotencyRecords,
  canonical.documentSequences,
  canonical.settings,
  canonical.auditEvents,
] as readonly PgTable[]

const EXPECTED_PRICE_LISTS = [
  { id: '00000000-0000-4000-8000-000000000001', key: 'PRICE_1', displayName: 'Preço 1', position: 1 },
  { id: '00000000-0000-4000-8000-000000000002', key: 'PRICE_2', displayName: 'Preço 2', position: 2 },
  { id: '00000000-0000-4000-8000-000000000003', key: 'PRICE_3', displayName: 'Preço 3', position: 3 },
  { id: '00000000-0000-4000-8000-000000000004', key: 'PRICE_4', displayName: 'Preço 4', position: 4 },
] as const

const baseDatabaseUrl = resolveTestDatabaseUrl(process.env)
const isolatedDatabaseName = `canonical_contract_${randomUUID().replaceAll('-', '')}`
const isolatedDatabaseUrl = new URL(baseDatabaseUrl)
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`
const administrativeClient = postgres(baseDatabaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: () => undefined,
})
let harness: Readonly<{ sql: Sql }>

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

async function applyCanonicalMigrations(client: Sql): Promise<void> {
  const directory = resolve(process.cwd(), 'drizzle/canonical')
  const migrationNames = (await readdir(directory))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  expect(migrationNames).toEqual([
    '0000_canonical_schema.sql',
    '0001_canonical_invariants.sql',
  ])
  for (const migrationName of migrationNames) {
    await client.unsafe(await readFile(resolve(directory, migrationName), 'utf8'))
  }
}

beforeAll(async () => {
  await administrativeClient.unsafe(`CREATE DATABASE ${quoteIdentifier(isolatedDatabaseName)}`)
  const client = postgres(isolatedDatabaseUrl.toString(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  })
  harness = Object.freeze({ sql: client })
})

beforeEach(async () => {
  await harness.sql`DROP SCHEMA public CASCADE`
  await harness.sql`CREATE SCHEMA public`
  await applyCanonicalMigrations(harness.sql)
})

afterAll(async () => {
  try {
    await harness?.sql.end({ timeout: 5 })
  } finally {
    try {
      await administrativeClient.unsafe(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(isolatedDatabaseName)} WITH (FORCE)`,
      )
    } finally {
      await administrativeClient.end({ timeout: 5 })
    }
  }
})

async function createMasterData() {
  const userId = randomUUID()
  const representativeId = randomUUID()
  const customerId = randomUUID()
  const industryId = randomUUID()
  const productId = randomUUID()
  const productPriceId = randomUUID()

  await harness.sql`
    INSERT INTO users (id, name, email, role, auth_subject)
    VALUES (${userId}, 'Usuário de contrato', ${`contract-${userId}@example.test`}, 'admin', ${`subject-${userId}`})
  `
  await harness.sql`
    INSERT INTO representatives (
      id, user_id, display_name, created_by_user_id, updated_by_user_id
    ) VALUES (
      ${representativeId}, ${userId}, 'Representante original', ${userId}, ${userId}
    )
  `
  await harness.sql`
    INSERT INTO customers (
      id, legal_name, trade_name, tax_id, credit_limit, currency_code,
      responsible_representative_id, created_by_user_id, updated_by_user_id
    ) VALUES (
      ${customerId}, 'Cliente original LTDA', 'Cliente original', '12345678000199',
      1000.00, 'BRL', ${representativeId}, ${userId}, ${userId}
    )
  `
  await harness.sql`
    INSERT INTO industries (
      id, legal_name, trade_name, created_by_user_id, updated_by_user_id
    ) VALUES (
      ${industryId}, 'Indústria original LTDA', 'Indústria original', ${userId}, ${userId}
    )
  `
  await harness.sql`
    INSERT INTO products (
      id, industry_id, internal_code, manufacturer_code, description, brand,
      packaging, unit, net_weight, ipi_rate, created_by_user_id, updated_by_user_id
    ) VALUES (
      ${productId}, ${industryId}, ${`PROD-${productId}`}, 'FAB-ORIGINAL',
      'Produto original', 'Marca original', 'Caixa', 'UN', 1.250000, 5.000000,
      ${userId}, ${userId}
    )
  `
  await harness.sql`
    INSERT INTO product_prices (
      id, product_id, price_list_id, amount, valid_from, created_by_user_id, reason
    ) VALUES (
      ${productPriceId}, ${productId}, ${EXPECTED_PRICE_LISTS[0].id}, 12.345678,
      '2026-01-01T00:00:00Z', ${userId}, 'Preço inicial'
    )
  `

  return { userId, representativeId, customerId, industryId, productId, productPriceId }
}

function normalizeType(value: string): string {
  return value.replace('character(', 'char(').replaceAll(' ', '')
}

async function insertQuote(
  data: Awaited<ReturnType<typeof createMasterData>>,
  quoteId = randomUUID(),
) {
  await harness.sql`
    INSERT INTO quotes (
      id, number, customer_id, representative_id, price_list_id, valid_until,
      customer_legal_name_snapshot, customer_trade_name_snapshot, customer_tax_id_snapshot,
      customer_address_snapshot, representative_name_snapshot, price_list_key_snapshot,
      price_list_name_snapshot, gross_amount, line_discount_amount,
      net_after_line_discount_amount, overall_discount_amount, net_merchandise_amount,
      tax_totals_snapshot, freight_amount, grand_total_amount, commission_basis_amount,
      commission_value_amount, created_by_user_id, updated_by_user_id
    ) VALUES (
      ${quoteId}, 'ORC-2026-000001',
      ${data.customerId}, ${data.representativeId}, ${EXPECTED_PRICE_LISTS[0].id}, '2026-12-31',
      'Cliente original LTDA', 'Cliente original', '12345678000199', NULL,
      'Representante original', 'PRICE_1', 'Preço 1', 24.69, 0, 24.69, 0, 24.69,
      '[]'::jsonb, 0, 24.69, 24.69, 0, ${data.userId}, ${data.userId}
    )
  `
  return quoteId
}

async function insertQuoteLine(
  data: Awaited<ReturnType<typeof createMasterData>>,
  quoteId: string,
  quoteLineId = randomUUID(),
) {
  await harness.sql`
    INSERT INTO quote_lines (
      id, quote_id, position, product_id, product_price_id, price_source,
      product_code_snapshot, product_description_snapshot, manufacturer_code_snapshot,
      brand_snapshot, packaging_snapshot, unit_snapshot, industry_id_snapshot,
      industry_name_snapshot, price_list_id_snapshot, price_list_key_snapshot,
      price_list_name_snapshot, unit_price_snapshot, quantity, line_discount_rate,
      gross_amount_snapshot, line_discount_amount_snapshot, net_after_line_discount_amount_snapshot,
      overall_discount_allocation_amount_snapshot, net_merchandise_amount_snapshot, taxes_snapshot,
      ipi_rate_snapshot, commission_source_snapshot, commission_basis_amount_snapshot,
      created_by_user_id, updated_by_user_id
    ) VALUES (
      ${quoteLineId}, ${quoteId}, 1, ${data.productId}, ${data.productPriceId}, 'price_list',
      ${`PROD-${data.productId}`}, 'Produto original', 'FAB-ORIGINAL', 'Marca original',
      'Caixa', 'UN', ${data.industryId}, 'Indústria original LTDA',
      ${EXPECTED_PRICE_LISTS[0].id}, 'PRICE_1', 'Preço 1', 12.345678, 2.000000, 0,
      24.69, 0, 24.69, 0, 24.69, '[]'::jsonb, 5.000000, 'none', 24.69,
      ${data.userId}, ${data.userId}
    )
  `
  return quoteLineId
}

describe('canonical schema on real PostgreSQL', () => {
  it('migrates an empty isolated schema with every declared column, type, default, key, constraint, foreign key, and index', async () => {
    const actualTables = await harness.sql<{ tableName: string }[]>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `
    const expectedTableNames = TABLES.map((table) => getTableConfig(table).name).sort()
    expect(actualTables.map((row) => row.tableName)).toEqual(expectedTableNames)

    const actualColumns = await harness.sql<{
      tableName: string
      columnName: string
      sqlType: string
      nullable: boolean
      hasDefault: boolean
    }[]>`
      SELECT c.relname AS "tableName",
             a.attname AS "columnName",
             format_type(a.atttypid, a.atttypmod) AS "sqlType",
             NOT a.attnotnull AS nullable,
             ad.adbin IS NOT NULL AS "hasDefault"
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE n.nspname = current_schema() AND c.relkind = 'r'
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum
    `
    const expectedColumns = TABLES.flatMap((table) => {
      const config = getTableConfig(table)
      return config.columns.map((column) => ({
        tableName: config.name,
        columnName: column.name,
        sqlType: normalizeType(column.getSQLType()),
        nullable: !column.notNull,
        hasDefault: column.hasDefault,
      }))
    }).sort((left, right) => left.tableName.localeCompare(right.tableName))
    expect(actualColumns.map((column) => ({
      ...column,
      sqlType: normalizeType(column.sqlType),
    }))).toEqual(expectedColumns)

    const primaryKeys = await harness.sql<{ tableName: string; columns: string[] }[]>`
      SELECT c.relname AS "tableName",
             array_agg(a.attname ORDER BY key.ordinality)::text[] AS columns
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key.attnum
      WHERE n.nspname = current_schema() AND con.contype = 'p'
      GROUP BY c.relname
      ORDER BY c.relname
    `
    expect(primaryKeys).toEqual([
      ...expectedTableNames
        .filter((name) => name !== 'document_sequences')
        .map((tableName) => ({ tableName, columns: ['id'] })),
      { tableName: 'document_sequences', columns: ['document_type', 'year'] },
    ].sort((left, right) => left.tableName.localeCompare(right.tableName)))

    const constraints = await harness.sql<{ name: string; type: string; deleteAction: string }[]>`
      SELECT con.conname AS name,
             con.contype::text AS type,
             CASE con.confdeltype
               WHEN 'a' THEN 'no action'
               WHEN 'r' THEN 'restrict'
               WHEN 'c' THEN 'cascade'
               WHEN 'n' THEN 'set null'
               WHEN 'd' THEN 'set default'
               ELSE ''
             END AS "deleteAction"
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
    `
    const constraintNames = constraints.map((row) => row.name).sort()
    const declaredConstraintNames = TABLES.flatMap((table) => {
      const config = getTableConfig(table)
      return [
        ...config.checks.map((constraint) => constraint.name),
        ...config.uniqueConstraints.map((constraint) => constraint.name),
        ...config.primaryKeys.map((constraint) => constraint.getName()),
        ...config.foreignKeys.map((constraint) => constraint.getName()),
      ]
    })
    const generatedPrimaryKeyNames = expectedTableNames
      .filter((name) => name !== 'document_sequences')
      .map((name) => `${name}_pkey`)
    expect(constraintNames).toEqual([
      ...declaredConstraintNames,
      ...generatedPrimaryKeyNames,
      'price_lists_display_name_ck',
      'product_prices_no_overlapping_validity',
      'commission_rules_no_overlapping_industry_validity',
      'commission_rules_no_overlapping_product_validity',
      'quotes_conversion_pair_trg',
      'orders_conversion_pair_trg',
    ].sort())

    const expectedForeignKeyActions = TABLES.flatMap((table) =>
      getTableConfig(table).foreignKeys.map((foreignKey) => ({
        name: foreignKey.getName(),
        deleteAction: foreignKey.onDelete ?? 'no action',
      })),
    ).sort((left, right) => left.name.localeCompare(right.name))
    expect(constraints
      .filter((constraint) => constraint.type === 'f')
      .map(({ name, deleteAction }) => ({ name, deleteAction }))
      .sort((left, right) => left.name.localeCompare(right.name)))
      .toEqual(expectedForeignKeyActions)

    const indexNames = new Set((await harness.sql<{ name: string }[]>`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = current_schema()
    `).map((row) => row.name))
    const declaredIndexNames = TABLES.flatMap((table) =>
      getTableConfig(table).indexes.map((index) => index.config.name),
    )
    expect([...indexNames]).toEqual(expect.arrayContaining(declaredIndexNames))

    const defaults = await harness.sql<{ tableName: string; columnName: string; expression: string }[]>`
      SELECT c.relname AS "tableName", a.attname AS "columnName",
             pg_get_expr(ad.adbin, ad.adrelid) AS expression
      FROM pg_attrdef ad
      JOIN pg_class c ON c.oid = ad.adrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ad.adnum
      WHERE n.nspname = current_schema()
    `
    expect(defaults).toEqual(expect.arrayContaining([
      { tableName: 'users', columnName: 'id', expression: 'gen_random_uuid()' },
      { tableName: 'users', columnName: 'email_verified', expression: 'false' },
      { tableName: 'quotes', columnName: 'status', expression: "'draft'::quote_status" },
      { tableName: 'orders', columnName: 'status', expression: "'open'::order_status" },
      { tableName: 'product_prices', columnName: 'currency_code', expression: "'BRL'::bpchar" },
      { tableName: 'document_sequences', columnName: 'next_value', expression: '1' },
      { tableName: 'settings', columnName: 'version', expression: '1' },
    ]))

    const triggerNames = (await harness.sql<{ name: string }[]>`
      SELECT tg.tgname AS name
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND NOT tg.tgisinternal
    `).map((row) => row.name)
    expect(triggerNames).toEqual(expect.arrayContaining([
      'representatives_prevent_hard_delete_trg',
      'customers_prevent_hard_delete_trg',
      'industries_prevent_hard_delete_trg',
      'carriers_prevent_hard_delete_trg',
      'products_prevent_hard_delete_trg',
      'product_assets_prevent_hard_delete_trg',
      'attachments_prevent_hard_delete_trg',
      'product_prices_protect_version_row_trg',
      'order_lines_append_only_row_trg',
    ]))
  })

  it('supports the Better Auth persistence shape, defaults, uniqueness, and user-owned cascade cleanup', async () => {
    const userId = randomUUID()
    const sessionId = randomUUID()
    const accountId = randomUUID()
    const verificationId = randomUUID()

    const [user] = await harness.sql<{ emailVerified: boolean; createdAt: Date; updatedAt: Date }[]>`
      INSERT INTO users (id, name, email, role, auth_subject)
      VALUES (${userId}, 'Auth User', 'auth@example.test', 'representative', 'auth-subject')
      RETURNING email_verified AS "emailVerified", created_at AS "createdAt", updated_at AS "updatedAt"
    `
    expect(user).toEqual({ emailVerified: false, createdAt: expect.any(Date), updatedAt: expect.any(Date) })

    await harness.sql`
      INSERT INTO sessions (id, token, user_id, expires_at)
      VALUES (${sessionId}, 'session-token', ${userId}, now() + interval '1 hour')
    `
    await harness.sql`
      INSERT INTO accounts (id, account_id, provider_id, user_id, password)
      VALUES (${accountId}, 'provider-account', 'credential', ${userId}, 'password-hash')
    `
    await harness.sql`
      INSERT INTO verifications (id, identifier, value, expires_at)
      VALUES (${verificationId}, 'auth@example.test', 'verification-value', now() + interval '10 minutes')
    `
    await expect(harness.sql`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES ('session-token', ${userId}, now() + interval '1 hour')
    `).rejects.toMatchObject({ code: '23505' })
    await expect(harness.sql`
      INSERT INTO accounts (account_id, provider_id, user_id)
      VALUES ('provider-account', 'credential', ${userId})
    `).rejects.toMatchObject({ code: '23505' })

    await harness.sql`DELETE FROM users WHERE id = ${userId}`
    const [ownedRows] = await harness.sql<{ sessions: number; accounts: number; verifications: number }[]>`
      SELECT
        (SELECT count(*)::integer FROM sessions WHERE user_id = ${userId}) AS sessions,
        (SELECT count(*)::integer FROM accounts WHERE user_id = ${userId}) AS accounts,
        (SELECT count(*)::integer FROM verifications WHERE id = ${verificationId}) AS verifications
    `
    expect(ownedRows).toEqual({ sessions: 0, accounts: 0, verifications: 1 })
  })

  it('seeds exactly four stable price-list definitions and protects their canonical set', async () => {
    const rows = await harness.sql<{
      id: string
      key: string
      displayName: string
      position: number
    }[]>`
      SELECT id, key::text, display_name AS "displayName", position
      FROM price_lists
      ORDER BY position
    `
    expect(rows).toEqual(EXPECTED_PRICE_LISTS)
    await expect(harness.sql`DELETE FROM price_lists WHERE key = 'PRICE_1'`).rejects.toThrow(/permanent/i)
    await expect(harness.sql`
      INSERT INTO price_lists (id, key, display_name, position)
      VALUES (${randomUUID()}, 'PRICE_1', 'Duplicada', 1)
    `).rejects.toThrow(/stable identifier|duplicate/i)
    await expect(harness.sql`
      UPDATE price_lists SET position = 4 WHERE key = 'PRICE_1'
    `).rejects.toThrow(/identity is immutable/i)
  })

  it('enforces document-counter uniqueness, boundaries, and gap-free allocation semantics', async () => {
    await harness.sql`
      INSERT INTO document_sequences (document_type, year)
      VALUES ('quote', 2026), ('order', 2026)
    `
    const clients = [
      postgres(isolatedDatabaseUrl.toString(), {
        max: 1,
        prepare: false,
        connect_timeout: 10,
        idle_timeout: 5,
        onnotice: () => undefined,
      }),
      postgres(isolatedDatabaseUrl.toString(), {
        max: 1,
        prepare: false,
        connect_timeout: 10,
        idle_timeout: 5,
        onnotice: () => undefined,
      }),
    ]
    const allocate = async (
      client: Sql | TransactionSql,
      documentType: 'quote' | 'order',
    ) => {
      const [row] = await client<{ allocated: number }[]>`
        UPDATE document_sequences
        SET next_value = next_value + 1, updated_at = clock_timestamp()
        WHERE document_type = ${documentType} AND year = 2026
        RETURNING next_value - 1 AS allocated
      `
      return row!.allocated
    }
    try {
      await expect(clients[0]!.begin(async (transaction) => {
        expect(await allocate(transaction, 'quote')).toBe(1)
        throw new Error('rollback allocation')
      })).rejects.toThrow('rollback allocation')
      const concurrent = await Promise.all([
        allocate(clients[0]!, 'quote'),
        allocate(clients[1]!, 'quote'),
      ])
      expect(concurrent.sort()).toEqual([1, 2])
      expect(await allocate(clients[0]!, 'order')).toBe(1)
    } finally {
      await Promise.all(clients.map((client) => client.end({ timeout: 5 })))
    }
    await expect(harness.sql`
      INSERT INTO document_sequences (document_type, year) VALUES ('quote', 2026)
    `).rejects.toMatchObject({ code: '23505' })
    await expect(harness.sql`
      INSERT INTO document_sequences (document_type, year) VALUES ('quote', 1999)
    `).rejects.toMatchObject({ code: '23514' })
    await expect(harness.sql`
      UPDATE document_sequences SET next_value = 0 WHERE document_type = 'quote' AND year = 2026
    `).rejects.toMatchObject({ code: '23514' })
  })

  it('rejects invalid values and broken references at the database boundary', async () => {
    const userId = randomUUID()
    await harness.sql`
      INSERT INTO users (id, name, email, role, auth_subject)
      VALUES (${userId}, 'Valid User', 'valid@example.test', 'admin', 'valid-subject')
    `
    await expect(harness.sql`
      INSERT INTO users (name, email, role, auth_subject)
      VALUES ('   ', 'blank@example.test', 'admin', 'blank-subject')
    `).rejects.toMatchObject({ code: '23514' })
    await expect(harness.sql`
      INSERT INTO products (
        industry_id, internal_code, description, unit, created_by_user_id, updated_by_user_id
      ) VALUES (
        ${randomUUID()}, 'BROKEN-FK', 'Broken reference', 'UN', ${userId}, ${userId}
      )
    `).rejects.toMatchObject({ code: '23503' })

    const data = await createMasterData()
    await expect(harness.sql`
      UPDATE products SET ipi_rate = 100.000001 WHERE id = ${data.productId}
    `).rejects.toMatchObject({ code: '23514' })
    await expect(harness.sql`
      INSERT INTO product_prices (
        product_id, price_list_id, amount, valid_from, created_by_user_id, reason
      ) VALUES (
        ${data.productId}, ${EXPECTED_PRICE_LISTS[1].id}, -0.000001, now(), ${data.userId}, 'Inválido'
      )
    `).rejects.toMatchObject({ code: '23514' })
  })

  it('keeps non-overlapping price history append-only while allowing a current version to close once', async () => {
    const data = await createMasterData()
    await expect(harness.sql`
      INSERT INTO product_prices (
        product_id, price_list_id, amount, valid_from, valid_to,
        created_by_user_id, ended_by_user_id, reason
      ) VALUES (
        ${data.productId}, ${EXPECTED_PRICE_LISTS[0].id}, 13.000000,
        '2026-01-15T00:00:00Z', '2026-01-20T00:00:00Z',
        ${data.userId}, ${data.userId}, 'Sobreposição'
      )
    `).rejects.toMatchObject({ code: '23P01' })

    await harness.sql`
      UPDATE product_prices
      SET valid_to = '2026-02-01T00:00:00Z', ended_by_user_id = ${data.userId}
      WHERE id = ${data.productPriceId}
    `
    const successorId = randomUUID()
    await harness.sql`
      INSERT INTO product_prices (
        id, product_id, price_list_id, amount, valid_from, created_by_user_id, reason
      ) VALUES (
        ${successorId}, ${data.productId}, ${EXPECTED_PRICE_LISTS[0].id}, 13.000001,
        '2026-02-01T00:00:00Z', ${data.userId}, 'Reajuste'
      )
    `
    await expect(harness.sql`
      UPDATE product_prices SET amount = 99.000000 WHERE id = ${successorId}
    `).rejects.toThrow(/versions may only be closed once/i)
    await expect(harness.sql`
      DELETE FROM product_prices WHERE id = ${data.productPriceId}
    `).rejects.toThrow(/append-only/i)

    const history = await harness.sql<{ amount: string; validTo: Date | null; reason: string }[]>`
      SELECT amount, valid_to AS "validTo", reason
      FROM product_prices
      WHERE product_id = ${data.productId} AND price_list_id = ${EXPECTED_PRICE_LISTS[0].id}
      ORDER BY valid_from
    `
    expect(history).toEqual([
      { amount: '12.345678', validTo: expect.any(Date), reason: 'Preço inicial' },
      { amount: '13.000001', validTo: null, reason: 'Reajuste' },
    ])
  })

  it('retains archived master data and prevents invalid hard deletion', async () => {
    const data = await createMasterData()
    await harness.sql`
      UPDATE products
      SET archived_at = clock_timestamp(), archived_by_user_id = ${data.userId}
      WHERE id = ${data.productId}
    `
    const [archived] = await harness.sql<{ id: string; archivedAt: Date }[]>`
      SELECT id, archived_at AS "archivedAt" FROM products WHERE id = ${data.productId}
    `
    expect(archived).toEqual({ id: data.productId, archivedAt: expect.any(Date) })
    await expect(harness.sql`DELETE FROM products WHERE id = ${data.productId}`).rejects.toThrow(/archived, not hard deleted/i)
    await expect(harness.sql`DELETE FROM industries WHERE id = ${data.industryId}`).rejects.toThrow(/archived, not hard deleted/i)
    await expect(harness.sql`DELETE FROM customers WHERE id = ${data.customerId}`).rejects.toThrow(/archived, not hard deleted/i)
  })

  it('preserves quote and order line snapshots after master-data and price changes', async () => {
    const data = await createMasterData()
    const quoteId = await insertQuote(data)
    const quoteLineId = await insertQuoteLine(data, quoteId)
    const orderId = randomUUID()

    await harness.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO orders (
          id, source_quote_id, number, customer_id, representative_id, price_list_id,
          customer_legal_name_snapshot, customer_trade_name_snapshot, customer_tax_id_snapshot,
          customer_address_snapshot, representative_name_snapshot, price_list_key_snapshot,
          price_list_name_snapshot, valid_until_snapshot, gross_amount, line_discount_amount,
          net_after_line_discount_amount, overall_discount_amount, net_merchandise_amount,
          tax_totals_snapshot, freight_amount, grand_total_amount, commission_basis_amount,
          commission_value_amount, created_by_user_id
        ) VALUES (
          ${orderId}, ${quoteId}, 'PED-2026-000001',
          ${data.customerId}, ${data.representativeId}, ${EXPECTED_PRICE_LISTS[0].id},
          'Cliente original LTDA', 'Cliente original', '12345678000199', NULL,
          'Representante original', 'PRICE_1', 'Preço 1', '2026-12-31', 24.69, 0, 24.69,
          0, 24.69, '[]'::jsonb, 0, 24.69, 24.69, 0, ${data.userId}
        )
      `
      await transaction`
        UPDATE quotes
        SET status = 'converted', converted_order_id = ${orderId},
            converted_at = clock_timestamp(), converted_by_user_id = ${data.userId}
        WHERE id = ${quoteId}
      `
    })

    const orderLineId = randomUUID()
    await harness.sql`
      INSERT INTO order_lines (
        id, order_id, source_quote_line_id, quote_line_position_snapshot, position,
        product_id, product_price_id, price_source, product_code_snapshot,
        product_description_snapshot, manufacturer_code_snapshot, brand_snapshot,
        packaging_snapshot, unit_snapshot, industry_id_snapshot, industry_name_snapshot,
        price_list_id_snapshot, price_list_key_snapshot, price_list_name_snapshot,
        unit_price_snapshot, quantity, line_discount_rate, gross_amount_snapshot,
        line_discount_amount_snapshot, net_after_line_discount_amount_snapshot,
        overall_discount_allocation_amount_snapshot, net_merchandise_amount_snapshot,
        taxes_snapshot, ipi_rate_snapshot, commission_source_snapshot,
        commission_basis_amount_snapshot, created_by_user_id
      )
      SELECT
        ${orderLineId}, ${orderId}, id, position, position, product_id, product_price_id,
        price_source, product_code_snapshot, product_description_snapshot,
        manufacturer_code_snapshot, brand_snapshot, packaging_snapshot, unit_snapshot,
        industry_id_snapshot, industry_name_snapshot, price_list_id_snapshot,
        price_list_key_snapshot, price_list_name_snapshot, unit_price_snapshot, quantity,
        line_discount_rate, gross_amount_snapshot, line_discount_amount_snapshot,
        net_after_line_discount_amount_snapshot, overall_discount_allocation_amount_snapshot,
        net_merchandise_amount_snapshot, taxes_snapshot, ipi_rate_snapshot,
        commission_source_snapshot, commission_basis_amount_snapshot, ${data.userId}
      FROM quote_lines WHERE id = ${quoteLineId}
    `

    await harness.sql`
      UPDATE products
      SET description = 'Produto alterado', manufacturer_code = 'FAB-ALTERADO',
          brand = 'Marca alterada', updated_by_user_id = ${data.userId}
      WHERE id = ${data.productId}
    `
    await harness.sql`
      UPDATE industries SET legal_name = 'Indústria alterada LTDA', updated_by_user_id = ${data.userId}
      WHERE id = ${data.industryId}
    `
    await harness.sql`
      UPDATE product_prices
      SET valid_to = '2026-03-01T00:00:00Z', ended_by_user_id = ${data.userId}
      WHERE id = ${data.productPriceId}
    `
    await harness.sql`
      INSERT INTO product_prices (
        product_id, price_list_id, amount, valid_from, created_by_user_id, reason
      ) VALUES (
        ${data.productId}, ${EXPECTED_PRICE_LISTS[0].id}, 99.999999,
        '2026-03-01T00:00:00Z', ${data.userId}, 'Preço posterior'
      )
    `

    const snapshots = await harness.sql<{
      source: string
      productDescription: string
      manufacturerCode: string
      brand: string
      industryName: string
      unitPrice: string
    }[]>`
      SELECT 'order' AS source,
             product_description_snapshot AS "productDescription",
             manufacturer_code_snapshot AS "manufacturerCode",
             brand_snapshot AS brand,
             industry_name_snapshot AS "industryName",
             unit_price_snapshot AS "unitPrice"
      FROM order_lines WHERE id = ${orderLineId}
      UNION ALL
      SELECT 'quote' AS source,
             product_description_snapshot, manufacturer_code_snapshot, brand_snapshot,
             industry_name_snapshot, unit_price_snapshot
      FROM quote_lines WHERE id = ${quoteLineId}
      ORDER BY source
    `
    expect(snapshots).toEqual([
      {
        source: 'order',
        productDescription: 'Produto original',
        manufacturerCode: 'FAB-ORIGINAL',
        brand: 'Marca original',
        industryName: 'Indústria original LTDA',
        unitPrice: '12.345678',
      },
      {
        source: 'quote',
        productDescription: 'Produto original',
        manufacturerCode: 'FAB-ORIGINAL',
        brand: 'Marca original',
        industryName: 'Indústria original LTDA',
        unitPrice: '12.345678',
      },
    ])
    await expect(harness.sql`
      UPDATE order_lines SET product_description_snapshot = 'Mutação proibida' WHERE id = ${orderLineId}
    `).rejects.toThrow(/append-only/i)
  })
})
