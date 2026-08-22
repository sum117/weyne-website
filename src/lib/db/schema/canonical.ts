import { relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  date,

  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { BusinessSettings } from '@/domain/settings/business-settings'

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
// Timestamp defaults are truncated to milliseconds. PostgreSQL `now()` has
// microsecond resolution, but every value that leaves this system round-trips
// through a JavaScript `Date`, which only carries milliseconds. Storing
// microseconds made keyset pagination cursors (which serialize that truncated
// Date) compare as strictly less than the row they came from, so the boundary
// row repeated on the next page.
const requiredInstant = (name: string) =>
  instant(name).notNull().default(sql`date_trunc('milliseconds', now())`)
const money = (name: string) => numeric(name, { precision: 19, scale: 2 })
const unitPrice = (name: string) => numeric(name, { precision: 19, scale: 6 })
const quantity = (name: string) => numeric(name, { precision: 18, scale: 6 })
const rate = (name: string) => numeric(name, { precision: 9, scale: 6 })
const uuidPk = () => uuid('id').primaryKey().defaultRandom()

export const userRoleEnum = pgEnum('user_role', ['admin', 'representative', 'read_only'])
export const productAssetKindEnum = pgEnum('product_asset_kind', [
  'image',
  'technical_sheet',
  'safety_sheet',
])
export const priceListKeyEnum = pgEnum('price_list_key', [
  'PRICE_1',
  'PRICE_2',
  'PRICE_3',
  'PRICE_4',
])
export const commissionScopeEnum = pgEnum('commission_scope', [
  'industry_default',
  'product_override',
])
export const quoteStatusEnum = pgEnum('quote_status', [
  'draft',
  'sent',
  'approved',
  'rejected',
  'expired',
  'converted',
  'cancelled',
])
export const orderStatusEnum = pgEnum('order_status', [
  'open',
  'confirmed',
  'invoiced',
  'completed',
  'cancelled',
])
export const priceSourceEnum = pgEnum('price_source', ['price_list', 'manual_override'])
export const commissionSourceEnum = pgEnum('commission_source', [
  'product_override',
  'industry_default',
  'none',
])
export const actorRoleEnum = pgEnum('actor_role', [
  'admin',
  'representative',
  'read_only',
  'system',
])
export const idempotencyStatusEnum = pgEnum('idempotency_status', [
  'in_progress',
  'completed',
])
export const documentTypeEnum = pgEnum('document_type', ['quote', 'order'])

export type TaxTotalSnapshot = Readonly<{
  code: string
  basisAmount: string
  amount: string
  includedInGrandTotal: false
}>
export type LineTaxSnapshot = TaxTotalSnapshot & Readonly<{ rate: string }>
export type DomainEventMetadata = Readonly<{ version: number; [key: string]: unknown }>

export const users = pgTable(
  'users',
  {
    id: uuidPk(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: userRoleEnum('role').notNull(),
    authSubject: text('auth_subject').notNull(),
    disabledAt: instant('disabled_at'),
    disabledByUserId: uuid('disabled_by_user_id').references((): AnyPgColumn => users.id, {
      onDelete: 'restrict',
    }),
    createdAt: requiredInstant('created_at'),
    updatedAt: requiredInstant('updated_at'),
  },
  (table) => [
    uniqueIndex('users_email_uidx').on(sql`lower(${table.email})`),
    unique('users_auth_subject_uq').on(table.authSubject),
    index('users_role_active_idx').on(table.role, table.disabledAt, table.id),
    check('users_name_ck', sql`btrim(${table.name}) <> ''`),
    check('users_email_ck', sql`btrim(${table.email}) <> ''`),
    check(
      'users_disabled_actor_ck',
      sql`(${table.disabledAt} IS NULL) = (${table.disabledByUserId} IS NULL)`,
    ),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuidPk(),
    token: text('token').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: instant('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: requiredInstant('created_at'),
    updatedAt: requiredInstant('updated_at'),
  },
  (table) => [
    unique('sessions_token_uq').on(table.token),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
)

export const accounts = pgTable(
  'accounts',
  {
    id: uuidPk(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: instant('access_token_expires_at'),
    refreshTokenExpiresAt: instant('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: requiredInstant('created_at'),
    updatedAt: requiredInstant('updated_at'),
  },
  (table) => [
    unique('accounts_provider_account_uq').on(table.providerId, table.accountId),
    index('accounts_user_id_idx').on(table.userId),
  ],
)

export const verifications = pgTable(
  'verifications',
  {
    id: uuidPk(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: instant('expires_at').notNull(),
    createdAt: requiredInstant('created_at'),
    updatedAt: requiredInstant('updated_at'),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
)

const auditableColumns = {
  createdAt: requiredInstant('created_at'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
    onDelete: 'restrict',
  }),
  updatedAt: requiredInstant('updated_at'),
  updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, {
    onDelete: 'restrict',
  }),
  archivedAt: instant('archived_at'),
  archivedByUserId: uuid('archived_by_user_id').references(() => users.id, {
    onDelete: 'restrict',
  }),
}

export const representatives = pgTable(
  'representatives',
  {
    id: uuidPk(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    internalCode: text('internal_code'),
    phone: text('phone'),
    ...auditableColumns,
  },
  (table) => [
    unique('representatives_user_id_uq').on(table.userId),
    uniqueIndex('representatives_internal_code_uidx')
      .on(table.internalCode)
      .where(sql`${table.internalCode} IS NOT NULL`),
    index('representatives_active_name_idx')
      .on(sql`lower(${table.displayName})`, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    check('representatives_display_name_ck', sql`btrim(${table.displayName}) <> ''`),
    check(
      'representatives_archive_actor_ck',
      sql`(${table.archivedAt} IS NULL) = (${table.archivedByUserId} IS NULL)`,
    ),
  ],
)

export const customers = pgTable(
  'customers',
  {
    id: uuidPk(),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    taxId: text('tax_id'),
    stateRegistration: text('state_registration'),
    streetAddress: text('street_address'),
    postalCode: text('postal_code'),
    city: text('city'),
    state: char('state', { length: 2 }),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    email: text('email'),
    contactName: text('contact_name'),
    segment: text('segment'),
    creditLimit: money('credit_limit'),
    currencyCode: char('currency_code', { length: 3 }),
    notes: text('notes'),
    responsibleRepresentativeId: uuid('responsible_representative_id').references(
      () => representatives.id,
      { onDelete: 'restrict' },
    ),
    ...auditableColumns,
  },
  (table) => [
    uniqueIndex('customers_active_tax_id_uidx')
      .on(table.taxId)
      .where(sql`${table.taxId} IS NOT NULL AND ${table.archivedAt} IS NULL`),
    index('customers_active_name_idx')
      .on(sql`lower(${table.legalName})`, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    index('customers_representative_idx').on(table.responsibleRepresentativeId, table.id),
    check('customers_legal_name_ck', sql`btrim(${table.legalName}) <> ''`),
    check('customers_credit_limit_ck', sql`${table.creditLimit} IS NULL OR ${table.creditLimit} >= 0`),
    check(
      'customers_credit_currency_ck',
      sql`(${table.creditLimit} IS NULL AND ${table.currencyCode} IS NULL)
        OR (${table.creditLimit} IS NOT NULL AND ${table.currencyCode} = 'BRL')`,
    ),
    check(
      'customers_archive_actor_ck',
      sql`(${table.archivedAt} IS NULL) = (${table.archivedByUserId} IS NULL)`,
    ),
  ],
)

export const industries = pgTable(
  'industries',
  {
    id: uuidPk(),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    taxId: text('tax_id'),
    address: text('address'),
    notes: text('notes'),
    brandName: text('brand_name'),
    logoAssetId: uuid('logo_asset_id').references((): AnyPgColumn => productAssets.id, {
      onDelete: 'restrict',
    }),
    ...auditableColumns,
  },
  (table) => [
    uniqueIndex('industries_active_tax_id_uidx')
      .on(table.taxId)
      .where(sql`${table.taxId} IS NOT NULL AND ${table.archivedAt} IS NULL`),
    index('industries_active_name_idx')
      .on(sql`lower(${table.legalName})`, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    check('industries_legal_name_ck', sql`btrim(${table.legalName}) <> ''`),
    check(
      'industries_archive_actor_ck',
      sql`(${table.archivedAt} IS NULL) = (${table.archivedByUserId} IS NULL)`,
    ),
  ],
)

export const carriers = pgTable(
  'carriers',
  {
    id: uuidPk(),
    name: text('name').notNull(),
    notes: text('notes'),
    ...auditableColumns,
  },
  (table) => [
    uniqueIndex('carriers_active_name_uidx')
      .on(sql`lower(btrim(${table.name}))`)
      .where(sql`${table.archivedAt} IS NULL`),
    index('carriers_active_name_idx')
      .on(sql`lower(${table.name})`, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    check('carriers_name_ck', sql`btrim(${table.name}) <> ''`),
    check(
      'carriers_archive_actor_ck',
      sql`(${table.archivedAt} IS NULL) = (${table.archivedByUserId} IS NULL)`,
    ),
  ],
)

export const products = pgTable(
  'products',
  {
    id: uuidPk(),
    industryId: uuid('industry_id').notNull().references(() => industries.id, {
      onDelete: 'restrict',
    }),
    internalCode: text('internal_code').notNull(),
    manufacturerCode: text('manufacturer_code'),
    description: text('description').notNull(),
    brand: text('brand'),
    category: text('category'),
    ncm: text('ncm'),
    cest: text('cest'),
    ean: text('ean'),
    dun: text('dun'),
    packaging: text('packaging'),
    unit: text('unit').notNull(),
    netWeight: quantity('net_weight'),
    grossWeight: quantity('gross_weight'),
    width: quantity('width'),
    height: quantity('height'),
    depth: quantity('depth'),
    dimensionUnit: text('dimension_unit'),
    ipiRate: rate('ipi_rate'),
    icmsRate: rate('icms_rate'),
    pisRate: rate('pis_rate'),
    cofinsRate: rate('cofins_rate'),
    ...auditableColumns,
  },
  (table) => [
    unique('products_internal_code_uq').on(table.internalCode),
    index('products_industry_idx').on(table.industryId, table.id),
    index('products_active_description_idx')
      .on(sql`lower(${table.description})`, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    check('products_required_text_ck', sql`btrim(${table.internalCode}) <> '' AND btrim(${table.description}) <> '' AND btrim(${table.unit}) <> ''`),
    check(
      'products_measurements_ck',
      sql`(${table.netWeight} IS NULL OR ${table.netWeight} >= 0)
        AND (${table.grossWeight} IS NULL OR ${table.grossWeight} >= 0)
        AND (${table.width} IS NULL OR ${table.width} >= 0)
        AND (${table.height} IS NULL OR ${table.height} >= 0)
        AND (${table.depth} IS NULL OR ${table.depth} >= 0)`,
    ),
    check(
      'products_dimension_unit_ck',
      sql`(${table.width} IS NULL AND ${table.height} IS NULL AND ${table.depth} IS NULL)
        OR (${table.dimensionUnit} IS NOT NULL AND btrim(${table.dimensionUnit}) <> '')`,
    ),
    check(
      'products_rates_ck',
      sql`(${table.ipiRate} IS NULL OR ${table.ipiRate} BETWEEN 0 AND 100)
        AND (${table.icmsRate} IS NULL OR ${table.icmsRate} BETWEEN 0 AND 100)
        AND (${table.pisRate} IS NULL OR ${table.pisRate} BETWEEN 0 AND 100)
        AND (${table.cofinsRate} IS NULL OR ${table.cofinsRate} BETWEEN 0 AND 100)`,
    ),
    check(
      'products_archive_actor_ck',
      sql`(${table.archivedAt} IS NULL) = (${table.archivedByUserId} IS NULL)`,
    ),
  ],
)

export const productAssets = pgTable(
  'product_assets',
  {
    id: uuidPk(),
    productId: uuid('product_id').notNull().references(() => products.id, {
      onDelete: 'restrict',
    }),
    kind: productAssetKindEnum('kind').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    storageKey: text('storage_key').notNull(),
    checksum: text('checksum').notNull(),
    position: integer('position'),
    createdAt: requiredInstant('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    archivedAt: instant('archived_at'),
    archivedByUserId: uuid('archived_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    unique('product_assets_storage_key_uq').on(table.storageKey),
    uniqueIndex('product_assets_active_image_position_uidx')
      .on(table.productId, table.position)
      .where(sql`${table.kind} = 'image' AND ${table.archivedAt} IS NULL`),
    uniqueIndex('product_assets_active_document_kind_uidx')
      .on(table.productId, table.kind)
      .where(sql`${table.kind} <> 'image' AND ${table.archivedAt} IS NULL`),
    index('product_assets_product_kind_idx').on(table.productId, table.kind, table.id),
    check('product_assets_size_ck', sql`${table.sizeBytes} > 0`),
    check(
      'product_assets_position_ck',
      sql`(${table.kind} = 'image' AND ${table.position} IS NOT NULL AND ${table.position} >= 0)
        OR (${table.kind} <> 'image' AND ${table.position} IS NULL)`,
    ),
    check(
      'product_assets_archive_actor_ck',
      sql`(${table.archivedAt} IS NULL) = (${table.archivedByUserId} IS NULL)`,
    ),
  ],
)

/**
 * Private document logo assets referenced by `settings.value.documents.logoAssetId`.
 *
 * Lifecycle: `staged` assets await activation; activation is the atomic swap
 * that also commits the settings reference. Active assets are permanent —
 * issued-document snapshots carry their id, so they are never purged or
 * deleted. Only abandoned staged assets may be purged. Objects live in private
 * object storage under opaque `document-logos/<uuid>` keys; no public URL ever
 * exists.
 */
export const documentLogoStatusEnum = pgEnum('document_logo_status', [
  'staged',
  'active',
  'purged',
])

export const documentLogoAssets = pgTable(
  'document_logo_assets',
  {
    id: uuidPk(),
    status: documentLogoStatusEnum('status').notNull().default('staged'),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    checksumSha256: char('checksum_sha256', { length: 64 }).notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: requiredInstant('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    activatedAt: instant('activated_at'),
    activatedByUserId: uuid('activated_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    purgedAt: instant('purged_at'),
    purgedByUserId: uuid('purged_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    unique('document_logo_assets_object_key_uidx').on(table.objectKey),
    index('document_logo_assets_status_created_idx').on(
      table.status,
      table.createdAt,
      table.id,
    ),
    check(
      'document_logo_assets_size_ck',
      sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 2097152`,
    ),
    check(
      'document_logo_assets_mime_ck',
      sql`${table.mimeType} IN ('image/png', 'image/jpeg', 'image/webp')`,
    ),
    check(
      'document_logo_assets_checksum_ck',
      sql`${table.checksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'document_logo_assets_object_key_ck',
      sql`${table.objectKey} ~ '^document-logos/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      'document_logo_assets_filename_ck',
      sql`btrim(${table.originalFilename}) <> '' AND char_length(${table.originalFilename}) <= 255`,
    ),
    check(
      'document_logo_assets_dimensions_ck',
      sql`(${table.width} IS NULL AND ${table.height} IS NULL)
        OR (${table.width} > 0 AND ${table.height} > 0)`,
    ),
    check(
      'document_logo_assets_lifecycle_ck',
      sql`(${table.status} = 'staged' AND ${table.activatedAt} IS NULL AND ${table.activatedByUserId} IS NULL AND ${table.purgedAt} IS NULL AND ${table.purgedByUserId} IS NULL)
        OR (${table.status} = 'active' AND ${table.activatedAt} IS NOT NULL AND ${table.activatedByUserId} IS NOT NULL AND ${table.purgedAt} IS NULL AND ${table.purgedByUserId} IS NULL)
        OR (${table.status} = 'purged' AND ${table.purgedAt} IS NOT NULL AND ${table.purgedByUserId} IS NOT NULL)`,
    ),
  ],
)

export const priceLists = pgTable(
  'price_lists',
  {
    id: uuidPk(),
    key: priceListKeyEnum('key').notNull(),
    displayName: text('display_name').notNull(),
    position: smallint('position').notNull(),
    createdAt: requiredInstant('created_at'),
    updatedAt: requiredInstant('updated_at'),
  },
  (table) => [
    unique('price_lists_key_uq').on(table.key),
    unique('price_lists_position_uq').on(table.position),
    check(
      'price_lists_key_position_ck',
      sql`(${table.key} = 'PRICE_1' AND ${table.position} = 1)
        OR (${table.key} = 'PRICE_2' AND ${table.position} = 2)
        OR (${table.key} = 'PRICE_3' AND ${table.position} = 3)
        OR (${table.key} = 'PRICE_4' AND ${table.position} = 4)`,
    ),
  ],
)

export const productPrices = pgTable(
  'product_prices',
  {
    id: uuidPk(),
    productId: uuid('product_id').notNull().references(() => products.id, {
      onDelete: 'restrict',
    }),
    priceListId: uuid('price_list_id').notNull().references(() => priceLists.id, {
      onDelete: 'restrict',
    }),
    amount: unitPrice('amount').notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('BRL'),
    validFrom: instant('valid_from').notNull(),
    validTo: instant('valid_to'),
    createdAt: requiredInstant('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    endedByUserId: uuid('ended_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    reason: text('reason').notNull(),
  },
  (table) => [
    uniqueIndex('product_prices_current_uidx')
      .on(table.productId, table.priceListId)
      .where(sql`${table.validTo} IS NULL`),
    index('product_prices_history_idx').on(
      table.productId,
      table.priceListId,
      table.validFrom.desc(),
      table.id.desc(),
    ),
    check('product_prices_amount_ck', sql`${table.amount} >= 0`),
    check('product_prices_currency_ck', sql`${table.currencyCode} = 'BRL'`),
    check('product_prices_reason_ck', sql`btrim(${table.reason}) <> ''`),
    check(
      'product_prices_validity_ck',
      sql`(${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom})
        AND ((${table.validTo} IS NULL) = (${table.endedByUserId} IS NULL))`,
    ),
  ],
)

export const commissionRules = pgTable(
  'commission_rules',
  {
    id: uuidPk(),
    scope: commissionScopeEnum('scope').notNull(),
    industryId: uuid('industry_id').references(() => industries.id, { onDelete: 'restrict' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
    rate: rate('rate').notNull(),
    validFrom: instant('valid_from').notNull(),
    validTo: instant('valid_to'),
    createdAt: requiredInstant('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    endedByUserId: uuid('ended_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    uniqueIndex('commission_rules_current_industry_uidx')
      .on(table.industryId)
      .where(sql`${table.scope} = 'industry_default' AND ${table.validTo} IS NULL`),
    uniqueIndex('commission_rules_current_product_uidx')
      .on(table.productId)
      .where(sql`${table.scope} = 'product_override' AND ${table.validTo} IS NULL`),
    index('commission_rules_industry_history_idx').on(table.industryId, table.validFrom.desc()),
    index('commission_rules_product_history_idx').on(table.productId, table.validFrom.desc()),
    check('commission_rules_rate_ck', sql`${table.rate} BETWEEN 0 AND 100`),
    check(
      'commission_rules_target_ck',
      sql`(${table.scope} = 'industry_default' AND ${table.industryId} IS NOT NULL AND ${table.productId} IS NULL)
        OR (${table.scope} = 'product_override' AND ${table.productId} IS NOT NULL AND ${table.industryId} IS NULL)`,
    ),
    check(
      'commission_rules_validity_ck',
      sql`(${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom})
        AND ((${table.validTo} IS NULL) = (${table.endedByUserId} IS NULL))`,
    ),
  ],
)

export const quotes = pgTable(
  'quotes',
  {
    id: uuidPk(),
    number: text('number').notNull(),
    status: quoteStatusEnum('status').notNull().default('draft'),
    customerId: uuid('customer_id').notNull().references(() => customers.id, {
      onDelete: 'restrict',
    }),
    representativeId: uuid('representative_id').notNull().references(() => representatives.id, {
      onDelete: 'restrict',
    }),
    priceListId: uuid('price_list_id').notNull().references(() => priceLists.id, {
      onDelete: 'restrict',
    }),
    carrierId: uuid('carrier_id').references(() => carriers.id, { onDelete: 'restrict' }),
    validUntil: date('valid_until', { mode: 'string' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('BRL'),
    customerLegalNameSnapshot: text('customer_legal_name_snapshot').notNull(),
    customerTradeNameSnapshot: text('customer_trade_name_snapshot'),
    customerTaxIdSnapshot: text('customer_tax_id_snapshot'),
    customerAddressSnapshot: text('customer_address_snapshot'),
    representativeNameSnapshot: text('representative_name_snapshot').notNull(),
    priceListKeySnapshot: priceListKeyEnum('price_list_key_snapshot').notNull(),
    priceListNameSnapshot: text('price_list_name_snapshot').notNull(),
    carrierNameSnapshot: text('carrier_name_snapshot'),
    freightTerms: text('freight_terms'),
    paymentTerms: text('payment_terms'),
    notes: text('notes'),
    overallDiscountRate: rate('overall_discount_rate'),
    grossAmount: money('gross_amount').notNull(),
    lineDiscountAmount: money('line_discount_amount').notNull(),
    netAfterLineDiscountAmount: money('net_after_line_discount_amount').notNull(),
    overallDiscountAmount: money('overall_discount_amount').notNull(),
    netMerchandiseAmount: money('net_merchandise_amount').notNull(),
    taxTotalsSnapshot: jsonb('tax_totals_snapshot').$type<readonly TaxTotalSnapshot[]>().notNull(),
    freightAmount: money('freight_amount').notNull(),
    grandTotalAmount: money('grand_total_amount').notNull(),
    commissionBasisAmount: money('commission_basis_amount').notNull(),
    commissionValueAmount: money('commission_value_amount').notNull(),
    sentAt: instant('sent_at'),
    sentByUserId: uuid('sent_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: instant('approved_at'),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    rejectedAt: instant('rejected_at'),
    rejectedByUserId: uuid('rejected_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    rejectionReason: text('rejection_reason'),
    cancelledAt: instant('cancelled_at'),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    cancellationReason: text('cancellation_reason'),
    expiredAt: instant('expired_at'),
    convertedAt: instant('converted_at'),
    convertedByUserId: uuid('converted_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    convertedOrderId: uuid('converted_order_id').references((): AnyPgColumn => orders.id, {
      onDelete: 'restrict',
    }),
    duplicatedFromQuoteId: uuid('duplicated_from_quote_id').references(
      (): AnyPgColumn => quotes.id,
      { onDelete: 'restrict' },
    ),
    createdAt: requiredInstant('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    updatedAt: requiredInstant('updated_at'),
    updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    unique('quotes_number_uq').on(table.number),
    uniqueIndex('quotes_converted_order_uidx')
      .on(table.convertedOrderId)
      .where(sql`${table.convertedOrderId} IS NOT NULL`),
    index('quotes_status_created_idx').on(table.status, table.createdAt.desc(), table.id.desc()),
    index('quotes_customer_idx').on(table.customerId, table.createdAt.desc()),
    index('quotes_representative_idx').on(table.representativeId, table.createdAt.desc()),
    check('quotes_number_ck', sql`${table.number} ~ '^ORC-[0-9]{4}-[0-9]{6}$'`),
    check('quotes_currency_ck', sql`${table.currencyCode} = 'BRL'`),
    check(
      'quotes_amounts_ck',
      sql`${table.grossAmount} >= 0 AND ${table.lineDiscountAmount} >= 0
        AND ${table.netAfterLineDiscountAmount} >= 0 AND ${table.overallDiscountAmount} >= 0
        AND ${table.netMerchandiseAmount} >= 0 AND ${table.freightAmount} >= 0
        AND ${table.grandTotalAmount} >= 0 AND ${table.commissionBasisAmount} >= 0
        AND ${table.commissionValueAmount} >= 0
        AND (${table.overallDiscountRate} IS NULL OR ${table.overallDiscountRate} BETWEEN 0 AND 100)`,
    ),
    check(
      'quotes_carrier_snapshot_ck',
      sql`(${table.carrierId} IS NULL AND ${table.carrierNameSnapshot} IS NULL)
        OR (${table.carrierId} IS NOT NULL AND ${table.carrierNameSnapshot} IS NOT NULL AND btrim(${table.carrierNameSnapshot}) <> '')`,
    ),
    check(
      'quotes_workflow_pairs_ck',
      sql`((${table.sentAt} IS NULL) = (${table.sentByUserId} IS NULL))
        AND ((${table.approvedAt} IS NULL) = (${table.approvedByUserId} IS NULL))
        AND ((${table.rejectedAt} IS NULL) = (${table.rejectedByUserId} IS NULL))
        AND ((${table.cancelledAt} IS NULL) = (${table.cancelledByUserId} IS NULL))
        AND ((${table.convertedAt} IS NULL) = (${table.convertedByUserId} IS NULL))`,
    ),
    check(
      'quotes_workflow_reasons_ck',
      sql`(${table.rejectedAt} IS NULL OR (${table.rejectionReason} IS NOT NULL AND btrim(${table.rejectionReason}) <> ''))
        AND (${table.cancelledAt} IS NULL OR (${table.cancellationReason} IS NOT NULL AND btrim(${table.cancellationReason}) <> ''))`,
    ),
    check(
      'quotes_conversion_ck',
      sql`(${table.status} = 'converted'
          AND ${table.convertedOrderId} IS NOT NULL
          AND ${table.convertedAt} IS NOT NULL
          AND ${table.convertedByUserId} IS NOT NULL)
        OR (${table.status} <> 'converted'
          AND ${table.convertedOrderId} IS NULL
          AND ${table.convertedAt} IS NULL
          AND ${table.convertedByUserId} IS NULL)`,
    ),
    check('quotes_tax_totals_json_ck', sql`jsonb_typeof(${table.taxTotalsSnapshot}) = 'array'`),
  ],
)

const lineSnapshotColumns = {
  position: integer('position').notNull(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  productPriceId: uuid('product_price_id').notNull().references(() => productPrices.id, {
    onDelete: 'restrict',
  }),
  priceSource: priceSourceEnum('price_source').notNull(),
  productCodeSnapshot: text('product_code_snapshot').notNull(),
  productDescriptionSnapshot: text('product_description_snapshot').notNull(),
  manufacturerCodeSnapshot: text('manufacturer_code_snapshot'),
  brandSnapshot: text('brand_snapshot'),
  packagingSnapshot: text('packaging_snapshot'),
  unitSnapshot: text('unit_snapshot').notNull(),
  industryIdSnapshot: uuid('industry_id_snapshot').notNull().references(() => industries.id, {
    onDelete: 'restrict',
  }),
  industryNameSnapshot: text('industry_name_snapshot').notNull(),
  priceListIdSnapshot: uuid('price_list_id_snapshot').notNull().references(() => priceLists.id, {
    onDelete: 'restrict',
  }),
  priceListKeySnapshot: priceListKeyEnum('price_list_key_snapshot').notNull(),
  priceListNameSnapshot: text('price_list_name_snapshot').notNull(),
  unitPriceSnapshot: unitPrice('unit_price_snapshot').notNull(),
  currencyCode: char('currency_code', { length: 3 }).notNull().default('BRL'),
  quantity: quantity('quantity').notNull(),
  lineDiscountRate: rate('line_discount_rate').notNull(),
  grossAmountSnapshot: money('gross_amount_snapshot').notNull(),
  lineDiscountAmountSnapshot: money('line_discount_amount_snapshot').notNull(),
  netAfterLineDiscountAmountSnapshot: money('net_after_line_discount_amount_snapshot').notNull(),
  overallDiscountAllocationAmountSnapshot: money('overall_discount_allocation_amount_snapshot').notNull(),
  netMerchandiseAmountSnapshot: money('net_merchandise_amount_snapshot').notNull(),
  taxesSnapshot: jsonb('taxes_snapshot').$type<readonly LineTaxSnapshot[]>().notNull(),
  ipiRateSnapshot: rate('ipi_rate_snapshot'),
  icmsRateSnapshot: rate('icms_rate_snapshot'),
  pisRateSnapshot: rate('pis_rate_snapshot'),
  cofinsRateSnapshot: rate('cofins_rate_snapshot'),
  commissionRuleId: uuid('commission_rule_id').references(() => commissionRules.id, {
    onDelete: 'restrict',
  }),
  commissionSourceSnapshot: commissionSourceEnum('commission_source_snapshot').notNull(),
  commissionRateSnapshot: rate('commission_rate_snapshot'),
  commissionBasisAmountSnapshot: money('commission_basis_amount_snapshot').notNull(),
  commissionValueAmountSnapshot: money('commission_value_amount_snapshot'),
}

type LineExtraConfig = Record<keyof typeof lineSnapshotColumns, AnyPgColumn>

const lineChecks = (table: LineExtraConfig) => [
  check('line_position_ck', sql`${table.position} > 0`),
  check('line_quantity_ck', sql`${table.quantity} > 0`),
  check('line_currency_ck', sql`${table.currencyCode} = 'BRL'`),
  check(
    'line_rates_ck',
    sql`${table.lineDiscountRate} BETWEEN 0 AND 100
      AND (${table.ipiRateSnapshot} IS NULL OR ${table.ipiRateSnapshot} BETWEEN 0 AND 100)
      AND (${table.icmsRateSnapshot} IS NULL OR ${table.icmsRateSnapshot} BETWEEN 0 AND 100)
      AND (${table.pisRateSnapshot} IS NULL OR ${table.pisRateSnapshot} BETWEEN 0 AND 100)
      AND (${table.cofinsRateSnapshot} IS NULL OR ${table.cofinsRateSnapshot} BETWEEN 0 AND 100)`,
  ),
  check(
    'line_amounts_ck',
    sql`${table.unitPriceSnapshot} >= 0 AND ${table.grossAmountSnapshot} >= 0
      AND ${table.lineDiscountAmountSnapshot} >= 0
      AND ${table.netAfterLineDiscountAmountSnapshot} >= 0
      AND ${table.overallDiscountAllocationAmountSnapshot} >= 0
      AND ${table.netMerchandiseAmountSnapshot} >= 0
      AND ${table.commissionBasisAmountSnapshot} >= 0
      AND (${table.commissionValueAmountSnapshot} IS NULL OR ${table.commissionValueAmountSnapshot} >= 0)`,
  ),
  check(
    'line_commission_ck',
    sql`(${table.commissionSourceSnapshot} = 'none'
        AND ${table.commissionRateSnapshot} IS NULL
        AND ${table.commissionValueAmountSnapshot} IS NULL
        AND ${table.commissionRuleId} IS NULL)
      OR (${table.commissionSourceSnapshot} <> 'none'
        AND ${table.commissionRateSnapshot} BETWEEN 0 AND 100
        AND ${table.commissionValueAmountSnapshot} IS NOT NULL)`,
  ),
  check('line_taxes_json_ck', sql`jsonb_typeof(${table.taxesSnapshot}) = 'array'`),
]

export const quoteLines = pgTable(
  'quote_lines',
  {
    id: uuidPk(),
    quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'restrict' }),
    ...lineSnapshotColumns,
    createdAt: requiredInstant('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    updatedAt: requiredInstant('updated_at'),
    updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    unique('quote_lines_quote_position_uq').on(table.quoteId, table.position),
    index('quote_lines_product_idx').on(table.productId, table.quoteId),
    ...lineChecks(table).map((constraint, position) => {
      constraint.name = `quote_lines_${['position', 'quantity', 'currency', 'rates', 'amounts', 'commission', 'taxes_json'][position]}_ck`
      return constraint
    }),
  ],
)

export const orders = pgTable(
  'orders',
  {
    id: uuidPk(),
    sourceQuoteId: uuid('source_quote_id').notNull().references(() => quotes.id, {
      onDelete: 'restrict',
    }),
    number: text('number').notNull(),
    status: orderStatusEnum('status').notNull().default('open'),
    customerId: uuid('customer_id').notNull().references(() => customers.id, {
      onDelete: 'restrict',
    }),
    representativeId: uuid('representative_id').notNull().references(() => representatives.id, {
      onDelete: 'restrict',
    }),
    priceListId: uuid('price_list_id').notNull().references(() => priceLists.id, {
      onDelete: 'restrict',
    }),
    carrierId: uuid('carrier_id').references(() => carriers.id, { onDelete: 'restrict' }),
    customerLegalNameSnapshot: text('customer_legal_name_snapshot').notNull(),
    customerTradeNameSnapshot: text('customer_trade_name_snapshot'),
    customerTaxIdSnapshot: text('customer_tax_id_snapshot'),
    customerAddressSnapshot: text('customer_address_snapshot'),
    representativeNameSnapshot: text('representative_name_snapshot').notNull(),
    priceListKeySnapshot: priceListKeyEnum('price_list_key_snapshot').notNull(),
    priceListNameSnapshot: text('price_list_name_snapshot').notNull(),
    carrierNameSnapshot: text('carrier_name_snapshot'),
    validUntilSnapshot: date('valid_until_snapshot', { mode: 'string' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('BRL'),
    freightTerms: text('freight_terms'),
    paymentTerms: text('payment_terms'),
    notes: text('notes'),
    overallDiscountRate: rate('overall_discount_rate'),
    grossAmount: money('gross_amount').notNull(),
    lineDiscountAmount: money('line_discount_amount').notNull(),
    netAfterLineDiscountAmount: money('net_after_line_discount_amount').notNull(),
    overallDiscountAmount: money('overall_discount_amount').notNull(),
    netMerchandiseAmount: money('net_merchandise_amount').notNull(),
    taxTotalsSnapshot: jsonb('tax_totals_snapshot').$type<readonly TaxTotalSnapshot[]>().notNull(),
    freightAmount: money('freight_amount').notNull(),
    grandTotalAmount: money('grand_total_amount').notNull(),
    commissionBasisAmount: money('commission_basis_amount').notNull(),
    commissionValueAmount: money('commission_value_amount').notNull(),
    confirmedAt: instant('confirmed_at'),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    invoicedAt: instant('invoiced_at'),
    invoicedByUserId: uuid('invoiced_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    invoiceReference: text('invoice_reference'),
    completedAt: instant('completed_at'),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    cancelledAt: instant('cancelled_at'),
    cancelledByUserId: uuid('cancelled_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    cancellationReason: text('cancellation_reason'),
    createdAt: requiredInstant('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    updatedAt: requiredInstant('updated_at'),
  },
  (table) => [
    unique('orders_source_quote_uq').on(table.sourceQuoteId),
    unique('orders_number_uq').on(table.number),
    index('orders_status_created_idx').on(table.status, table.createdAt.desc(), table.id.desc()),
    index('orders_customer_idx').on(table.customerId, table.createdAt.desc()),
    index('orders_representative_idx').on(table.representativeId, table.createdAt.desc()),
    check('orders_number_ck', sql`${table.number} ~ '^PED-[0-9]{4}-[0-9]{6}$'`),
    check('orders_currency_ck', sql`${table.currencyCode} = 'BRL'`),
    check(
      'orders_amounts_ck',
      sql`${table.grossAmount} >= 0 AND ${table.lineDiscountAmount} >= 0
        AND ${table.netAfterLineDiscountAmount} >= 0 AND ${table.overallDiscountAmount} >= 0
        AND ${table.netMerchandiseAmount} >= 0 AND ${table.freightAmount} >= 0
        AND ${table.grandTotalAmount} >= 0 AND ${table.commissionBasisAmount} >= 0
        AND ${table.commissionValueAmount} >= 0
        AND (${table.overallDiscountRate} IS NULL OR ${table.overallDiscountRate} BETWEEN 0 AND 100)`,
    ),
    check(
      'orders_workflow_pairs_ck',
      sql`((${table.confirmedAt} IS NULL) = (${table.confirmedByUserId} IS NULL))
        AND ((${table.invoicedAt} IS NULL) = (${table.invoicedByUserId} IS NULL))
        AND ((${table.completedAt} IS NULL) = (${table.completedByUserId} IS NULL))
        AND ((${table.cancelledAt} IS NULL) = (${table.cancelledByUserId} IS NULL))`,
    ),
    check(
      'orders_carrier_snapshot_ck',
      sql`(${table.carrierId} IS NULL AND ${table.carrierNameSnapshot} IS NULL)
        OR (${table.carrierId} IS NOT NULL AND ${table.carrierNameSnapshot} IS NOT NULL AND btrim(${table.carrierNameSnapshot}) <> '')`,
    ),
    check(
      'orders_cancellation_ck',
      sql`${table.cancelledAt} IS NULL OR (${table.cancellationReason} IS NOT NULL AND btrim(${table.cancellationReason}) <> '')`,
    ),
    check('orders_tax_totals_json_ck', sql`jsonb_typeof(${table.taxTotalsSnapshot}) = 'array'`),
  ],
)

export const orderLines = pgTable(
  'order_lines',
  {
    id: uuidPk(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
    sourceQuoteLineId: uuid('source_quote_line_id').notNull().references(() => quoteLines.id, {
      onDelete: 'restrict',
    }),
    quoteLinePositionSnapshot: integer('quote_line_position_snapshot').notNull(),
    ...lineSnapshotColumns,
    createdAt: requiredInstant('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    unique('order_lines_order_position_uq').on(table.orderId, table.position),
    unique('order_lines_source_quote_line_uq').on(table.sourceQuoteLineId),
    index('order_lines_product_idx').on(table.productId, table.orderId),
    check('order_lines_quote_position_ck', sql`${table.quoteLinePositionSnapshot} > 0`),
    ...lineChecks(table).map((constraint, position) => {
      constraint.name = `order_lines_${['position', 'quantity', 'currency', 'rates', 'amounts', 'commission', 'taxes_json'][position]}_ck`
      return constraint
    }),
  ],
)

export const quoteEvents = pgTable(
  'quote_events',
  {
    id: uuidPk(),
    quoteId: uuid('quote_id').notNull().references(() => quotes.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    fromStatus: quoteStatusEnum('from_status'),
    toStatus: quoteStatusEnum('to_status'),
    occurredAt: requiredInstant('occurred_at'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorRole: actorRoleEnum('actor_role').notNull(),
    commandId: uuid('command_id').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<DomainEventMetadata>().notNull(),
  },
  (table) => [
    index('quote_events_history_idx').on(table.quoteId, table.occurredAt, table.id),
    index('quote_events_command_idx').on(table.commandId),
    check('quote_events_type_ck', sql`btrim(${table.eventType}) <> ''`),
    check(
      'quote_events_actor_ck',
      sql`(${table.actorRole} = 'system' AND ${table.actorUserId} IS NULL)
        OR (${table.actorRole} <> 'system' AND ${table.actorUserId} IS NOT NULL)`,
    ),
    check(
      'quote_events_metadata_ck',
      sql`jsonb_typeof(${table.metadata}) = 'object'
        AND jsonb_typeof(${table.metadata}->'version') = 'number'
        AND (${table.metadata}->>'version')::numeric > 0
        AND mod((${table.metadata}->>'version')::numeric, 1) = 0`,
    ),
  ],
)

export const orderEvents = pgTable(
  'order_events',
  {
    id: uuidPk(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    fromStatus: orderStatusEnum('from_status'),
    toStatus: orderStatusEnum('to_status'),
    occurredAt: requiredInstant('occurred_at'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorRole: actorRoleEnum('actor_role').notNull(),
    commandId: uuid('command_id').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<DomainEventMetadata>().notNull(),
  },
  (table) => [
    index('order_events_history_idx').on(table.orderId, table.occurredAt, table.id),
    index('order_events_command_idx').on(table.commandId),
    check('order_events_type_ck', sql`btrim(${table.eventType}) <> ''`),
    check(
      'order_events_actor_ck',
      sql`(${table.actorRole} = 'system' AND ${table.actorUserId} IS NULL)
        OR (${table.actorRole} <> 'system' AND ${table.actorUserId} IS NOT NULL)`,
    ),
    check(
      'order_events_metadata_ck',
      sql`jsonb_typeof(${table.metadata}) = 'object'
        AND jsonb_typeof(${table.metadata}->'version') = 'number'
        AND (${table.metadata}->>'version')::numeric > 0
        AND mod((${table.metadata}->>'version')::numeric, 1) = 0`,
    ),
  ],
)

export const attachments = pgTable(
  'attachments',
  {
    id: uuidPk(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'restrict' }),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    storageKey: text('storage_key').notNull(),
    checksum: text('checksum').notNull(),
    uploadedAt: requiredInstant('uploaded_at'),
    uploadedByUserId: uuid('uploaded_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    archivedAt: instant('archived_at'),
    archivedByUserId: uuid('archived_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    unique('attachments_storage_key_uq').on(table.storageKey),
    index('attachments_active_order_idx')
      .on(table.orderId, table.uploadedAt.desc(), table.id.desc())
      .where(sql`${table.archivedAt} IS NULL`),
    check('attachments_size_ck', sql`${table.sizeBytes} > 0`),
    check(
      'attachments_archive_actor_ck',
      sql`(${table.archivedAt} IS NULL) = (${table.archivedByUserId} IS NULL)`,
    ),
  ],
)

export const recordAssignments = pgTable(
  'record_assignments',
  {
    id: uuidPk(),
    assigneeUserId: uuid('assignee_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
    quoteId: uuid('quote_id').references(() => quotes.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
    createdAt: requiredInstant('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    revokedAt: instant('revoked_at'),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    uniqueIndex('record_assignments_active_customer_uidx')
      .on(table.assigneeUserId, table.customerId)
      .where(sql`${table.customerId} IS NOT NULL AND ${table.revokedAt} IS NULL`),
    uniqueIndex('record_assignments_active_quote_uidx')
      .on(table.assigneeUserId, table.quoteId)
      .where(sql`${table.quoteId} IS NOT NULL AND ${table.revokedAt} IS NULL`),
    uniqueIndex('record_assignments_active_order_uidx')
      .on(table.assigneeUserId, table.orderId)
      .where(sql`${table.orderId} IS NOT NULL AND ${table.revokedAt} IS NULL`),
    index('record_assignments_assignee_idx').on(table.assigneeUserId, table.revokedAt, table.id),
    check(
      'record_assignments_target_ck',
      sql`num_nonnulls(${table.customerId}, ${table.quoteId}, ${table.orderId}) = 1`,
    ),
    check(
      'record_assignments_revocation_ck',
      sql`(${table.revokedAt} IS NULL) = (${table.revokedByUserId} IS NULL)`,
    ),
  ],
)

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: uuidPk(),
    commandType: text('command_type').notNull(),
    commandId: uuid('command_id').notNull(),
    actorUserId: uuid('actor_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    payloadHash: text('payload_hash').notNull(),
    status: idempotencyStatusEnum('status').notNull(),
    resultEntityType: text('result_entity_type'),
    resultEntityId: uuid('result_entity_id'),
    responseSnapshot: jsonb('response_snapshot').$type<Readonly<Record<string, unknown>>>(),
    createdAt: requiredInstant('created_at'),
    completedAt: instant('completed_at'),
  },
  (table) => [
    unique('idempotency_records_command_uq').on(table.commandType, table.commandId),
    index('idempotency_records_actor_created_idx').on(table.actorUserId, table.createdAt.desc()),
    check('idempotency_records_hash_ck', sql`btrim(${table.payloadHash}) <> ''`),
    check(
      'idempotency_records_result_ck',
      sql`(${table.status} = 'in_progress' AND ${table.completedAt} IS NULL
          AND ${table.resultEntityType} IS NULL AND ${table.resultEntityId} IS NULL
          AND ${table.responseSnapshot} IS NULL)
        OR (${table.status} = 'completed' AND ${table.completedAt} IS NOT NULL
          AND ${table.resultEntityType} IS NOT NULL AND ${table.resultEntityId} IS NOT NULL
          AND ${table.responseSnapshot} IS NOT NULL)`,
    ),
    check(
      'idempotency_records_response_json_ck',
      sql`${table.responseSnapshot} IS NULL OR jsonb_typeof(${table.responseSnapshot}) = 'object'`,
    ),
  ],
)

export const documentSequences = pgTable(
  'document_sequences',
  {
    documentType: documentTypeEnum('document_type').notNull(),
    year: integer('year').notNull(),
    nextValue: integer('next_value').notNull().default(1),
    updatedAt: requiredInstant('updated_at'),
  },
  (table) => [
    primaryKey({ name: 'document_sequences_pk', columns: [table.documentType, table.year] }),
    check('document_sequences_year_ck', sql`${table.year} BETWEEN 2000 AND 9999`),
    check('document_sequences_next_value_ck', sql`${table.nextValue} >= 1`),
  ],
)

export const settings = pgTable(
  'settings',
  {
    id: uuidPk(),
    key: text('key').notNull(),
    value: jsonb('value').$type<BusinessSettings>().notNull(),
    version: integer('version').notNull().default(1),
    createdAt: requiredInstant('created_at'),
    createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
    updatedAt: requiredInstant('updated_at'),
    updatedByUserId: uuid('updated_by_user_id').notNull().references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    unique('settings_key_uq').on(table.key),
    check('settings_key_ck', sql`${table.key} = 'business'`),
    check('settings_version_ck', sql`${table.version} > 0`),
    check('settings_value_json_ck', sql`jsonb_typeof(${table.value}) = 'object'`),
  ],
)

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuidPk(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorRole: actorRoleEnum('actor_role').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    occurredAt: requiredInstant('occurred_at'),
    correlationId: uuid('correlation_id').notNull(),
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>(),
    metadata: jsonb('metadata').$type<Readonly<Record<string, unknown>>>().notNull(),
  },
  (table) => [
    index('audit_events_occurred_idx').on(table.occurredAt.desc(), table.id.desc()),
    index('audit_events_actor_idx').on(table.actorUserId, table.occurredAt.desc()),
    index('audit_events_entity_idx').on(table.entityType, table.entityId, table.occurredAt.desc()),
    index('audit_events_correlation_idx').on(table.correlationId),
    check('audit_events_action_ck', sql`btrim(${table.action}) <> ''`),
    check('audit_events_entity_type_ck', sql`btrim(${table.entityType}) <> ''`),
    check(
      'audit_events_actor_ck',
      sql`(${table.actorRole} = 'system' AND ${table.actorUserId} IS NULL)
        OR (${table.actorRole} <> 'system' AND ${table.actorUserId} IS NOT NULL)`,
    ),
    check('audit_events_metadata_json_ck', sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
)

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  representative: one(representatives, {
    fields: [users.id],
    references: [representatives.userId],
  }),
}))
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))
export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))
export const representativesRelations = relations(representatives, ({ one, many }) => ({
  user: one(users, { fields: [representatives.userId], references: [users.id] }),
  customers: many(customers),
  quotes: many(quotes),
  orders: many(orders),
}))
export const customersRelations = relations(customers, ({ one, many }) => ({
  responsibleRepresentative: one(representatives, {
    fields: [customers.responsibleRepresentativeId],
    references: [representatives.id],
  }),
  quotes: many(quotes),
  orders: many(orders),
}))
export const industriesRelations = relations(industries, ({ many }) => ({
  products: many(products),
  commissionRules: many(commissionRules),
}))
export const productsRelations = relations(products, ({ one, many }) => ({
  industry: one(industries, { fields: [products.industryId], references: [industries.id] }),
  assets: many(productAssets),
  prices: many(productPrices),
  commissionRules: many(commissionRules),
}))
export const productAssetsRelations = relations(productAssets, ({ one }) => ({
  product: one(products, { fields: [productAssets.productId], references: [products.id] }),
}))
export const priceListsRelations = relations(priceLists, ({ many }) => ({
  productPrices: many(productPrices),
  quotes: many(quotes),
  orders: many(orders),
}))
export const productPricesRelations = relations(productPrices, ({ one, many }) => ({
  product: one(products, { fields: [productPrices.productId], references: [products.id] }),
  priceList: one(priceLists, { fields: [productPrices.priceListId], references: [priceLists.id] }),
  quoteLines: many(quoteLines),
  orderLines: many(orderLines),
}))
export const commissionRulesRelations = relations(commissionRules, ({ one, many }) => ({
  industry: one(industries, { fields: [commissionRules.industryId], references: [industries.id] }),
  product: one(products, { fields: [commissionRules.productId], references: [products.id] }),
  quoteLines: many(quoteLines),
  orderLines: many(orderLines),
}))
export const quotesRelations = relations(quotes, ({ one, many }) => ({
  customer: one(customers, { fields: [quotes.customerId], references: [customers.id] }),
  representative: one(representatives, {
    fields: [quotes.representativeId],
    references: [representatives.id],
  }),
  priceList: one(priceLists, { fields: [quotes.priceListId], references: [priceLists.id] }),
  carrier: one(carriers, { fields: [quotes.carrierId], references: [carriers.id] }),
  lines: many(quoteLines),
  events: many(quoteEvents),
  order: one(orders, { fields: [quotes.id], references: [orders.sourceQuoteId] }),
}))
export const quoteLinesRelations = relations(quoteLines, ({ one }) => ({
  quote: one(quotes, { fields: [quoteLines.quoteId], references: [quotes.id] }),
  product: one(products, { fields: [quoteLines.productId], references: [products.id] }),
  productPrice: one(productPrices, {
    fields: [quoteLines.productPriceId],
    references: [productPrices.id],
  }),
  commissionRule: one(commissionRules, {
    fields: [quoteLines.commissionRuleId],
    references: [commissionRules.id],
  }),
}))
export const ordersRelations = relations(orders, ({ one, many }) => ({
  sourceQuote: one(quotes, { fields: [orders.sourceQuoteId], references: [quotes.id] }),
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  representative: one(representatives, {
    fields: [orders.representativeId],
    references: [representatives.id],
  }),
  priceList: one(priceLists, { fields: [orders.priceListId], references: [priceLists.id] }),
  carrier: one(carriers, { fields: [orders.carrierId], references: [carriers.id] }),
  lines: many(orderLines),
  events: many(orderEvents),
  attachments: many(attachments),
}))
export const orderLinesRelations = relations(orderLines, ({ one }) => ({
  order: one(orders, { fields: [orderLines.orderId], references: [orders.id] }),
  sourceQuoteLine: one(quoteLines, {
    fields: [orderLines.sourceQuoteLineId],
    references: [quoteLines.id],
  }),
  product: one(products, { fields: [orderLines.productId], references: [products.id] }),
  productPrice: one(productPrices, {
    fields: [orderLines.productPriceId],
    references: [productPrices.id],
  }),
  commissionRule: one(commissionRules, {
    fields: [orderLines.commissionRuleId],
    references: [commissionRules.id],
  }),
}))
export const quoteEventsRelations = relations(quoteEvents, ({ one }) => ({
  quote: one(quotes, { fields: [quoteEvents.quoteId], references: [quotes.id] }),
}))
export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
}))
export const attachmentsRelations = relations(attachments, ({ one }) => ({
  order: one(orders, { fields: [attachments.orderId], references: [orders.id] }),
}))
export const recordAssignmentsRelations = relations(recordAssignments, ({ one }) => ({
  assignee: one(users, { fields: [recordAssignments.assigneeUserId], references: [users.id] }),
  customer: one(customers, { fields: [recordAssignments.customerId], references: [customers.id] }),
  quote: one(quotes, { fields: [recordAssignments.quoteId], references: [quotes.id] }),
  order: one(orders, { fields: [recordAssignments.orderId], references: [orders.id] }),
}))

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type Industry = typeof industries.$inferSelect
export type NewIndustry = typeof industries.$inferInsert
export type Carrier = typeof carriers.$inferSelect
export type NewCarrier = typeof carriers.$inferInsert
export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert
export type ProductAsset = typeof productAssets.$inferSelect
export type NewProductAsset = typeof productAssets.$inferInsert
export type PriceList = typeof priceLists.$inferSelect
export type ProductPrice = typeof productPrices.$inferSelect
export type CommissionRule = typeof commissionRules.$inferSelect
export type Quote = typeof quotes.$inferSelect
export type NewQuote = typeof quotes.$inferInsert
export type QuoteLine = typeof quoteLines.$inferSelect
export type NewQuoteLine = typeof quoteLines.$inferInsert
export type Order = typeof orders.$inferSelect
export type NewOrder = typeof orders.$inferInsert
export type OrderLine = typeof orderLines.$inferSelect
export type Attachment = typeof attachments.$inferSelect
export type Setting = typeof settings.$inferSelect
export type AuditEvent = typeof auditEvents.$inferSelect
