import { sql } from 'drizzle-orm'
import {
  check,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { priceLists, productPrices, products } from './catalog'

const money = (name: string) => numeric(name, { precision: 19, scale: 2 }).notNull()

export const customers = pgTable(
  'customers',
  {
    id: uuid().primaryKey().defaultRandom(),
    legalName: text('legal_name').notNull(),
    taxIdentifier: text('tax_identifier').notNull(),
  },
  (table) => [
    check('customers_legal_name_ck', sql`btrim(${table.legalName}) <> ''`),
    check('customers_tax_identifier_ck', sql`btrim(${table.taxIdentifier}) <> ''`),
  ],
)

export const quotePricingSnapshots = pgTable('quote_pricing_snapshots', {
  id: uuid().primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  priceListId: uuid('price_list_id').notNull().references(() => priceLists.id, { onDelete: 'restrict' }),
  generalDiscountRate: numeric('general_discount_rate', { precision: 9, scale: 6 }).notNull(),
  grossItemsAmount: money('gross_items_amount'),
  lineDiscountAmount: money('line_discount_amount'),
  netItemsAmount: money('net_items_amount'),
  generalDiscountAmount: money('general_discount_amount'),
  netMerchandiseAmount: money('net_merchandise_amount'),
  ipiAmount: money('ipi_amount'),
  configuredTaxAmount: money('configured_tax_amount'),
  freightAmount: money('freight_amount'),
  grandTotalAmount: money('grand_total_amount'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export const quotePricingSnapshotLines = pgTable('quote_pricing_snapshot_lines', {
  quotePricingSnapshotId: uuid('quote_pricing_snapshot_id')
    .notNull()
    .references(() => quotePricingSnapshots.id, { onDelete: 'restrict' }),
  lineId: uuid('line_id').primaryKey(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  productPriceId: uuid('product_price_id').notNull().references(() => productPrices.id, { onDelete: 'restrict' }),
  quantity: numeric({ precision: 18, scale: 6 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 19, scale: 6 }).notNull(),
  lineDiscountRate: numeric('line_discount_rate', { precision: 9, scale: 6 }).notNull(),
  grossAmount: money('gross_amount'),
  lineDiscountAmount: money('line_discount_amount'),
  netAfterLineDiscountAmount: money('net_after_line_discount_amount'),
  generalDiscountAmount: money('general_discount_amount'),
  netMerchandiseAmount: money('net_merchandise_amount'),
  ipiAmount: money('ipi_amount'),
  configuredTaxes: jsonb('configured_taxes').$type<readonly Readonly<{
    code: string
    rate: string
    basisAmount: string
    amount: string
  }>[]>().notNull(),
  configuredTaxAmount: money('configured_tax_amount'),
})
