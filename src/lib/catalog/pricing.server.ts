import Decimal from 'decimal.js'
import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { z } from 'zod'
import { requireCatalogActor, type CatalogActor } from '@/lib/catalog/authorization.server'
import type * as schema from '@/lib/db/schema'
import { catalogAudit, priceLists, productPriceHistory, productPrices, products } from '@/lib/db/schema'
import { conflict, failure, notFound, success, unexpected, validationFailure, type Result } from '@/lib/domain/result'
import { createKeysetCursorCodec } from '@/lib/server/cursor.server'
import { serializeDate, serializeDecimal, type SerializedDate } from '@/lib/server/serialization'
import { cursorPaginationSchema, parseRequest } from '@/lib/server/request.schema'

export const CANONICAL_PRICE_LIST_KEYS = ['PRICE_1', 'PRICE_2', 'PRICE_3', 'PRICE_4'] as const
export type CanonicalPriceListKey = (typeof CANONICAL_PRICE_LIST_KEYS)[number]
export type ParsedPriceAmount = Readonly<{ ok: true; value: string }> | Readonly<{ ok: false; message: string }>
const PRICE_AMOUNT_MESSAGE = 'Price must be a non-negative decimal with at most 13 integer and 6 fractional digits.'
const PRICE_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/
const productRequestSchema = z.strictObject({ productId: z.uuid() })
const updateRequestSchema = z.strictObject({
  productId: z.uuid(), priceListId: z.uuid(), amount: z.string(),
  expectedVersion: z.string().regex(/^[1-9]\d*$/).nullable(),
  reason: z.string().trim().min(1).max(1000),
})
const historyRequestSchema = cursorPaginationSchema.extend({ productId: z.uuid(), priceListId: z.uuid() })
const historyCursor = createKeysetCursorCodec(z.strictObject({ changedAt: z.iso.datetime(), id: z.uuid() }))
type Database = PostgresJsDatabase<typeof schema>
type PriceListRow = typeof priceLists.$inferSelect
type PriceRow = typeof productPrices.$inferSelect
export type PriceListDto = Readonly<{ id: string; key: CanonicalPriceListKey; displayName: string; position: number }>
export type CurrentPriceDto = Readonly<{
  id: string | null; productId: string; priceList: PriceListDto; amount: string | null
  currencyCode: string | null; version: string | null; updatedAt: SerializedDate | null; updatedBy: string | null
}>
export type PriceHistoryItemDto = Readonly<{
  id: string; productPriceId: string; productId: string; priceListId: string
  oldAmount: string | null; newAmount: string; oldCurrencyCode: string | null; newCurrencyCode: string
  actor: string; reason: string; changedAt: SerializedDate; version: string
}>
export type PricingService = Readonly<{
  getCurrentPrices(input: unknown): Promise<Result<Readonly<{ productId: string; prices: readonly CurrentPriceDto[] }>>>
  updatePrice(input: unknown): Promise<Result<Readonly<{ status: 'created' | 'updated' | 'unchanged'; price: CurrentPriceDto }>>>
  getPriceHistory(input: unknown): Promise<Result<Readonly<{ items: readonly PriceHistoryItemDto[]; nextCursor: string | null }>>>
}>
type PricingServiceDependencies = Readonly<{
  database: Database
  authenticate: () => Promise<CatalogActor | null>
}>
export function parsePriceAmount(input: string): ParsedPriceAmount {
  const value = input.trim()
  if (!PRICE_AMOUNT_PATTERN.test(value)) return { ok: false, message: PRICE_AMOUNT_MESSAGE }
  const decimal = new Decimal(value)
  if (!decimal.isFinite() || decimal.isNegative()) return { ok: false, message: PRICE_AMOUNT_MESSAGE }
  return { ok: true, value: decimal.toFixed(6) }
}
function mapList(row: PriceListRow): PriceListDto {
  if (!(CANONICAL_PRICE_LIST_KEYS as readonly string[]).includes(row.key)) throw new Error(`Unsupported price-list key: ${row.key}`)
  return { id: row.id, key: row.key as CanonicalPriceListKey, displayName: row.displayName, position: row.position }
}
function mapPrice(row: PriceRow, list: PriceListRow): CurrentPriceDto {
  return { id: row.id, productId: row.productId, priceList: mapList(list), amount: serializeDecimal(row.amount),
    currencyCode: row.currencyCode, version: row.version.toString(), updatedAt: serializeDate(row.updatedAt), updatedBy: row.updatedBy }
}
function emptyPrice(productId: string, list: PriceListRow): CurrentPriceDto {
  return { id: null, productId, priceList: mapList(list), amount: null, currencyCode: null, version: null, updatedAt: null, updatedBy: null }
}
function postgresCode(error: unknown, codes: readonly string[]): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && codes.includes(error.code)
}

function safePriceState(price: CurrentPriceDto): Record<string, unknown> {
  return {
    productId: price.productId,
    priceListId: price.priceList.id,
    amount: price.amount,
    currencyCode: price.currencyCode,
    version: price.version,
  }
}

export function createPricingService({ database, authenticate }: PricingServiceDependencies): PricingService {
  return {
    async getCurrentPrices(input) {
      await requireCatalogActor(authenticate, 'price.read')
      const parsed = parseRequest(productRequestSchema, input)
      if (!parsed.ok) return parsed
      try {
        const product = await database.select({ id: products.id }).from(products).where(eq(products.id, parsed.data.productId)).limit(1)
        if (!product[0]) return failure(notFound())
        const rows = await database.select({ list: priceLists, price: productPrices }).from(priceLists)
          .leftJoin(productPrices, and(eq(productPrices.priceListId, priceLists.id), eq(productPrices.productId, parsed.data.productId)))
          .where(inArray(priceLists.key, CANONICAL_PRICE_LIST_KEYS)).orderBy(asc(priceLists.position))
        if (rows.length !== 4 || rows.some((row, index) => row.list.key !== CANONICAL_PRICE_LIST_KEYS[index])) {
          throw new Error('Canonical price-list catalog is incomplete or inconsistent')
        }
        return success({ productId: parsed.data.productId,
          prices: rows.map(({ list, price }) => price ? mapPrice(price, list) : emptyPrice(parsed.data.productId, list)) })
      } catch (cause) { return failure(unexpected(cause)) }
    },
    async updatePrice(input) {
      const actor = await requireCatalogActor(authenticate, 'price.update')
      const parsed = parseRequest(updateRequestSchema, input)
      if (!parsed.ok) return parsed
      const amount = parsePriceAmount(parsed.data.amount)
      if (!amount.ok) return failure(validationFailure([{ path: ['amount'], message: PRICE_AMOUNT_MESSAGE }]))
      try {
        return await database.transaction(async (tx) => {
          // Locking the product also serializes creation when no product-price row exists yet.
          const product = await tx.select({ id: products.id, isActive: products.isActive }).from(products)
            .where(eq(products.id, parsed.data.productId)).for('update').limit(1)
          if (!product[0]) return failure(notFound())
          if (!product[0].isActive) return failure(conflict())
          const list = await tx.select().from(priceLists).where(and(eq(priceLists.id, parsed.data.priceListId),
            inArray(priceLists.key, CANONICAL_PRICE_LIST_KEYS))).limit(1)
          if (!list[0]) return failure(notFound())
          const current = await tx.select().from(productPrices).where(and(eq(productPrices.productId, parsed.data.productId),
            eq(productPrices.priceListId, parsed.data.priceListId))).for('update').limit(1)
          if (current[0]) {
            if (parsed.data.expectedVersion !== current[0].version.toString()) return failure(conflict())
            if (serializeDecimal(current[0].amount) === amount.value) {
              return success({ status: 'unchanged' as const, price: mapPrice(current[0], list[0]) })
            }
          } else if (parsed.data.expectedVersion !== null) return failure(conflict())
          await tx.execute(sql`SELECT set_config('app.actor', ${actor.id}, true)`)
          await tx.execute(sql`SELECT set_config('app.price_change_reason', ${parsed.data.reason}, true)`)
          if (!current[0]) {
            const created = await tx.insert(productPrices).values({ productId: parsed.data.productId,
              priceListId: parsed.data.priceListId, amount: amount.value, updatedBy: actor.id }).returning()
            const price = mapPrice(created[0]!, list[0])
            await tx.insert(catalogAudit).values({ actorId: actor.id, operation: 'price.update',
              targetType: 'product_price', targetId: price.id!, reason: parsed.data.reason,
              beforeState: null, afterState: safePriceState(price) })
            return success({ status: 'created' as const, price })
          }
          const updated = await tx.update(productPrices).set({ amount: amount.value }).where(and(
            eq(productPrices.id, current[0].id), eq(productPrices.version, current[0].version))).returning()
          if (!updated[0]) return failure(conflict())
          const price = mapPrice(updated[0], list[0])
          await tx.insert(catalogAudit).values({ actorId: actor.id, operation: 'price.update',
            targetType: 'product_price', targetId: price.id!, reason: parsed.data.reason,
            beforeState: safePriceState(mapPrice(current[0], list[0])), afterState: safePriceState(price) })
          return success({ status: 'updated' as const, price })
        })
      } catch (cause) {
        if (postgresCode(cause, ['23505', '40001', '40P01'])) return failure(conflict())
        return failure(unexpected(cause))
      }
    },
    async getPriceHistory(input) {
      await requireCatalogActor(authenticate, 'price.history.read')
      const parsed = parseRequest(historyRequestSchema, input)
      if (!parsed.ok) return parsed
      let after: SQL | undefined
      if (parsed.data.cursor) {
        const cursor = historyCursor.decode(parsed.data.cursor)
        if (!cursor.ok) return cursor
        const changedAt = new Date(cursor.data.changedAt)
        after = or(lt(productPriceHistory.changedAt, changedAt),
          and(eq(productPriceHistory.changedAt, changedAt), lt(productPriceHistory.id, cursor.data.id)))
      }
      try {
        const [product, list] = await Promise.all([
          database.select({ id: products.id }).from(products).where(eq(products.id, parsed.data.productId)).limit(1),
          database.select({ id: priceLists.id }).from(priceLists).where(and(eq(priceLists.id, parsed.data.priceListId),
            inArray(priceLists.key, CANONICAL_PRICE_LIST_KEYS))).limit(1),
        ])
        if (!product[0] || !list[0]) return failure(notFound())
        const rows = await database.select().from(productPriceHistory).where(and(
          eq(productPriceHistory.productId, parsed.data.productId), eq(productPriceHistory.priceListId, parsed.data.priceListId), after,
        )).orderBy(desc(productPriceHistory.changedAt), desc(productPriceHistory.id)).limit(parsed.data.limit + 1)
        const hasNext = rows.length > parsed.data.limit
        const items = rows.slice(0, parsed.data.limit).map((row): PriceHistoryItemDto => ({ id: row.id,
          productPriceId: row.productPriceId, productId: row.productId, priceListId: row.priceListId,
          oldAmount: row.oldAmount === null ? null : serializeDecimal(row.oldAmount), newAmount: serializeDecimal(row.newAmount),
          oldCurrencyCode: row.oldCurrencyCode, newCurrencyCode: row.newCurrencyCode, actor: row.actor, reason: row.reason,
          changedAt: serializeDate(row.changedAt), version: row.version.toString() }))
        const last = hasNext ? items.at(-1) : undefined
        return success({ items, nextCursor: last ? historyCursor.encode({ changedAt: last.changedAt, id: last.id }) : null })
      } catch (cause) { return failure(unexpected(cause)) }
    },
  }
}
