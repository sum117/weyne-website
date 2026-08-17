import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const auditTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow()

export const industries = pgTable(
  'industries',
  {
    id: uuid().primaryKey().defaultRandom(),
    legalName: text('legal_name').notNull(),
    createdAt: auditTimestamp('created_at'),
    updatedAt: auditTimestamp('updated_at'),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    archivedBy: text('archived_by'),
    archivedByUserId: uuid('archived_by_user_id'),
    isActive: boolean('is_active').generatedAlwaysAs(sql`archived_at IS NULL`),
  },
  (table) => [
    index('industries_active_legal_name_idx')
      .on(sql`lower(${table.legalName})`, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    index('industries_created_idx').on(table.createdAt, table.id),
    index('industries_updated_idx').on(table.updatedAt, table.id),
    index('industries_archive_idx').on(table.archivedAt, table.id),
    check('industries_legal_name_ck', sql`btrim(${table.legalName}) <> ''`),
    check(
      'industries_archive_actor_ck',
      sql`(${table.archivedAt} IS NULL AND ${table.archivedBy} IS NULL)
        OR (${table.archivedAt} IS NOT NULL AND btrim(${table.archivedBy}) <> '')`,
    ),
  ],
)

export const industryProfiles = pgTable(
  'industry_profiles',
  {
    industryId: uuid('industry_id')
      .primaryKey()
      .references(() => industries.id, { onDelete: 'restrict' }),
    tradeName: text('trade_name').notNull(),
    cnpj: text().notNull(),
    street: text().notNull(),
    addressNumber: text('address_number').notNull(),
    addressComplement: text('address_complement'),
    district: text().notNull(),
    city: text().notNull(),
    state: char({ length: 2 }).notNull(),
    postalCode: char('postal_code', { length: 8 }).notNull(),
    countryCode: char('country_code', { length: 2 }).notNull().default('BR'),
    defaultCommissionPercentage: numeric('default_commission_percentage', {
      precision: 9,
      scale: 6,
    }).notNull(),
    notes: text(),
    createdByUserId: uuid('created_by_user_id').notNull(),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
  },
  (table) => [
    uniqueIndex('industries_cnpj_uidx').on(table.cnpj),
    index('industries_active_trade_name_idx').on(sql`lower(${table.tradeName})`, table.industryId),
    index('industries_cnpj_idx').on(table.cnpj, table.industryId),
    check('industries_trade_name_ck', sql`btrim(${table.tradeName}) <> ''`),
    check('industries_cnpj_ck', sql`${table.cnpj} ~ '^[A-Z0-9]{12}[0-9]{2}$'`),
    check(
      'industries_address_ck',
      sql`btrim(${table.street}) <> ''
        AND btrim(${table.addressNumber}) <> ''
        AND (${table.addressComplement} IS NULL OR btrim(${table.addressComplement}) <> '')
        AND btrim(${table.district}) <> ''
        AND btrim(${table.city}) <> ''
        AND ${table.state} ~ '^[A-Z]{2}$'
        AND ${table.postalCode} ~ '^[0-9]{8}$'
        AND ${table.countryCode} = 'BR'`,
    ),
    check(
      'industries_default_commission_ck',
      sql`${table.defaultCommissionPercentage} BETWEEN 0 AND 100`,
    ),
    check('industries_notes_ck', sql`${table.notes} IS NULL OR btrim(${table.notes}) <> ''`),
  ],
)

export const products = pgTable(
  'products',
  {
    id: uuid().primaryKey().defaultRandom(),
    industryId: uuid('industry_id')
      .notNull()
      .references(() => industries.id, { onDelete: 'restrict' }),
    internalCode: text('internal_code').notNull(),
    internalCodeNormalized: text('internal_code_normalized').generatedAlwaysAs(
      sql`regexp_replace(upper(internal_code), '[^A-Z0-9]', '', 'g')`,
    ),
    manufacturerCode: text('manufacturer_code'),
    manufacturerCodeNormalized: text(
      'manufacturer_code_normalized',
    ).generatedAlwaysAs(
      sql`CASE WHEN manufacturer_code IS NULL THEN NULL
        ELSE regexp_replace(upper(manufacturer_code), '[^A-Z0-9]', '', 'g') END`,
    ),
    description: text().notNull(),
    brand: text(),
    category: text(),
    ncm: text(),
    ncmNormalized: text('ncm_normalized').generatedAlwaysAs(
      sql`CASE WHEN ncm IS NULL THEN NULL ELSE regexp_replace(upper(ncm), '[^A-Z0-9]', '', 'g') END`,
    ),
    cest: text(),
    cestNormalized: text('cest_normalized').generatedAlwaysAs(
      sql`CASE WHEN cest IS NULL THEN NULL ELSE regexp_replace(upper(cest), '[^A-Z0-9]', '', 'g') END`,
    ),
    ean: text(),
    eanNormalized: text('ean_normalized').generatedAlwaysAs(
      sql`CASE WHEN ean IS NULL THEN NULL ELSE regexp_replace(upper(ean), '[^A-Z0-9]', '', 'g') END`,
    ),
    dun: text(),
    dunNormalized: text('dun_normalized').generatedAlwaysAs(
      sql`CASE WHEN dun IS NULL THEN NULL ELSE regexp_replace(upper(dun), '[^A-Z0-9]', '', 'g') END`,
    ),
    packaging: text(),
    unit: text().notNull(),
    netWeight: numeric('net_weight', { precision: 18, scale: 6 }),
    grossWeight: numeric('gross_weight', { precision: 18, scale: 6 }),
    width: numeric({ precision: 18, scale: 6 }),
    height: numeric({ precision: 18, scale: 6 }),
    depth: numeric({ precision: 18, scale: 6 }),
    dimensionUnit: text('dimension_unit'),
    ipiRate: numeric('ipi_rate', { precision: 9, scale: 6 }),
    icmsRate: numeric('icms_rate', { precision: 9, scale: 6 }),
    pisRate: numeric('pis_rate', { precision: 9, scale: 6 }),
    cofinsRate: numeric('cofins_rate', { precision: 9, scale: 6 }),
    commissionOverride: numeric('commission_override', { precision: 9, scale: 6 }),
    createdAt: auditTimestamp('created_at'),
    createdBy: text('created_by').notNull(),
    updatedAt: auditTimestamp('updated_at'),
    updatedBy: text('updated_by').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    archivedBy: text('archived_by'),
    isActive: boolean('is_active').generatedAlwaysAs(sql`archived_at IS NULL`),
  },
  (table) => [
    uniqueIndex('products_internal_code_normalized_uidx').on(
      table.internalCodeNormalized,
    ),
    index('products_active_list_idx')
      .on(sql`lower(${table.description})`, table.internalCodeNormalized, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    index('products_active_brand_idx')
      .on(table.brand, table.id)
      .where(sql`${table.archivedAt} IS NULL AND ${table.brand} IS NOT NULL`),
    index('products_active_industry_idx')
      .on(table.industryId, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    index('products_active_category_idx')
      .on(table.category, table.id)
      .where(sql`${table.archivedAt} IS NULL AND ${table.category} IS NOT NULL`),
    index('products_manufacturer_code_normalized_idx')
      .on(table.manufacturerCodeNormalized)
      .where(sql`${table.manufacturerCodeNormalized} IS NOT NULL`),
    index('products_ncm_normalized_idx')
      .on(table.ncmNormalized)
      .where(sql`${table.ncmNormalized} IS NOT NULL`),
    index('products_cest_normalized_idx')
      .on(table.cestNormalized)
      .where(sql`${table.cestNormalized} IS NOT NULL`),
    check('products_internal_code_ck', sql`btrim(${table.internalCode}) <> ''`),
    check('products_description_ck', sql`btrim(${table.description}) <> ''`),
    check('products_unit_ck', sql`btrim(${table.unit}) <> ''`),
    check(
      'products_weights_ck',
      sql`(${table.netWeight} IS NULL OR ${table.netWeight} >= 0)
        AND (${table.grossWeight} IS NULL OR ${table.grossWeight} >= 0)`,
    ),
    check(
      'products_dimensions_ck',
      sql`(${table.width} IS NULL OR ${table.width} >= 0)
        AND (${table.height} IS NULL OR ${table.height} >= 0)
        AND (${table.depth} IS NULL OR ${table.depth} >= 0)
        AND ((${table.width} IS NULL AND ${table.height} IS NULL AND ${table.depth} IS NULL)
          OR (${table.dimensionUnit} IS NOT NULL AND btrim(${table.dimensionUnit}) <> ''))`,
    ),
    check(
      'products_percentages_ck',
      sql`(${table.ipiRate} IS NULL OR ${table.ipiRate} BETWEEN 0 AND 100)
        AND (${table.icmsRate} IS NULL OR ${table.icmsRate} BETWEEN 0 AND 100)
        AND (${table.pisRate} IS NULL OR ${table.pisRate} BETWEEN 0 AND 100)
        AND (${table.cofinsRate} IS NULL OR ${table.cofinsRate} BETWEEN 0 AND 100)
        AND (${table.commissionOverride} IS NULL OR ${table.commissionOverride} BETWEEN 0 AND 100)`,
    ),
  ],
)

export const priceLists = pgTable(
  'price_lists',
  {
    id: uuid().primaryKey().defaultRandom(),
    key: text().notNull().unique(),
    displayName: text('display_name').notNull(),
    position: smallint().notNull().unique(),
    createdAt: auditTimestamp('created_at'),
    updatedAt: auditTimestamp('updated_at'),
  },
  (table) => [
    check(
      'price_lists_canonical_key_position_ck',
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
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id, { onDelete: 'restrict' }),
    amount: numeric({ precision: 19, scale: 6 }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('BRL'),
    version: bigint({ mode: 'bigint' }).notNull().default(1n),
    updatedAt: auditTimestamp('updated_at'),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [
    unique('product_prices_product_list_uidx').on(table.productId, table.priceListId),
    index('product_prices_product_idx').on(table.productId, table.priceListId),
    index('product_prices_price_list_idx').on(table.priceListId, table.productId),
    check('product_prices_amount_ck', sql`${table.amount} >= 0`),
    check('product_prices_version_ck', sql`${table.version} > 0`),
  ],
)

export const productPriceHistory = pgTable(
  'product_price_history',
  {
    id: uuid().primaryKey().defaultRandom(),
    productPriceId: uuid('product_price_id')
      .notNull()
      .references(() => productPrices.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id, { onDelete: 'restrict' }),
    oldAmount: numeric('old_amount', { precision: 19, scale: 6 }),
    newAmount: numeric('new_amount', { precision: 19, scale: 6 }).notNull(),
    oldCurrencyCode: char('old_currency_code', { length: 3 }),
    newCurrencyCode: char('new_currency_code', { length: 3 }).notNull(),
    actor: text().notNull(),
    reason: text().notNull(),
    changedAt: auditTimestamp('changed_at'),
    version: bigint({ mode: 'bigint' }).notNull(),
  },
  (table) => [
    unique('product_price_history_version_uidx').on(
      table.productPriceId,
      table.version,
    ),
    index('product_price_history_lookup_idx').on(
      table.productId,
      table.priceListId,
      table.changedAt.desc(),
      table.id.desc(),
    ),
    index('product_price_history_actor_idx').on(table.actor, table.changedAt.desc()),
    check(
      'product_price_history_amounts_ck',
      sql`(${table.oldAmount} IS NULL OR ${table.oldAmount} >= 0) AND ${table.newAmount} >= 0`,
    ),
  ],
)

export const catalogAudit = pgTable(
  'catalog_audit',
  {
    id: uuid().primaryKey().defaultRandom(),
    actorId: text('actor_id').notNull(),
    operation: text().notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text(),
    beforeState: jsonb('before_state').$type<Record<string, unknown> | null>(),
    afterState: jsonb('after_state').$type<Record<string, unknown> | null>(),
    occurredAt: auditTimestamp('occurred_at'),
  },
  (table) => [
    index('catalog_audit_target_idx').on(
      table.targetType,
      table.targetId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index('catalog_audit_actor_idx').on(table.actorId, table.occurredAt.desc()),
    check('catalog_audit_actor_ck', sql`btrim(${table.actorId}) <> ''`),
    check(
      'catalog_audit_operation_ck',
      sql`${table.operation} IN ('industry.create', 'industry.update', 'industry.archive', 'product.create', 'product.update', 'product.archive', 'price.update')`,
    ),
    check('catalog_audit_target_type_ck', sql`${table.targetType} IN ('industry', 'product', 'product_price')`),
    check('catalog_audit_reason_ck', sql`${table.reason} IS NULL OR btrim(${table.reason}) <> ''`),
  ],
)

export const productAttachments = pgTable(
  'product_attachments',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    category: text().notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    displayLabel: text('display_label'),
    documentVersion: text('document_version'),
    effectiveDate: date('effective_date', { mode: 'string' }),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    uploadStatus: text('upload_status').notNull().default('PENDING'),
    photoPosition: integer('photo_position'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: auditTimestamp('created_at'),
    createdBy: text('created_by').notNull(),
    updatedAt: auditTimestamp('updated_at'),
    updatedBy: text('updated_by').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    deletedBy: text('deleted_by'),
  },
  (table) => [
    uniqueIndex('product_attachments_object_key_uidx').on(table.objectKey),
    uniqueIndex('product_attachments_photo_position_uidx')
      .on(table.productId, table.photoPosition)
      .where(sql`${table.category} = 'PHOTO' AND ${table.deletedAt} IS NULL`),
    uniqueIndex('product_attachments_primary_photo_uidx')
      .on(table.productId)
      .where(
        sql`${table.category} = 'PHOTO' AND ${table.isPrimary} AND ${table.deletedAt} IS NULL`,
      ),
    index('product_attachments_product_category_idx').on(
      table.productId,
      table.category,
      table.createdAt,
      table.id,
    ),
    index('product_attachments_status_idx').on(
      table.uploadStatus,
      table.updatedAt,
      table.id,
    ),
    check(
      'product_attachments_category_ck',
      sql`${table.category} IN ('PHOTO', 'TECHNICAL_SHEET', 'FISPQ')`,
    ),
    check(
      'product_attachments_upload_status_ck',
      sql`${table.uploadStatus} IN ('PENDING', 'UPLOADED', 'PROCESSING', 'AVAILABLE', 'FAILED', 'DELETING')`,
    ),
    check(
      'product_attachments_object_key_ck',
      sql`${table.objectKey} ~ '^attachments/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      'product_attachments_policy_ck',
      sql`(${table.category} = 'PHOTO'
          AND ${table.mimeType} IN ('image/jpeg', 'image/png', 'image/webp')
          AND ${table.sizeBytes} BETWEEN 1 AND 10485760)
        OR (${table.category} IN ('TECHNICAL_SHEET', 'FISPQ')
          AND ${table.mimeType} = 'application/pdf'
          AND ${table.sizeBytes} BETWEEN 1 AND 26214400)`,
    ),
    check(
      'product_attachments_checksum_ck',
      sql`${table.checksumSha256} ~ '^[A-Za-z0-9+/]{43}=$'`,
    ),
    check(
      'product_attachments_metadata_ck',
      sql`(${table.category} = 'PHOTO'
          AND ${table.displayLabel} IS NULL
          AND ${table.documentVersion} IS NULL
          AND ${table.effectiveDate} IS NULL
          AND ${table.photoPosition} IS NOT NULL
          AND ${table.photoPosition} >= 0)
        OR (${table.category} IN ('TECHNICAL_SHEET', 'FISPQ')
          AND ${table.displayLabel} IS NOT NULL
          AND btrim(${table.displayLabel}) <> ''
          AND ${table.photoPosition} IS NULL
          AND NOT ${table.isPrimary})`,
    ),
    check(
      'product_attachments_delete_actor_ck',
      sql`(${table.deletedAt} IS NULL AND ${table.deletedBy} IS NULL)
        OR (${table.deletedAt} IS NOT NULL AND btrim(${table.deletedBy}) <> '')`,
    ),
  ],
)

export const productPhotoVariants = pgTable(
  'product_photo_variants',
  {
    id: uuid().primaryKey().defaultRandom(),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => productAttachments.id, { onDelete: 'restrict' }),
    variantKey: text('variant_key').notNull(),
    objectKey: text('object_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    createdAt: auditTimestamp('created_at'),
  },
  (table) => [
    unique('product_photo_variants_attachment_key_uidx').on(
      table.attachmentId,
      table.variantKey,
    ),
    uniqueIndex('product_photo_variants_object_key_uidx').on(table.objectKey),
    index('product_photo_variants_attachment_idx').on(table.attachmentId, table.variantKey),
    check(
      'product_photo_variants_key_ck',
      sql`${table.variantKey} IN ('THUMBNAIL', 'DISPLAY')`,
    ),
    check('product_photo_variants_mime_ck', sql`${table.mimeType} = 'image/webp'`),
    check('product_photo_variants_size_ck', sql`${table.sizeBytes} > 0`),
    check(
      'product_photo_variants_dimensions_ck',
      sql`(${table.variantKey} = 'THUMBNAIL'
          AND ${table.width} BETWEEN 1 AND 320
          AND ${table.height} BETWEEN 1 AND 320)
        OR (${table.variantKey} = 'DISPLAY'
          AND ${table.width} BETWEEN 1 AND 1600
          AND ${table.height} BETWEEN 1 AND 1600)`,
    ),
  ],
)
