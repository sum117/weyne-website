import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { carriers } from './carriers'

const auditTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow()

const amount = (name: string) => numeric(name, { precision: 19, scale: 6 })
const rate = (name: string) => numeric(name, { precision: 9, scale: 6 })

export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceQuoteId: uuid('source_quote_id').notNull(),
    sourceQuoteRevision: integer('source_quote_revision').notNull(),
    number: text().notNull(),
    numberYear: integer('number_year').notNull(),
    numberSequence: integer('number_sequence').notNull(),
    status: text().notNull().default('open'),
    version: bigint({ mode: 'bigint' }).notNull().default(1n),

    clientId: uuid('client_id').notNull(),
    carrierId: uuid('carrier_id').references(() => carriers.id, {
      onDelete: 'restrict',
    }),
    clientLegalName: text('client_legal_name').notNull(),
    clientTradeName: text('client_trade_name'),
    clientTaxIdentifier: text('client_tax_identifier').notNull(),
    clientStateRegistration: text('client_state_registration'),
    clientEmail: text('client_email'),
    clientPhone: text('client_phone'),
    clientAddressStreet: text('client_address_street').notNull(),
    clientAddressNumber: text('client_address_number').notNull(),
    clientAddressComplement: text('client_address_complement'),
    clientAddressDistrict: text('client_address_district').notNull(),
    clientAddressCity: text('client_address_city').notNull(),
    clientAddressState: char('client_address_state', { length: 2 }).notNull(),
    clientAddressPostalCode: text('client_address_postal_code').notNull(),
    clientAddressCountryCode: char('client_address_country_code', { length: 2 })
      .notNull()
      .default('BR'),

    currencyCode: char('currency_code', { length: 3 }).notNull(),
    grossItemsAmount: amount('gross_items_amount').notNull(),
    perItemDiscountAmount: amount('per_item_discount_amount').notNull(),
    netItemsAmount: amount('net_items_amount').notNull(),
    generalDiscountRate: rate('general_discount_rate').notNull(),
    generalDiscountAmount: amount('general_discount_amount').notNull(),
    netAfterDiscountsAmount: amount('net_after_discounts_amount').notNull(),
    ipiAmount: amount('ipi_amount').notNull(),
    configuredTaxAmount: amount('configured_tax_amount').notNull(),
    freightAmount: amount('freight_amount').notNull(),
    grandTotalAmount: amount('grand_total_amount').notNull(),
    commissionBasisAmount: amount('commission_basis_amount').notNull(),
    commissionAmount: amount('commission_amount').notNull(),

    createdAt: auditTimestamp('created_at'),
    createdBy: text('created_by').notNull(),
    creationReason: text('creation_reason').notNull(),
    updatedAt: auditTimestamp('updated_at'),
    updatedBy: text('updated_by').notNull(),
    statusChangedAt: auditTimestamp('status_changed_at'),
    statusChangedBy: text('status_changed_by').notNull(),
    statusChangeReason: text('status_change_reason').notNull(),
  },
  (table) => [
    unique('orders_source_quote_uidx').on(table.sourceQuoteId),
    unique('orders_number_uidx').on(table.number),
    unique('orders_year_sequence_uidx').on(table.numberYear, table.numberSequence),
    index('orders_status_created_idx').on(table.status, table.createdAt.desc(), table.id.desc()),
    index('orders_client_created_idx').on(
      table.clientId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('orders_carrier_idx').on(table.carrierId),
    check('orders_source_quote_revision_ck', sql`${table.sourceQuoteRevision} > 0`),
    check(
      'orders_number_ck',
      sql`${table.numberYear} BETWEEN 2000 AND 9999
        AND ${table.numberSequence} BETWEEN 1 AND 999999
        AND ${table.number} = 'PED-' || ${table.numberYear}::text || '-' || lpad(${table.numberSequence}::text, 6, '0')`,
    ),
    check(
      'orders_status_ck',
      sql`${table.status} IN ('open', 'confirmed', 'invoiced', 'completed', 'cancelled')`,
    ),
    check('orders_version_ck', sql`${table.version} > 0`),
    check(
      'orders_required_text_ck',
      sql`btrim(${table.clientLegalName}) <> ''
        AND btrim(${table.clientTaxIdentifier}) <> ''
        AND btrim(${table.clientAddressStreet}) <> ''
        AND btrim(${table.clientAddressNumber}) <> ''
        AND btrim(${table.clientAddressDistrict}) <> ''
        AND btrim(${table.clientAddressCity}) <> ''
        AND btrim(${table.clientAddressPostalCode}) <> ''
        AND btrim(${table.createdBy}) <> ''
        AND btrim(${table.creationReason}) <> ''
        AND btrim(${table.updatedBy}) <> ''
        AND btrim(${table.statusChangedBy}) <> ''
        AND btrim(${table.statusChangeReason}) <> ''`,
    ),
    check(
      'orders_currency_ck',
      sql`${table.currencyCode} ~ '^[A-Z]{3}$'
        AND ${table.clientAddressState} ~ '^[A-Z]{2}$'
        AND ${table.clientAddressCountryCode} ~ '^[A-Z]{2}$'`,
    ),
    check(
      'orders_amounts_ck',
      sql`${table.grossItemsAmount} >= 0
        AND ${table.perItemDiscountAmount} >= 0
        AND ${table.perItemDiscountAmount} <= ${table.grossItemsAmount}
        AND ${table.netItemsAmount} >= 0
        AND ${table.generalDiscountRate} BETWEEN 0 AND 100
        AND ${table.generalDiscountAmount} >= 0
        AND ${table.generalDiscountAmount} <= ${table.netItemsAmount}
        AND ${table.netAfterDiscountsAmount} >= 0
        AND ${table.ipiAmount} >= 0
        AND ${table.configuredTaxAmount} >= 0
        AND ${table.freightAmount} >= 0
        AND ${table.grandTotalAmount} >= 0
        AND ${table.commissionBasisAmount} >= 0
        AND ${table.commissionAmount} >= 0`,
    ),
  ],
)

export const orderLines = pgTable(
  'order_lines',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    sourceQuoteLineId: uuid('source_quote_line_id').notNull(),
    lineNumber: integer('line_number').notNull(),

    productId: uuid('product_id').notNull(),
    productIndustryId: uuid('product_industry_id').notNull(),
    productIndustryName: text('product_industry_name').notNull(),
    productInternalCode: text('product_internal_code').notNull(),
    productManufacturerCode: text('product_manufacturer_code'),
    productDescription: text('product_description').notNull(),
    productBrand: text('product_brand'),
    productCategory: text('product_category'),
    productNcm: text('product_ncm'),
    productCest: text('product_cest'),
    productEan: text('product_ean'),
    productDun: text('product_dun'),
    productPackaging: text('product_packaging'),
    productUnit: text('product_unit').notNull(),

    quantity: amount('quantity').notNull(),
    priceListId: uuid('price_list_id').notNull(),
    productPriceVersionId: uuid('product_price_version_id').notNull(),
    unitPriceSource: text('unit_price_source').notNull(),
    unitPriceAmount: amount('unit_price_amount').notNull(),
    grossAmount: amount('gross_amount').notNull(),
    perItemDiscountRate: rate('per_item_discount_rate').notNull(),
    perItemDiscountAmount: amount('per_item_discount_amount').notNull(),
    netBeforeGeneralDiscountAmount: amount('net_before_general_discount_amount').notNull(),
    allocatedGeneralDiscountAmount: amount('allocated_general_discount_amount').notNull(),
    netAfterDiscountsAmount: amount('net_after_discounts_amount').notNull(),
    ipiRate: rate('ipi_rate').notNull(),
    ipiBasisAmount: amount('ipi_basis_amount').notNull(),
    ipiAmount: amount('ipi_amount').notNull(),
    configuredTaxAmount: amount('configured_tax_amount').notNull(),
    freightAmount: amount('freight_amount').notNull(),
    lineTotalAmount: amount('line_total_amount').notNull(),
    commissionSource: text('commission_source').notNull(),
    commissionRate: rate('commission_rate'),
    commissionBasisAmount: amount('commission_basis_amount').notNull(),
    commissionAmount: amount('commission_amount').notNull(),
    // Immutable conversion-time provenance for the commission facts above.
    commissionIndustryId: uuid('commission_industry_id'),
    commissionProvenance: text('commission_provenance'),
    createdAt: auditTimestamp('created_at'),
  },
  (table) => [
    unique('order_lines_order_line_number_uidx').on(table.orderId, table.lineNumber),
    unique('order_lines_order_quote_line_uidx').on(table.orderId, table.sourceQuoteLineId),
    index('order_lines_product_idx').on(table.productId, table.orderId),
    check('order_lines_line_number_ck', sql`${table.lineNumber} > 0`),
    check(
      'order_lines_required_text_ck',
      sql`btrim(${table.productInternalCode}) <> ''
        AND btrim(${table.productIndustryName}) <> ''
        AND btrim(${table.productDescription}) <> ''
        AND btrim(${table.productUnit}) <> ''`,
    ),
    check(
      'order_lines_source_ck',
      sql`${table.unitPriceSource} IN ('price_list', 'manual_override')
        AND ${table.commissionSource} IN ('product_override', 'industry_default', 'none')
        AND ((${table.commissionSource} = 'none' AND ${table.commissionRate} IS NULL)
          OR (${table.commissionSource} <> 'none' AND ${table.commissionRate} BETWEEN 0 AND 100))`,
    ),
    check(
      'order_lines_commission_facts_ck',
      sql`(${table.commissionSource} = 'none' AND ${table.commissionAmount} = 0)
        OR (${table.commissionSource} <> 'none'
          AND ${table.commissionBasisAmount} >= 0 AND ${table.commissionAmount} >= 0)`,
    ),
    check(
      'order_lines_commission_provenance_ck',
      sql`${table.commissionProvenance} IS NULL OR ${table.commissionProvenance} IN (
        'product_override_snapshot', 'industry_default_snapshot', 'no_rate_configured')`,
    ),
    check(
      'order_lines_amounts_ck',
      sql`${table.quantity} > 0
        AND ${table.unitPriceAmount} >= 0
        AND ${table.grossAmount} >= 0
        AND ${table.perItemDiscountRate} BETWEEN 0 AND 100
        AND ${table.perItemDiscountAmount} >= 0
        AND ${table.netBeforeGeneralDiscountAmount} >= 0
        AND ${table.allocatedGeneralDiscountAmount} >= 0
        AND ${table.netAfterDiscountsAmount} >= 0
        AND ${table.ipiRate} BETWEEN 0 AND 100
        AND ${table.ipiBasisAmount} >= 0
        AND ${table.ipiAmount} >= 0
        AND ${table.configuredTaxAmount} >= 0
        AND ${table.freightAmount} >= 0
        AND ${table.lineTotalAmount} >= 0
        AND ${table.commissionBasisAmount} >= 0
        AND ${table.commissionAmount} >= 0`,
    ),
  ],
)

export const orderLineTaxes = pgTable(
  'order_line_taxes',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderLineId: uuid('order_line_id')
      .notNull()
      .references(() => orderLines.id, { onDelete: 'restrict' }),
    code: text().notNull(),
    rate: rate('rate').notNull(),
    basisAmount: amount('basis_amount').notNull(),
    amount: amount('amount').notNull(),
    createdAt: auditTimestamp('created_at'),
  },
  (table) => [
    unique('order_line_taxes_line_code_uidx').on(table.orderLineId, table.code),
    check('order_line_taxes_code_ck', sql`btrim(${table.code}) <> ''`),
    check(
      'order_line_taxes_amounts_ck',
      sql`${table.rate} BETWEEN 0 AND 100 AND ${table.basisAmount} >= 0 AND ${table.amount} >= 0`,
    ),
  ],
)

export const orderStateAudit = pgTable(
  'order_state_audit',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actor: text().notNull(),
    reason: text().notNull(),
    occurredAt: auditTimestamp('occurred_at'),
    version: bigint({ mode: 'bigint' }).notNull(),
  },
  (table) => [
    unique('order_state_audit_order_version_uidx').on(table.orderId, table.version),
    index('order_state_audit_actor_idx').on(table.actor, table.occurredAt.desc()),
    check(
      'order_state_audit_states_ck',
      sql`(${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('open', 'confirmed', 'invoiced', 'completed', 'cancelled'))
        AND ${table.toStatus} IN ('open', 'confirmed', 'invoiced', 'completed', 'cancelled')`,
    ),
    check(
      'order_state_audit_metadata_ck',
      sql`btrim(${table.actor}) <> '' AND btrim(${table.reason}) <> '' AND ${table.version} > 0`,
    ),
  ],
)

export type OrderStatus = 'open' | 'confirmed' | 'invoiced' | 'completed' | 'cancelled'
