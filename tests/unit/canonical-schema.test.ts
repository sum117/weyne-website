import { getTableConfig, type PgColumn } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from '@/lib/db/schema/canonical'

const REQUIRED_TABLES = [
  schema.users,
  schema.sessions,
  schema.accounts,
  schema.verifications,
  schema.representatives,
  schema.recordAssignments,
  schema.customers,
  schema.industries,
  schema.carriers,
  schema.products,
  schema.productAssets,
  schema.documentLogoAssets,
  schema.priceLists,
  schema.productPrices,
  schema.commissionRules,
  schema.quotes,
  schema.quoteLines,
  schema.quoteEvents,
  schema.orders,
  schema.orderLines,
  schema.orderEvents,
  schema.attachments,
  schema.idempotencyRecords,
  schema.documentSequences,
  schema.settings,
  schema.auditEvents,
] as const

function column(table: (typeof REQUIRED_TABLES)[number], name: string): PgColumn {
  const found = getTableConfig(table).columns.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`Missing ${getTableConfig(table).name}.${name}`)
  return found
}

function numericShape(table: (typeof REQUIRED_TABLES)[number], name: string) {
  const target = column(table, name) as PgColumn & Readonly<{ precision?: number; scale?: number }>
  return { precision: target.precision, scale: target.scale }
}

describe('canonical Drizzle schema', () => {
  it('declares every canonical table with UUID identities and no tenant discriminator', () => {
    expect(REQUIRED_TABLES.map((table) => getTableConfig(table).name)).toEqual([
      'users',
      'sessions',
      'accounts',
      'verifications',
      'representatives',
      'record_assignments',
      'customers',
      'industries',
      'carriers',
      'products',
      'product_assets',
      'document_logo_assets',
      'price_lists',
      'product_prices',
      'commission_rules',
      'quotes',
      'quote_lines',
      'quote_events',
      'orders',
      'order_lines',
      'order_events',
      'attachments',
      'idempotency_records',
      'document_sequences',
      'settings',
      'audit_events',
    ])

    for (const table of REQUIRED_TABLES) {
      const config = getTableConfig(table)
      expect(config.columns.some((candidate) => candidate.name === 'tenant_id')).toBe(false)
      if (config.name !== 'document_sequences') {
        const id = column(table, 'id')
        expect(id.dataType).toBe('string')
        expect(id.columnType).toBe('PgUUID')
        expect(id.primary).toBe(true)
      }
    }
  })

  it('uses the contract precision and scale for every decimal class', () => {
    expect(numericShape(schema.customers, 'credit_limit')).toEqual({ precision: 19, scale: 2 })
    expect(numericShape(schema.products, 'net_weight')).toEqual({ precision: 18, scale: 6 })
    expect(numericShape(schema.products, 'ipi_rate')).toEqual({ precision: 9, scale: 6 })
    expect(numericShape(schema.productPrices, 'amount')).toEqual({ precision: 19, scale: 6 })
    expect(numericShape(schema.quoteLines, 'quantity')).toEqual({ precision: 18, scale: 6 })
    expect(numericShape(schema.quoteLines, 'unit_price_snapshot')).toEqual({
      precision: 19,
      scale: 6,
    })
    expect(numericShape(schema.quoteLines, 'gross_amount_snapshot')).toEqual({
      precision: 19,
      scale: 2,
    })
    expect(numericShape(schema.orderLines, 'commission_rate_snapshot')).toEqual({
      precision: 9,
      scale: 6,
    })
  })

  it('declares named constraints and indexes for preservation and lookup invariants', () => {
    const allNames = REQUIRED_TABLES.flatMap((table) => {
      const config = getTableConfig(table)
      return [
        ...config.checks.map((constraint) => constraint.name),
        ...config.indexes.map((target) => target.config.name),
        ...config.uniqueConstraints.map((constraint) => constraint.name),
        ...config.primaryKeys.map((constraint) => constraint.getName()),
      ]
    })

    expect(allNames.every((name) => typeof name === 'string' && name.length > 0)).toBe(true)
    expect(allNames).toEqual(
      expect.arrayContaining([
        'product_prices_current_uidx',
        'commission_rules_current_industry_uidx',
        'commission_rules_current_product_uidx',
        'quotes_number_uq',
        'orders_source_quote_uq',
        'orders_carrier_snapshot_ck',
        'order_lines_source_quote_line_uq',
        'document_sequences_pk',
        'record_assignments_target_ck',
        'quote_events_metadata_ck',
        'order_events_metadata_ck',
      ]),
    )
  })

  it('keeps immutable quote and order line snapshots structurally aligned', () => {
    const quoteColumns = new Set(getTableConfig(schema.quoteLines).columns.map((item) => item.name))
    const orderColumns = new Set(getTableConfig(schema.orderLines).columns.map((item) => item.name))
    const transportOnly = new Set([
      'id',
      'quote_id',
      'order_id',
      'source_quote_line_id',
      'quote_line_position_snapshot',
      'updated_at',
      'updated_by_user_id',
    ])

    const quoteSnapshotColumns = [...quoteColumns].filter((name) => !transportOnly.has(name)).sort()
    const orderSnapshotColumns = [...orderColumns].filter((name) => !transportOnly.has(name)).sort()
    expect(orderSnapshotColumns).toEqual(quoteSnapshotColumns)
    expect(orderColumns.has('updated_at')).toBe(false)
  })
})
