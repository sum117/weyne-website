import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_INACTIVE_DAYS,
  MAX_INACTIVE_DAYS,
  resolveInactiveWindow,
} from '@/lib/analytics/insight-contracts'

/**
 * Deterministic fixtures for the price-history and inactive-client insight
 * contracts, proven against the canonical interval-based `product_prices`
 * schema (the append-only table IS the history).
 *
 * Fixture clock (instants UTC; business zone America/Fortaleza = UTC-3):
 * asOf 2026-08-17 → asOfExclusive 2026-08-18T03:00Z and
 * floorInclusive(90d) 2026-05-19T03:00Z.
 *
 * Covered edges: half-open interval resolution at `valid_to`, missing
 * prices on one side of a comparison, status exclusions (cancelled never
 * reactivates), inactivity-threshold boundaries, and range validation.
 */
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const baseDatabaseUrl = new URL(databaseUrl)
const isolatedDatabaseName = `insight_contracts_${randomUUID().replaceAll('-', '')}`

// Created eagerly; postgres.js opens connections lazily on first query.
const adminClient = postgres(baseDatabaseUrl.toString(), {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: () => undefined,
})

afterAll(async () => {
  try {
    for (const suffix of ['', '_cmp', '_inactive']) {
      await adminClient.unsafe(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(`${isolatedDatabaseName}${suffix}`)} WITH (FORCE)`,
      )
    }
  } finally {
    await adminClient.end({ timeout: 5 })
  }
})

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

async function freshDatabase(databaseName: string): Promise<Sql> {
  const target = new URL(baseDatabaseUrl.toString())
  target.pathname = `/${databaseName}`
  const client = postgres(target.toString(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  })
  await client.unsafe('DROP SCHEMA public CASCADE')
  await client.unsafe('CREATE SCHEMA public')
  const directory = resolve(process.cwd(), 'drizzle/canonical')
  const names = (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort()
  for (const name of names) {
    await client.unsafe(await readFile(resolve(directory, name), 'utf8'))
  }
  return client
}

const PRICE_LIST_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
] as const

async function seedBaseData(sql: Sql): Promise<{ userId: string }> {
  const userId = randomUUID()
  await sql`
    INSERT INTO users (id, name, email, role, auth_subject)
    VALUES (${userId}, 'Insight Admin', ${`insight-${userId}@example.test`}, 'admin', ${`subject-${userId}`})
  `
  // The four canonical price lists (PRICE_1..4) are seeded by the
  // migrations themselves and protected against mutation — no seeding here.
  return { userId }
}

/** Industries require created_by/updated_by user ids. */
async function seedIndustry(
  sql: Sql,
  userId: string,
  legalName: string,
): Promise<string> {
  const id = randomUUID()
  await sql`
    INSERT INTO industries (id, legal_name, created_by_user_id, updated_by_user_id)
    VALUES (${id}, ${legalName}, ${userId}, ${userId})
  `
  return id
}

async function seedProduct(
  sql: Sql,
  userId: string,
  industryId: string,
  code: string,
): Promise<string> {
  const id = randomUUID()
  await sql`
    INSERT INTO products (
      id, industry_id, internal_code, description, unit,
      created_by_user_id, updated_by_user_id
    ) VALUES (
      ${id}, ${industryId}, ${code}, ${'Produto ' + code}, 'UN', ${userId}, ${userId}
    )
  `
  return id
}

async function insertPriceInterval(input: {
  sql: Sql
  userId: string
  productId: string
  priceListId: string
  amount: string
  validFrom: Date
  validTo: Date | null
}): Promise<void> {
  if (input.validTo === null) {
    await input.sql`
      INSERT INTO product_prices (
        product_id, price_list_id, amount, valid_from, created_by_user_id, reason
      ) VALUES (
        ${input.productId}, ${input.priceListId}, ${input.amount},
        ${input.validFrom}, ${input.userId}, 'ajuste comercial'
      )
    `
  } else {
    await input.sql`
      INSERT INTO product_prices (
        product_id, price_list_id, amount, valid_from, valid_to,
        created_by_user_id, ended_by_user_id, reason
      ) VALUES (
        ${input.productId}, ${input.priceListId}, ${input.amount},
        ${input.validFrom}, ${input.validTo},
        ${input.userId}, ${input.userId}, 'ajuste comercial'
      )
    `
  }
}

/**
 * Executable form of the effective-price contract: the single row whose
 * half-open interval `[valid_from, valid_to)` contains the instant.
 */
async function resolveEffectivePrice(
  sql: Sql,
  productId: string,
  priceListId: string,
  instant: Date,
): Promise<string | null> {
  const rows = await sql`
    SELECT amount::text AS amount
    FROM product_prices
    WHERE product_id = ${productId}
      AND price_list_id = ${priceListId}
      AND valid_from <= ${instant}
      AND (valid_to IS NULL OR valid_to > ${instant})
  `
  expect(rows.length).toBeLessThanOrEqual(1)
  return rows.length === 1 ? (rows[0]!.amount as string) : null
}

describe('effective-price semantics over half-open intervals', () => {
  let sql: Sql
  let userId: string
  let productId: string

  beforeAll(async () => {
    await adminClient.unsafe(`CREATE DATABASE ${quoteIdentifier(isolatedDatabaseName)}`)
    sql = await freshDatabase(isolatedDatabaseName)
    ;({ userId } = await seedBaseData(sql))
    const list1 = PRICE_LIST_IDS[0]
    const industryId = await seedIndustry(sql, userId, 'Indústria Fronteira')
    productId = await seedProduct(sql, userId, industryId, 'FRON-001')

    // Price change exactly at the Fortaleza civil boundary of 2026-06-01:
    // old interval ends where the new begins — no overlap, no gap.
    const changeInstant = new Date('2026-06-01T03:00:00.000Z')
    await insertPriceInterval({
      sql, userId, productId, priceListId: list1!,
      amount: '100.000000',
      validFrom: new Date('2026-01-01T03:00:00.000Z'),
      validTo: changeInstant,
    })
    await insertPriceInterval({
      sql, userId, productId, priceListId: list1!,
      amount: '120.000000',
      validFrom: changeInstant,
      validTo: null,
    })
  })

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  it('resolves the old interval strictly below its exclusive end', async () => {
    const amount = await resolveEffectivePrice(
      sql, productId, PRICE_LIST_IDS[0]!, new Date('2026-05-31T23:59:59.999Z'),
    )
    expect(amount).toBe('100.000000')
  })

  it('never resolves an instant that is exactly valid_to to the ended row', async () => {
    const boundary = new Date('2026-06-01T03:00:00.000Z')
    expect(await resolveEffectivePrice(sql, productId, PRICE_LIST_IDS[0]!, boundary)).toBe('120.000000')
  })

  it('resolves the current open-ended interval', async () => {
    const amount = await resolveEffectivePrice(
      sql, productId, PRICE_LIST_IDS[0]!, new Date('2026-08-17T12:00:00.000Z'),
    )
    expect(amount).toBe('120.000000')
  })

  it('treats a missing price as absent — never zero or inherited', async () => {
    expect(
      await resolveEffectivePrice(sql, productId, PRICE_LIST_IDS[1]!, new Date('2026-08-17T12:00:00.000Z')),
    ).toBeNull()
  })

  it('keeps intervals disjoint under the no-overlap invariant', async () => {
    const rows = await sql`
      SELECT count(*)::int AS overlaps
      FROM product_prices a
      JOIN product_prices b
        ON a.product_id = b.product_id
       AND a.price_list_id = b.price_list_id
       AND a.id <> b.id
       AND a.valid_from < COALESCE(b.valid_to, 'infinity'::timestamptz)
       AND COALESCE(a.valid_to, 'infinity'::timestamptz) > b.valid_from
    `
    expect(rows[0]!.overlaps).toBe(0)
  })
})

describe('four canonical price-list comparisons', () => {
  let sql: Sql
  let userId: string
  let sparseProductId: string
  let comparisonRows: Array<{
    comparison: string
    lowerAmount: string
    higherAmount: string
    gap: string
  }>

  beforeAll(async () => {
    await adminClient.unsafe(
      `CREATE DATABASE ${quoteIdentifier(`${isolatedDatabaseName}_cmp`)}`,
    )
    sql = await freshDatabase(`${isolatedDatabaseName}_cmp`)
    ;({ userId } = await seedBaseData(sql))
    const industryId = await seedIndustry(sql, userId, 'Indústria Comparativo')

    const pricedProductId = await seedProduct(sql, userId, industryId, 'COMP-001')
    const instant = new Date('2026-08-01T12:00:00.000Z')
    const amounts = ['90.000000', '95.000000', '105.000000', '130.000000'] as const
    for (let i = 0; i < 4; i += 1) {
      await insertPriceInterval({
        sql, userId, productId: pricedProductId, priceListId: PRICE_LIST_IDS[i]!,
        amount: amounts[i]!,
        validFrom: new Date('2026-07-01T03:00:00.000Z'),
        validTo: null,
      })
    }

    // Executable comparison contract: fixed pair set, gap = higher − lower,
    // computed only when both sides have an effective price at the instant.
    const PAIRS: ReadonlyArray<readonly [string, number, number]> = [
      ['p1_vs_p2', 0, 1],
      ['p2_vs_p3', 1, 2],
      ['p3_vs_p4', 2, 3],
      ['spread_1_4', 0, 3],
    ]
    comparisonRows = []
    for (const [comparison, lowerIdx, higherIdx] of PAIRS) {
      const lower = await resolveEffectivePrice(sql, pricedProductId, PRICE_LIST_IDS[lowerIdx]!, instant)
      const higher = await resolveEffectivePrice(sql, pricedProductId, PRICE_LIST_IDS[higherIdx]!, instant)
      if (!lower || !higher) continue
      const gapRows = await sql`
        SELECT (${higher}::numeric - ${lower}::numeric)::text AS gap
      `
      comparisonRows.push({ comparison, lowerAmount: lower, higherAmount: higher, gap: gapRows[0]!.gap })
    }

    // Sparse product: lists 1 and 3 priced only → no canonical pair complete.
    sparseProductId = await seedProduct(sql, userId, industryId, 'COMP-SPARSE')
    for (const listIdx of [0, 2]) {
      await insertPriceInterval({
        sql, userId, productId: sparseProductId, priceListId: PRICE_LIST_IDS[listIdx]!,
        amount: '50.000000',
        validFrom: new Date('2026-07-01T03:00:00.000Z'),
        validTo: null,
      })
    }
  }, 20_000)

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  it('produces exactly the four canonical comparisons in list order', () => {
    expect(comparisonRows.map((r) => r.comparison)).toEqual([
      'p1_vs_p2',
      'p2_vs_p3',
      'p3_vs_p4',
      'spread_1_4',
    ])
  })

  it('computes gaps as higher-list minus lower-list with exact decimals', () => {
    expect(comparisonRows[0]).toEqual({ comparison: 'p1_vs_p2', lowerAmount: '90.000000', higherAmount: '95.000000', gap: '5.000000' })
    expect(comparisonRows[1]).toEqual({ comparison: 'p2_vs_p3', lowerAmount: '95.000000', higherAmount: '105.000000', gap: '10.000000' })
    expect(comparisonRows[2]).toEqual({ comparison: 'p3_vs_p4', lowerAmount: '105.000000', higherAmount: '130.000000', gap: '25.000000' })
    expect(comparisonRows[3]).toEqual({ comparison: 'spread_1_4', lowerAmount: '90.000000', higherAmount: '130.000000', gap: '40.000000' })
  })

  it('emits no comparison when either side lacks an effective price', async () => {
    const instant = new Date('2026-08-01T12:00:00.000Z')
    const checks = await Promise.all(
      PRICE_LIST_IDS.map((listId) =>
        resolveEffectivePrice(sql, sparseProductId, listId, instant),
      ),
    )
    // Lists 1 and 3 priced; 2 and 4 missing. Every canonical pair includes
    // a missing side, so the sparse product contributes zero rows.
    expect(checks.map((present) => present !== null)).toEqual([true, false, true, false])
  })
})

// ---------------------------------------------------------------------------
// Inactive-client fixtures over the canonical quote→order chain
// ---------------------------------------------------------------------------

async function seedRepresentative(
  sql: Sql,
  adminUserId: string,
  displaySuffix: string,
): Promise<{ representativeId: string }> {
  const repUserId = randomUUID()
  await sql`
    INSERT INTO users (id, name, email, role, auth_subject)
    VALUES (${repUserId}, ${'Rep ' + displaySuffix}, ${`rep-${repUserId}@example.test`}, 'representative', ${`subject-${repUserId}`})
  `
  const representativeId = randomUUID()
  await sql`
    INSERT INTO representatives (
      id, user_id, display_name, created_by_user_id, updated_by_user_id
    ) VALUES (${representativeId}, ${repUserId}, ${'Representante ' + displaySuffix}, ${adminUserId}, ${adminUserId})
  `
  return { representativeId }
}

async function seedCustomer(
  sql: Sql,
  adminUserId: string,
  representativeId: string,
  legalName: string,
  taxId: string,
): Promise<string> {
  const id = randomUUID()
  await sql`
    INSERT INTO customers (
      id, legal_name, tax_id, credit_limit, currency_code,
      responsible_representative_id, created_by_user_id, updated_by_user_id
    ) VALUES (
      ${id}, ${legalName}, ${taxId}, 1000.00, 'BRL',
      ${representativeId}, ${adminUserId}, ${adminUserId}
    )
  `
  return id
}

/**
 * Seeds one full canonical quote→order chain with an explicit `created_at`
 * (the sales date), which the conversion repository does not accept as
 * input — these are fixture orders, not conversion outputs.
 */
async function seedOrderAtInstant(input: {
  sql: Sql
  userId: string
  customerId: string
  representativeId: string
  status: 'open' | 'confirmed' | 'invoiced' | 'completed' | 'cancelled'
  createdAt: Date
  sequenceNumber: number
}): Promise<void> {
  const { sql, userId } = input
  const quoteId = randomUUID()
  const orderId = randomUUID()
  const number = `PED-${String(2000 + input.sequenceNumber).padStart(4, '0')}-${String(input.sequenceNumber).padStart(6, '0')}`
  // The reciprocal-conversion triggers are deferrable and evaluate the row
  // version captured at each event: the quote must commit BEFORE any order
  // references it (its insert-trigger asserts "no order yet"), then the
  // order insert + reciprocal quote update commit together.
  await sql`
    INSERT INTO quotes (
      id, number, customer_id, representative_id, price_list_id, valid_until,
      customer_legal_name_snapshot, representative_name_snapshot,
      price_list_key_snapshot, price_list_name_snapshot,
      gross_amount, line_discount_amount, net_after_line_discount_amount,
      overall_discount_amount, net_merchandise_amount, tax_totals_snapshot,
      freight_amount, grand_total_amount, commission_basis_amount,
      commission_value_amount, created_at, created_by_user_id, updated_by_user_id
    ) VALUES (
      ${quoteId}, ${'ORC-' + number.slice(4)}, ${input.customerId}, ${input.representativeId},
      ${PRICE_LIST_IDS[0]}, '2027-12-31',
      'Cliente Fixture LTDA', 'Representante Fixture', 'PRICE_1', 'Preço 1',
      100.00, 0, 100.00, 0, 100.00, '[]'::jsonb, 0, 100.00, 100.00, 0,
      ${input.createdAt}, ${userId}, ${userId}
    )
  `
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO orders (
        id, source_quote_id, number, customer_id, representative_id, price_list_id,
        customer_legal_name_snapshot, representative_name_snapshot,
        price_list_key_snapshot, price_list_name_snapshot, valid_until_snapshot,
        gross_amount, line_discount_amount, net_after_line_discount_amount,
        overall_discount_amount, net_merchandise_amount, tax_totals_snapshot,
        freight_amount, grand_total_amount, commission_basis_amount,
        commission_value_amount, status, created_at, created_by_user_id, updated_at
      ) VALUES (
        ${orderId}, ${quoteId}, ${number}, ${input.customerId}, ${input.representativeId},
        ${PRICE_LIST_IDS[0]},
        'Cliente Fixture LTDA', 'Representante Fixture', 'PRICE_1', 'Preço 1', '2027-12-31',
        100.00, 0, 100.00, 0, 100.00, '[]'::jsonb, 0, 100.00, 100.00, 0,
        ${input.status}, ${input.createdAt}, ${userId}, ${input.createdAt}
      )
    `
    // Canonical invariant: the originating quote must be marked `converted`
    // with a reciprocal link to its single order.
    await tx`
      UPDATE quotes
      SET status = 'converted',
          converted_order_id = ${orderId},
          converted_at = ${input.createdAt},
          converted_by_user_id = ${userId}
      WHERE id = ${quoteId}
    `
  })
}

describe('inactive-client semantics with threshold edges', () => {
  let sql: Sql
  let userId: string
  let clientOnFloor: string
  let clientJustBefore: string
  let clientNeverPurchased: string
  let clientCancelledOnly: string

  /**
   * Canonical inactive-client predicate per metric-contracts.ts: latest
   * non-cancelled order with sales date < asOfExclusive; inactive when none
   * exists or latest < floorInclusive.
   */
  async function classifyClients(): Promise<Map<string, { active: boolean; lastPurchaseAt: Date | null }>> {
    const window = resolveInactiveWindow('2026-08-17', DEFAULT_INACTIVE_DAYS)
    const rows = await sql`
      SELECT c.id AS client_id,
             max(o.created_at) FILTER (
               WHERE o.status <> 'cancelled'
                 AND o.created_at < ${window.asOfExclusive}
             ) AS last_purchase_at
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id
      GROUP BY c.id
    `
    const result = new Map<string, { active: boolean; lastPurchaseAt: Date | null }>()
    for (const row of rows) {
      const last = row.last_purchase_at as Date | null
      result.set(row.client_id as string, {
        active: last !== null && last.valueOf() >= window.floorInclusive.valueOf(),
        lastPurchaseAt: last,
      })
    }
    return result
  }

  beforeAll(async () => {
    await adminClient.unsafe(
      `CREATE DATABASE ${quoteIdentifier(`${isolatedDatabaseName}_inactive`)}`,
    )
    sql = await freshDatabase(`${isolatedDatabaseName}_inactive`)
    ;({ userId } = await seedBaseData(sql))
    const { representativeId } = await seedRepresentative(sql, userId, 'Um')

    const window = resolveInactiveWindow('2026-08-17', DEFAULT_INACTIVE_DAYS)

    clientOnFloor = await seedCustomer(sql, userId, representativeId, 'Cliente Na Fronteira LTDA', '11111111000111')
    clientJustBefore = await seedCustomer(sql, userId, representativeId, 'Cliente Dormente LTDA', '22222222000122')
    clientNeverPurchased = await seedCustomer(sql, userId, representativeId, 'Cliente Sem Pedido LTDA', '33333333000133')
    clientCancelledOnly = await seedCustomer(sql, userId, representativeId, 'Cliente Cancelado LTDA', '44444444000144')

    // Exactly ON the floor: active (strict-boundary rule).
    await seedOrderAtInstant({
      sql, userId, customerId: clientOnFloor, representativeId,
      status: 'completed', createdAt: window.floorInclusive, sequenceNumber: 1,
    })
    // One millisecond before the floor: inactive.
    await seedOrderAtInstant({
      sql, userId, customerId: clientJustBefore, representativeId,
      status: 'invoiced', createdAt: new Date(window.floorInclusive.valueOf() - 1),
      sequenceNumber: 2,
    })
    // No order at all: never purchased → inactive.
    // Cancelled-only history inside the window: still inactive.
    await seedOrderAtInstant({
      sql, userId, customerId: clientCancelledOnly, representativeId,
      status: 'cancelled', createdAt: new Date('2026-08-15T12:00:00.000Z'),
      sequenceNumber: 3,
    })
  }, 20_000)

  afterAll(async () => {
    await sql?.end({ timeout: 5 })
  })

  it('keeps a client whose latest purchase lands exactly on the floor active', async () => {
    const state = (await classifyClients()).get(clientOnFloor)!
    expect(state.active).toBe(true)
    expect(state.lastPurchaseAt).not.toBeNull()
  })

  it('marks a client one instant older than the floor inactive', async () => {
    const state = (await classifyClients()).get(clientJustBefore)!
    expect(state.active).toBe(false)
  })

  it('reports a never-purchased client inactive with null last purchase', async () => {
    const state = (await classifyClients()).get(clientNeverPurchased)!
    expect(state.active).toBe(false)
    expect(state.lastPurchaseAt).toBeNull()
  })

  it('never lets a cancelled order reactivate a client', async () => {
    const state = (await classifyClients()).get(clientCancelledOnly)!
    expect(state.active).toBe(false)
    expect(state.lastPurchaseAt).toBeNull()
  })

  it('reclassifies within the allowed range when the threshold widens to 365 days', async () => {
    const wide = resolveInactiveWindow('2026-08-17', MAX_INACTIVE_DAYS)
    const rows = await sql`
      SELECT max(created_at) AS last_purchase_at FROM orders
      WHERE customer_id = ${clientJustBefore} AND status <> 'cancelled'
    `
    const last = rows[0]!.last_purchase_at as Date | null
    expect(last).not.toBeNull()
    // With a 365-day window the May purchase sits inside the active band.
    expect(last!.valueOf() >= wide.floorInclusive.valueOf()).toBe(true)
  })

  it('rejects thresholds outside the validated range', () => {
    expect(() => resolveInactiveWindow('2026-08-17', 0)).toThrow()
    expect(() => resolveInactiveWindow('2026-08-17', 366)).toThrow()
  })
})
