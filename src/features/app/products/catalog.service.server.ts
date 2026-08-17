import Decimal from 'decimal.js'
import { sql, type SQL } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { z } from 'zod'
import type * as databaseSchema from '@/lib/db/schema'
import { catalogAudit } from '@/lib/db/schema'
import {
  requireCatalogActor,
  type CatalogActor,
} from '@/lib/catalog/authorization.server'
import {
  conflict,
  failure,
  notFound,
  success,
  unexpected,
  validationFailure,
  type Result,
} from '@/lib/domain/result'
import { serializeDate, serializeDecimal } from '@/lib/server/serialization'

const codePattern = /[A-Za-z0-9]/
const decimalPattern = /^\d{1,12}(?:\.\d{1,6})?$/
const percentagePattern = /^\d{1,3}(?:\.\d{1,6})?$/

const requiredText = z.string().trim().min(1).max(500)
const optionalText = z.string().trim().min(1).max(500).nullable()
const code = z.string().trim().min(1).max(100).refine((value) => codePattern.test(value), 'Code must contain a letter or number')
const optionalCode = code.nullable()
const decimal = z.string().trim().regex(decimalPattern, 'Invalid Decimal value').refine((value) => new Decimal(value).gte(0), 'Must be non-negative')
const percentage = z.string().trim().regex(percentagePattern, 'Invalid percentage').refine((value) => new Decimal(value).lte(100), 'Must be between 0 and 100')

const productFieldsShape = {
  industryId: z.uuid(),
  internalCode: code,
  manufacturerCode: optionalCode,
  description: requiredText,
  brand: optionalText,
  category: optionalText,
  ncm: optionalCode,
  cest: optionalCode,
  ean: optionalCode,
  dun: optionalCode,
  packaging: optionalText,
  unit: requiredText.max(30),
  netWeight: decimal.nullable(),
  grossWeight: decimal.nullable(),
  width: decimal.nullable(),
  height: decimal.nullable(),
  depth: decimal.nullable(),
  dimensionUnit: optionalText,
  ipiRate: percentage.nullable(),
  icmsRate: percentage.nullable(),
  pisRate: percentage.nullable(),
  cofinsRate: percentage.nullable(),
  commissionOverride: percentage.nullable(),
} as const

export const productFieldsSchema = z.strictObject(productFieldsShape).superRefine((value, context) => {
  if ((value.width !== null || value.height !== null || value.depth !== null) && value.dimensionUnit === null) {
    context.addIssue({ code: 'custom', path: ['dimensionUnit'], message: 'Dimension unit is required when dimensions are provided' })
  }
})

const createSchema = z.strictObject({ product: productFieldsSchema })
const updateFieldsSchema = z.strictObject(productFieldsShape).partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required')
const updateSchema = z.strictObject({ id: z.uuid(), product: updateFieldsSchema })
const archiveSchema = z.strictObject({ id: z.uuid(), archived: z.boolean() })
const detailSchema = z.strictObject({ id: z.uuid() })
const listSchema = z.strictObject({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  filters: z.strictObject({
    identifier: z.string().trim().max(100).optional(),
    text: z.string().trim().max(500).optional(),
    industryId: z.uuid().optional(),
    brand: z.string().trim().min(1).max(500).optional(),
    category: z.string().trim().min(1).max(500).optional(),
    ncm: z.string().trim().max(100).optional(),
    cest: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'archived', 'all']).default('active'),
  }).default({ status: 'active' }),
  sortBy: z.enum(['description', 'internalCode', 'brand', 'category', 'createdAt']).default('description'),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
})

export type ProductFields = z.output<typeof productFieldsSchema>
export type ProductCreateRequest = z.input<typeof createSchema>
export type ProductUpdateRequest = z.input<typeof updateSchema>
export type ProductArchiveRequest = z.input<typeof archiveSchema>
export type ProductListRequest = z.input<typeof listSchema>
export type PriceListKey = 'PRICE_1' | 'PRICE_2' | 'PRICE_3' | 'PRICE_4'

export type ProductPriceDto = Readonly<{
  id: string | null
  priceListId: string
  key: PriceListKey
  displayName: string
  amount: string | null
  currencyCode: string
}>

export type ProductDto = Readonly<{
  id: string
  industryId: string
  industry: string
  internalCode: string
  internalCodeNormalized: string
  manufacturerCode: string | null
  manufacturerCodeNormalized: string | null
  description: string
  brand: string | null
  category: string | null
  ncm: string | null
  ncmNormalized: string | null
  cest: string | null
  cestNormalized: string | null
  ean: string | null
  eanNormalized: string | null
  dun: string | null
  dunNormalized: string | null
  packaging: string | null
  unit: string
  netWeight: string | null
  grossWeight: string | null
  width: string | null
  height: string | null
  depth: string | null
  dimensionUnit: string | null
  ipiRate: string | null
  icmsRate: string | null
  pisRate: string | null
  cofinsRate: string | null
  commissionOverride: string | null
  effectiveCommission: Readonly<{ rate: string; source: 'product' | 'fallback' }>
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  archivedAt: string | null
  archivedBy: string | null
  isActive: boolean
  prices: readonly ProductPriceDto[]
}>

export type ProductFacet = Readonly<{ value: string; count: number }>
export type ProductFacets = Readonly<{
  brands: readonly ProductFacet[]
  industries: readonly ProductFacet[]
  categories: readonly ProductFacet[]
  ncm: readonly ProductFacet[]
  cest: readonly ProductFacet[]
}>

export type ProductListDto = Readonly<{
  items: readonly ProductDto[]
  facets: ProductFacets
  pageInfo: Readonly<{ nextCursor: string | null; hasNextPage: boolean }>
}>

type Database = PostgresJsDatabase<typeof databaseSchema>
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type Executor = Database | Transaction
type DbProductRow = Omit<ProductDto, 'prices' | 'effectiveCommission' | 'createdAt' | 'updatedAt' | 'archivedAt'> & {
  createdAt: Date | string
  updatedAt: Date | string
  archivedAt: Date | string | null
}
type DbPriceRow = {
  id: string | null
  productId: string
  priceListId: string
  key: string
  displayName: string
  amount: string | null
  currencyCode: string | null
}

type ServiceOptions = Readonly<{
  fallbackCommission: string
  authenticate: () => Promise<CatalogActor | null>
}>

function parse<T>(schema: z.ZodType<T>, input: unknown): Result<T> {
  const parsed = schema.safeParse(input)
  if (parsed.success) return success(parsed.data)
  return failure(validationFailure(parsed.error.issues.map((issue) => ({
    path: issue.path.map((part) => typeof part === 'symbol' ? (part.description ?? 'symbol') : part),
    message: issue.message,
  }))))
}

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url')
}

function decodeOffset(cursor: string | undefined): Result<number> {
  if (!cursor) return success(0)
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (typeof value === 'object' && value !== null && 'offset' in value && Number.isInteger(value.offset) && Number(value.offset) >= 0) {
      return success(Number(value.offset))
    }
  } catch {
    // Collapse malformed cursor details into a safe validation error.
  }
  return failure(validationFailure([{ path: ['cursor'], message: 'Invalid cursor.' }]))
}

function nullableDecimal(value: string | null): string | null {
  return value === null ? null : serializeDecimal(value)
}

function serializeDatabaseDate(value: Date | string): string {
  return serializeDate(value instanceof Date ? value : new Date(value))
}

function serializeNullableDatabaseDate(value: Date | string | null): string | null {
  return value === null ? null : serializeDatabaseDate(value)
}

function mapProduct(row: DbProductRow, prices: readonly DbPriceRow[], fallbackCommission: string): ProductDto {
  const commissionOverride = nullableDecimal(row.commissionOverride)
  return {
    ...row,
    netWeight: nullableDecimal(row.netWeight),
    grossWeight: nullableDecimal(row.grossWeight),
    width: nullableDecimal(row.width),
    height: nullableDecimal(row.height),
    depth: nullableDecimal(row.depth),
    ipiRate: nullableDecimal(row.ipiRate),
    icmsRate: nullableDecimal(row.icmsRate),
    pisRate: nullableDecimal(row.pisRate),
    cofinsRate: nullableDecimal(row.cofinsRate),
    commissionOverride,
    effectiveCommission: commissionOverride === null
      ? { rate: fallbackCommission, source: 'fallback' }
      : { rate: commissionOverride, source: 'product' },
    createdAt: serializeDatabaseDate(row.createdAt),
    updatedAt: serializeDatabaseDate(row.updatedAt),
    archivedAt: serializeNullableDatabaseDate(row.archivedAt),
    prices: prices.map((price) => ({
      id: price.id,
      priceListId: price.priceListId,
      key: price.key as PriceListKey,
      displayName: price.displayName,
      amount: nullableDecimal(price.amount),
      currencyCode: price.currencyCode ?? 'BRL',
    })),
  }
}

function productDtoFields(product: ProductDto): ProductFields {
  return {
    industryId: product.industryId,
    internalCode: product.internalCode,
    manufacturerCode: product.manufacturerCode,
    description: product.description,
    brand: product.brand,
    category: product.category,
    ncm: product.ncm,
    cest: product.cest,
    ean: product.ean,
    dun: product.dun,
    packaging: product.packaging,
    unit: product.unit,
    netWeight: product.netWeight,
    grossWeight: product.grossWeight,
    width: product.width,
    height: product.height,
    depth: product.depth,
    dimensionUnit: product.dimensionUnit,
    ipiRate: product.ipiRate,
    icmsRate: product.icmsRate,
    pisRate: product.pisRate,
    cofinsRate: product.cofinsRate,
    commissionOverride: product.commissionOverride,
  }
}

function productSelect(where: SQL): SQL {
  return sql`SELECT
    p.id, p.industry_id AS "industryId", i.legal_name AS industry,
    p.internal_code AS "internalCode", p.internal_code_normalized AS "internalCodeNormalized",
    p.manufacturer_code AS "manufacturerCode", p.manufacturer_code_normalized AS "manufacturerCodeNormalized",
    p.description, p.brand, p.category, p.ncm, p.ncm_normalized AS "ncmNormalized",
    p.cest, p.cest_normalized AS "cestNormalized", p.ean, p.ean_normalized AS "eanNormalized",
    p.dun, p.dun_normalized AS "dunNormalized", p.packaging, p.unit,
    p.net_weight AS "netWeight", p.gross_weight AS "grossWeight", p.width, p.height, p.depth,
    p.dimension_unit AS "dimensionUnit", p.ipi_rate AS "ipiRate", p.icms_rate AS "icmsRate",
    p.pis_rate AS "pisRate", p.cofins_rate AS "cofinsRate", p.commission_override AS "commissionOverride",
    p.created_at AS "createdAt", p.created_by AS "createdBy", p.updated_at AS "updatedAt",
    p.updated_by AS "updatedBy", p.archived_at AS "archivedAt", p.archived_by AS "archivedBy",
    p.is_active AS "isActive"
  FROM products p JOIN industries i ON i.id = p.industry_id WHERE ${where}`
}

async function executeRows<T>(executor: Executor, query: SQL): Promise<T[]> {
  return await executor.execute(query) as unknown as T[]
}

function safeAuditState(product: ProductDto): Record<string, unknown> {
  return { ...productDtoFields(product), isActive: product.isActive }
}

function databaseError(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'cause' in error && typeof error.cause === 'object' && error.cause !== null && 'code' in error.cause
    ? error.cause.code
    : typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  return code === '23505' ? conflict() : unexpected(error)
}

export function createProductCatalogService(database: Database, options: ServiceOptions) {
  const fallback = percentage.safeParse(options.fallbackCommission)
  if (!fallback.success) throw new TypeError('fallbackCommission must be an exact Decimal percentage between 0 and 100')
  const fallbackCommission = fallback.data

  async function readMany(ids: readonly string[], executor: Executor = database): Promise<ProductDto[]> {
    if (ids.length === 0) return []
    const productRows = await executeRows<DbProductRow>(executor, sql`${productSelect(sql`p.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)}`)
    const priceRows = await executeRows<DbPriceRow>(executor, sql`
      SELECT pp.id, p.id AS "productId", pl.id AS "priceListId", pl.key,
        pl.display_name AS "displayName", pp.amount, pp.currency_code AS "currencyCode"
      FROM products p CROSS JOIN price_lists pl
      LEFT JOIN product_prices pp ON pp.product_id = p.id AND pp.price_list_id = pl.id
      WHERE p.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      ORDER BY p.id, pl.position
    `)
    const order = new Map(ids.map((id, index) => [id, index]))
    return productRows
      .map((row) => mapProduct(row, priceRows.filter((price) => price.productId === row.id), fallbackCommission))
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
  }

  async function readOne(id: string, executor: Executor = database): Promise<Result<ProductDto>> {
    const product = (await readMany([id], executor))[0]
    return product ? success(product) : failure(notFound())
  }

  async function detail(input: unknown): Promise<Result<ProductDto>> {
    await requireCatalogActor(options.authenticate, 'product.read')
    const request = parse(detailSchema, input)
    if (!request.ok) return request
    try {
      return await readOne(request.data.id)
    } catch (error) {
      return failure(databaseError(error))
    }
  }

  async function create(input: unknown): Promise<Result<ProductDto>> {
    const actor = await requireCatalogActor(options.authenticate, 'product.create')
    const request = parse(createSchema, input)
    if (!request.ok) return request
    const product = request.data.product
    try {
      return await database.transaction(async (tx) => {
        const inserted = await executeRows<{ id: string }>(tx, sql`
          INSERT INTO products (
            industry_id, internal_code, manufacturer_code, description, brand, category, ncm, cest, ean, dun,
            packaging, unit, net_weight, gross_weight, width, height, depth, dimension_unit,
            ipi_rate, icms_rate, pis_rate, cofins_rate, commission_override, created_by, updated_by
          ) VALUES (
            ${product.industryId}, ${product.internalCode}, ${product.manufacturerCode}, ${product.description},
            ${product.brand}, ${product.category}, ${product.ncm}, ${product.cest}, ${product.ean}, ${product.dun},
            ${product.packaging}, ${product.unit}, ${product.netWeight}, ${product.grossWeight}, ${product.width},
            ${product.height}, ${product.depth}, ${product.dimensionUnit}, ${product.ipiRate}, ${product.icmsRate},
            ${product.pisRate}, ${product.cofinsRate}, ${product.commissionOverride}, ${actor.id}, ${actor.id}
          ) RETURNING id
        `)
        const created = await readOne(inserted[0]!.id, tx)
        if (!created.ok) return created
        await tx.insert(catalogAudit).values({ actorId: actor.id, operation: 'product.create',
          targetType: 'product', targetId: created.data.id, beforeState: null,
          afterState: safeAuditState(created.data) })
        return created
      })
    } catch (error) {
      return failure(databaseError(error))
    }
  }

  async function update(input: unknown): Promise<Result<ProductDto>> {
    const actor = await requireCatalogActor(options.authenticate, 'product.update')
    const request = parse(updateSchema, input)
    if (!request.ok) return request
    const entries = Object.entries(request.data.product) as Array<[keyof ProductFields, ProductFields[keyof ProductFields]]>
    const columns: Record<keyof ProductFields, string> = {
      industryId: 'industry_id', internalCode: 'internal_code', manufacturerCode: 'manufacturer_code',
      description: 'description', brand: 'brand', category: 'category', ncm: 'ncm', cest: 'cest', ean: 'ean', dun: 'dun',
      packaging: 'packaging', unit: 'unit', netWeight: 'net_weight', grossWeight: 'gross_weight', width: 'width',
      height: 'height', depth: 'depth', dimensionUnit: 'dimension_unit', ipiRate: 'ipi_rate', icmsRate: 'icms_rate',
      pisRate: 'pis_rate', cofinsRate: 'cofins_rate', commissionOverride: 'commission_override',
    }
    try {
      return await database.transaction(async (tx) => {
        const locked = await executeRows<{ id: string }>(tx, sql`
          SELECT id FROM products WHERE id = ${request.data.id} FOR UPDATE
        `)
        if (!locked[0]) return failure(notFound())
        const existing = await readOne(request.data.id, tx)
        if (!existing.ok) return existing
        const merged = parse(productFieldsSchema, {
          ...productDtoFields(existing.data),
          ...request.data.product,
        })
        if (!merged.ok) return merged
        const assignments = entries.map(([field, value]) => sql`${sql.identifier(columns[field])} = ${value}`)
        const rows = await executeRows<{ id: string }>(tx, sql`
          UPDATE products SET ${sql.join(assignments, sql`, `)}, updated_at = clock_timestamp(), updated_by = ${actor.id}
          WHERE id = ${request.data.id} RETURNING id
        `)
        if (!rows[0]) return failure(notFound())
        const updated = await readOne(rows[0].id, tx)
        if (!updated.ok) return updated
        await tx.insert(catalogAudit).values({ actorId: actor.id, operation: 'product.update',
          targetType: 'product', targetId: updated.data.id,
          beforeState: safeAuditState(existing.data), afterState: safeAuditState(updated.data) })
        return updated
      })
    } catch (error) {
      return failure(databaseError(error))
    }
  }

  async function archive(input: unknown): Promise<Result<ProductDto>> {
    const actor = await requireCatalogActor(options.authenticate, 'product.archive')
    const request = parse(archiveSchema, input)
    if (!request.ok) return request
    try {
      return await database.transaction(async (tx) => {
        const existing = await readOne(request.data.id, tx)
        if (!existing.ok) return existing
        const rows = await executeRows<{ id: string }>(tx, request.data.archived
          ? sql`UPDATE products SET archived_at = clock_timestamp(), archived_by = ${actor.id}, updated_at = clock_timestamp(), updated_by = ${actor.id} WHERE id = ${request.data.id} RETURNING id`
          : sql`UPDATE products SET archived_at = NULL, archived_by = NULL, updated_at = clock_timestamp(), updated_by = ${actor.id} WHERE id = ${request.data.id} RETURNING id`)
        if (!rows[0]) return failure(notFound())
        const archived = await readOne(rows[0].id, tx)
        if (!archived.ok) return archived
        await tx.insert(catalogAudit).values({ actorId: actor.id, operation: 'product.archive',
          targetType: 'product', targetId: archived.data.id,
          beforeState: safeAuditState(existing.data), afterState: safeAuditState(archived.data) })
        return archived
      })
    } catch (error) {
      return failure(databaseError(error))
    }
  }

  async function list(input: unknown): Promise<Result<ProductListDto>> {
    await requireCatalogActor(options.authenticate, 'product.search')
    const request = parse(listSchema, input)
    if (!request.ok) return request
    const offset = decodeOffset(request.data.cursor)
    if (!offset.ok) return offset
    const filters = request.data.filters
    const predicates: SQL[] = []
    if (filters.status === 'active') predicates.push(sql`p.archived_at IS NULL`)
    if (filters.status === 'archived') predicates.push(sql`p.archived_at IS NOT NULL`)
    if (filters.industryId) predicates.push(sql`p.industry_id = ${filters.industryId}`)
    if (filters.brand) predicates.push(sql`p.brand = ${filters.brand}`)
    if (filters.category) predicates.push(sql`p.category = ${filters.category}`)
    if (filters.ncm) predicates.push(sql`p.ncm_normalized = ${normalizeCode(filters.ncm)}`)
    if (filters.cest) predicates.push(sql`p.cest_normalized = ${normalizeCode(filters.cest)}`)
    if (filters.identifier) {
      const identifier = `%${normalizeCode(filters.identifier)}%`
      predicates.push(sql`(p.internal_code_normalized LIKE ${identifier} OR p.manufacturer_code_normalized LIKE ${identifier} OR p.ean_normalized LIKE ${identifier} OR p.dun_normalized LIKE ${identifier})`)
    }
    if (filters.text) predicates.push(sql`p.description ILIKE ${`%${filters.text}%`}`)
    const where = predicates.length === 0 ? sql`TRUE` : sql.join(predicates, sql` AND `)
    const sortColumns = {
      description: sql`lower(p.description)`, internalCode: sql`p.internal_code_normalized`, brand: sql`p.brand`,
      category: sql`p.category`, createdAt: sql`p.created_at`,
    }
    const direction = request.data.sortDirection === 'asc' ? sql`ASC` : sql`DESC`
    try {
      const idRows = await executeRows<{ id: string }>(database, sql`
        SELECT p.id FROM products p JOIN industries i ON i.id = p.industry_id
        WHERE ${where}
        ORDER BY ${sortColumns[request.data.sortBy]} ${direction} NULLS LAST, p.id ${direction}
        LIMIT ${request.data.limit + 1} OFFSET ${offset.data}
      `)
      const hasNextPage = idRows.length > request.data.limit
      const pageIds = idRows.slice(0, request.data.limit).map((row) => row.id)
      const items = await readMany(pageIds)
      const facetRows = await executeRows<{ brand: string | null; industry: string; category: string | null; ncm: string | null; cest: string | null }>(database, sql`
        SELECT p.brand, i.legal_name AS industry, p.category, p.ncm, p.cest
        FROM products p JOIN industries i ON i.id = p.industry_id WHERE ${where}
      `)
      const facets = (field: keyof (typeof facetRows)[number]): ProductFacet[] => {
        const counts = new Map<string, number>()
        for (const row of facetRows) {
          const value = row[field]
          if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1)
        }
        return [...counts].sort(([left], [right]) => left.localeCompare(right, 'pt-BR')).map(([value, count]) => ({ value, count }))
      }
      return success({
        items,
        facets: { brands: facets('brand'), industries: facets('industry'), categories: facets('category'), ncm: facets('ncm'), cest: facets('cest') },
        pageInfo: { hasNextPage, nextCursor: hasNextPage ? encodeOffset(offset.data + request.data.limit) : null },
      })
    } catch (error) {
      return failure(databaseError(error))
    }
  }

  return { create, update, archive, detail, list }
}
