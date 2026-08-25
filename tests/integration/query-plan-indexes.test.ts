import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

/**
 * Query-plan regression coverage for the report/commission/dashboard paths
 * (kanban t_8963f08e). The measured before/after evidence lives in
 * `artifacts/performance/profiling/`; this suite pins the CI-stable
 * consequences:
 *
 * 1. the 0011 indexes exist after migration (a dropped or renamed index
 *    fails loudly instead of silently regressing plans), and
 * 2. the hot access paths stay index-backed — per-order line fetches and
 *    date-window order scans must resolve through an index on real plans.
 */

let harness: PostgresTestHarness
let quoteSequence = 0

beforeAll(async () => {
  harness = await createPostgresTestHarness({ schemaPrefix: 'plan_indexes' })
})

afterAll(async () => {
  await harness?.close()
})

const EXPECTED_INDEXES = [
  'orders_created_idx',
  'order_lines_order_id_idx',
  'quotes_owner_idx',
  'orders_client_latest_idx',
] as const

async function seedOrder(input: { createdAt: string }): Promise<string> {
  quoteSequence += 1
  const [quote] = await harness.sql<{ id: string }[]>`
    INSERT INTO quotes (
      quote_number, owner_user_id, status, valid_until,
      customer_snapshot, commercial_snapshot
    ) VALUES (
      ${'ORC-2026-' + String(quoteSequence).padStart(6, '0')},
      'plan-index-owner', 'converted', '2026-12-31', '{}'::jsonb, '{}'::jsonb
    ) RETURNING id
  `
  const [order] = await harness.sql<{ id: string }[]>`
    INSERT INTO orders (
      source_quote_id, source_quote_revision, number, number_year,
      number_sequence, status, client_id, client_legal_name,
      client_tax_identifier, client_address_street, client_address_number,
      client_address_district, client_address_city, client_address_state,
      client_address_postal_code, currency_code,
      gross_items_amount, per_item_discount_amount, net_items_amount,
      general_discount_rate, general_discount_amount, net_after_discounts_amount,
      ipi_amount, configured_tax_amount, freight_amount, grand_total_amount,
      commission_basis_amount, commission_amount, created_at, created_by,
      creation_reason, updated_at, updated_by, status_changed_at,
      status_changed_by, status_change_reason
    ) VALUES (
      ${quote!.id}, 1, ${'PED-2026-' + String(quoteSequence).padStart(6, '0')}, 2026,
      ${quoteSequence}, 'invoiced',
      '00000000-0000-4000-8000-000000000001', 'Cliente de plano',
      '00000000000000', 'Rua de teste', '1', 'Centro', 'Fortaleza', 'CE',
      '60000000', 'BRL',
      100, 0, 100, 0, 0, 100, 0, 0, 0, 100, 100, 5,
      ${input.createdAt}, 'tester', 'Teste de indice',
      ${input.createdAt}, 'tester', ${input.createdAt}, 'tester', 'Teste'
    ) RETURNING id
  `
  return order!.id
}

describe('query-plan index coverage', () => {
  it('declares the profiling-approved indexes after migration', async () => {
    const found = await harness.sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN ('orders_created_idx', 'order_lines_order_id_idx',
                          'quotes_owner_idx', 'orders_client_latest_idx')
    `
    expect(new Set(found.map((row) => row.indexname))).toEqual(
      new Set(EXPECTED_INDEXES),
    )
  })

  it('fetches order lines through the order-leading index', async () => {
    const orderId = await seedOrder({
      createdAt: new Date('2026-07-10T12:00:00Z').toISOString(),
    })
    await harness.sql`
      INSERT INTO order_lines (
        order_id, source_quote_line_id, line_number, product_id,
        product_industry_id, product_industry_name, product_internal_code,
        product_description, product_unit, quantity, price_list_id,
        product_price_version_id, unit_price_source, unit_price_amount,
        gross_amount, per_item_discount_rate, per_item_discount_amount,
        net_before_general_discount_amount, allocated_general_discount_amount,
        net_after_discounts_amount, ipi_rate, ipi_basis_amount, ipi_amount,
        configured_tax_amount, freight_amount, line_total_amount,
        commission_source, commission_rate, commission_basis_amount,
        commission_amount, commission_provenance, created_at
      ) VALUES (
        ${orderId}, gen_random_uuid(), 1, gen_random_uuid(),
        gen_random_uuid(), 'Industria', 'PROF-000001', 'Produto de plano',
        'UN', 1, gen_random_uuid(), gen_random_uuid(), 'price_list',
        10, 10, 0, 0, 10, 0, 10, 0, 10, 0, 0, 0, 10,
        'product_override', 5, 10, 0.5, 'product_override_snapshot', now()
      )
    `

    // The planner may legitimately prefer a Seq Scan on a one-row table;
    // disable it so the assertion verifies the index path itself.
    const plan = await harness.sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`
      return tx<{ "QUERY PLAN": string }[]>`
        EXPLAIN (FORMAT TEXT)
        SELECT id FROM order_lines WHERE order_id = ${orderId}
      `
    })
    expect(plan.map((row) => row["QUERY PLAN"]).join('\n')).toContain(
      'order_lines_order_id_idx',
    )
  })

  it('resolves date-window order scans through a created_at index', async () => {
    await seedOrder({ createdAt: new Date('2026-07-10T12:00:00Z').toISOString() })

    const plan = await harness.sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`
      return tx<{ "QUERY PLAN": string }[]>`
        EXPLAIN (FORMAT TEXT)
        SELECT id FROM orders
        WHERE created_at >= '2026-07-01T00:00:00Z'::timestamptz
          AND created_at < '2026-08-01T00:00:00Z'::timestamptz
      `
    })
    expect(plan.map((row) => row["QUERY PLAN"]).join('\n')).toMatch(
      /Index (Only )?Scan/,
    )
  })

  it('keeps representative attribution on an owner-leading path', async () => {
    const orderId = await seedOrder({
      createdAt: new Date('2026-07-10T12:00:00Z').toISOString(),
    })
    const plan = await harness.sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`
      return tx<{ "QUERY PLAN": string }[]>`
        EXPLAIN (FORMAT TEXT)
        SELECT q.id FROM quotes q
        WHERE q.owner_user_id = 'plan-index-owner'
          AND EXISTS (
            SELECT 1 FROM orders o WHERE o.source_quote_id = q.id
              AND o.id = ${orderId}
          )
      `
    })
    expect(plan.map((row) => row["QUERY PLAN"]).join('\n')).toContain(
      'quotes_owner_idx',
    )
  })
})
