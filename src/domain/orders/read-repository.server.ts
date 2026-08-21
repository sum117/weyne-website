import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '@/lib/db/schema'
import { orderLineTaxes, orderLines, orders } from '@/lib/db/schema'
import { z } from 'zod'
import { createKeysetCursorCodec } from '@/lib/server/cursor.server'
import type {
  OrderDetail,
  OrderListOutput,
  OrderListQuery,
} from './contracts'

const cursorValueSchema = z.object({
  sortBy: z.enum(['number', 'createdAt', 'grandTotalAmount']),
  sortDirection: z.enum(['asc', 'desc']),
  value: z.string(),
  id: z.string().uuid(),
})

const orderCursorCodec = createKeysetCursorCodec(cursorValueSchema)

type OrderCursor = z.output<typeof cursorValueSchema>

type Database = PostgresJsDatabase<typeof schema>
type OrderRow = typeof orders.$inferSelect
type OrderLineRow = typeof orderLines.$inferSelect
type OrderTaxRow = typeof orderLineTaxes.$inferSelect

/**
 * Read-side repository. Every query is constrained to an explicit
 * `visibleOrderIds` allowlist resolved by the security service beforehand, so
 * calling this repository directly cannot bypass authorization.
 */
export type OrderReadRepository = Readonly<{
  list: (
    query: OrderListQuery,
    visibleOrderIds: readonly string[],
  ) => Promise<OrderListOutput>
  findDetailById: (id: string) => Promise<OrderDetail | null>
}>

function decodeCursor(
  query: Pick<OrderListQuery, 'cursor' | 'sortBy' | 'sortDirection'>,
): OrderCursor | undefined {
  if (!query.cursor) return undefined
  const decoded = orderCursorCodec.decode(query.cursor)
  if (!decoded.ok) throw new RangeError('Invalid order cursor')
  if (
    decoded.data.sortBy !== query.sortBy ||
    decoded.data.sortDirection !== query.sortDirection
  ) {
    throw new RangeError('Order cursor does not match the requested ordering')
  }
  return decoded.data
}

function sortExpression(query: Pick<OrderListQuery, 'sortBy'>): SQL {
  switch (query.sortBy) {
    case 'createdAt':
      return sql`${orders.createdAt}`
    case 'grandTotalAmount':
      return sql`${orders.grandTotalAmount}`
    default:
      return sql`${orders.number}`
  }
}

function cursorPredicate(
  query: OrderListQuery,
  cursor: OrderCursor | undefined,
): SQL | undefined {
  if (!cursor) return undefined

  if (query.sortBy === 'createdAt') {
    const cursorDate = new Date(cursor.value)
    if (Number.isNaN(cursorDate.getTime())) {
      throw new RangeError('Invalid order date cursor')
    }
    const gt = query.sortDirection === 'asc'
    return sql`(${orders.createdAt} ${gt ? sql`>` : sql`<`} ${cursorDate}
      OR (${orders.createdAt} = ${cursorDate}
        AND ${orders.id} ${gt ? sql`>` : sql`<`} ${cursor.id}))`
  }

  const column =
    query.sortBy === 'grandTotalAmount' ? orders.grandTotalAmount : orders.number
  const gt = query.sortDirection === 'asc'
  return sql`(${column} ${gt ? sql`>` : sql`<`} ${cursor.value}
    OR (${column} = ${cursor.value} AND ${orders.id} ${gt ? sql`>` : sql`<`} ${cursor.id}))`
}

function cursorFor(
  row: OrderRow,
  query: Pick<OrderListQuery, 'sortBy' | 'sortDirection'>,
): OrderCursor {
  const value =
    query.sortBy === 'createdAt'
      ? row.createdAt.toISOString()
      : query.sortBy === 'grandTotalAmount'
        ? row.grandTotalAmount
        : row.number
  return {
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    value,
    id: row.id,
  }
}

interface JoinedLineRow {
  line: OrderLineRow
  tax: OrderTaxRow | null
}

function mapLines(joined: readonly JoinedLineRow[]): OrderDetail['lines'] {
  const byLineId = new Map<string, { line: OrderLineRow; taxes: OrderTaxRow[] }>()
  for (const { line, tax } of joined) {
    let entry = byLineId.get(line.id)
    if (!entry) {
      entry = { line, taxes: [] }
      byLineId.set(line.id, entry)
    }
    if (tax) entry.taxes.push(tax)
  }
  return [...byLineId.values()]
    .sort((left, right) => left.line.lineNumber - right.line.lineNumber)
    .map(({ line, taxes }) =>
      Object.freeze({
        sourceQuoteLineId: line.sourceQuoteLineId,
        lineNumber: line.lineNumber,
        product: Object.freeze({
          id: line.productId,
          industryId: line.productIndustryId,
          industryName: line.productIndustryName,
          internalCode: line.productInternalCode,
          manufacturerCode: line.productManufacturerCode,
          description: line.productDescription,
          brand: line.productBrand,
          category: line.productCategory,
          ncm: line.productNcm,
          cest: line.productCest,
          ean: line.productEan,
          dun: line.productDun,
          packaging: line.productPackaging,
          unit: line.productUnit,
        }),
        quantity: line.quantity,
        unitPrice: Object.freeze({
          priceListId: line.priceListId,
          productPriceVersionId: line.productPriceVersionId,
          source: line.unitPriceSource as 'price_list' | 'manual_override',
          amount: line.unitPriceAmount,
        }),
        grossAmount: line.grossAmount,
        perItemDiscountRate: line.perItemDiscountRate,
        perItemDiscountAmount: line.perItemDiscountAmount,
        netBeforeGeneralDiscountAmount: line.netBeforeGeneralDiscountAmount,
        allocatedGeneralDiscountAmount: line.allocatedGeneralDiscountAmount,
        netAfterDiscountsAmount: line.netAfterDiscountsAmount,
        ipiRate: line.ipiRate,
        ipiBasisAmount: line.ipiBasisAmount,
        ipiAmount: line.ipiAmount,
        configuredTaxAmount: line.configuredTaxAmount,
        freightAmount: line.freightAmount,
        lineTotalAmount: line.lineTotalAmount,
        commissionSource: line.commissionSource as
          | 'product_override'
          | 'industry_default'
          | 'none',
        commissionRate: line.commissionRate,
        commissionBasisAmount: line.commissionBasisAmount,
        commissionAmount: line.commissionAmount,
        configuredTaxes: taxes
          .slice()
          .sort((left, right) => left.code.localeCompare(right.code))
          .map((tax) =>
            Object.freeze({
              code: tax.code,
              rate: tax.rate,
              basisAmount: tax.basisAmount,
              amount: tax.amount,
            }),
          ),
      }),
    )
}

export function createPostgresOrderReadRepository(database: Database): OrderReadRepository {
  return Object.freeze({
    async list(
      query: OrderListQuery,
      visibleOrderIds: readonly string[],
    ): Promise<OrderListOutput> {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
        throw new RangeError('Order page size must be between 1 and 100')
      }
      if (visibleOrderIds.length === 0) {
        return Object.freeze({ items: [], nextCursor: null })
      }

      const filters: SQL[] = [inArray(orders.id, [...visibleOrderIds])]
      const { filters: queryFilters } = query
      if (queryFilters.number) filters.push(eq(orders.number, queryFilters.number))
      if (queryFilters.status) filters.push(eq(orders.status, queryFilters.status))
      if (queryFilters.clientId) {
        filters.push(eq(orders.clientId, queryFilters.clientId))
      }
      if (queryFilters.sourceQuoteId) {
        filters.push(eq(orders.sourceQuoteId, queryFilters.sourceQuoteId))
      }
      if (queryFilters.createdFrom) {
        filters.push(
          gte(orders.createdAt, new Date(`${queryFilters.createdFrom}T00:00:00.000Z`)),
        )
      }
      if (queryFilters.createdTo) {
        filters.push(
          lte(orders.createdAt, new Date(`${queryFilters.createdTo}T23:59:59.999Z`)),
        )
      }

      const decodedCursor = decodeCursor(query)
      const afterCursor = cursorPredicate(query, decodedCursor)
      if (afterCursor) filters.push(afterCursor)

      const order = query.sortDirection === 'asc' ? asc : desc
      const rows = await database
        .select()
        .from(orders)
        .where(and(...filters))
        .orderBy(order(sortExpression(query)), order(orders.id))
        .limit(query.limit + 1)

      const pageRows = rows.slice(0, query.limit)
      const items = pageRows.map((row) =>
        Object.freeze({
          id: row.id,
          number: row.number,
          status: row.status as OrderDetail['status'],
          clientId: row.clientId,
          clientLegalName: row.clientLegalName,
          grandTotalAmount: row.grandTotalAmount,
          createdAt: row.createdAt.toISOString(),
        }),
      )
      const lastRow = pageRows.at(-1)
      let nextCursor: string | null = null
      if (rows.length > query.limit && lastRow) {
        nextCursor = orderCursorCodec.encode(cursorFor(lastRow, query))
      }
      return Object.freeze({ items, nextCursor })
    },

    async findDetailById(id: string): Promise<OrderDetail | null> {
      const [order] = await database
        .select()
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1)
      if (!order) return null

      const joined = await database
        .select({ line: orderLines, tax: orderLineTaxes })
        .from(orderLines)
        .leftJoin(orderLineTaxes, eq(orderLineTaxes.orderLineId, orderLines.id))
        .where(eq(orderLines.orderId, id))

      return Object.freeze({
        id: order.id,
        number: order.number,
        status: order.status as OrderDetail['status'],
        version: Number(order.version),
        currencyCode: order.currencyCode,
        sourceQuoteId: order.sourceQuoteId,
        sourceQuoteRevision: order.sourceQuoteRevision,
        client: Object.freeze({
          id: order.clientId,
          legalName: order.clientLegalName,
          tradeName: order.clientTradeName,
          taxIdentifier: order.clientTaxIdentifier,
          stateRegistration: order.clientStateRegistration,
          email: order.clientEmail,
          phone: order.clientPhone,
          address: Object.freeze({
            street: order.clientAddressStreet,
            number: order.clientAddressNumber,
            complement: order.clientAddressComplement,
            district: order.clientAddressDistrict,
            city: order.clientAddressCity,
            state: order.clientAddressState,
            postalCode: order.clientAddressPostalCode,
            countryCode: order.clientAddressCountryCode,
          }),
        }),
        totals: Object.freeze({
          grossItemsAmount: order.grossItemsAmount,
          perItemDiscountAmount: order.perItemDiscountAmount,
          netItemsAmount: order.netItemsAmount,
          generalDiscountRate: order.generalDiscountRate,
          generalDiscountAmount: order.generalDiscountAmount,
          netAfterDiscountsAmount: order.netAfterDiscountsAmount,
          ipiAmount: order.ipiAmount,
          configuredTaxAmount: order.configuredTaxAmount,
          freightAmount: order.freightAmount,
          grandTotalAmount: order.grandTotalAmount,
          commissionBasisAmount: order.commissionBasisAmount,
          commissionAmount: order.commissionAmount,
        }),
        lines: mapLines(joined),
        audit: Object.freeze({
          createdAt: order.createdAt.toISOString(),
          createdBy: order.createdBy,
          creationReason: order.creationReason,
          updatedAt: order.updatedAt.toISOString(),
          updatedBy: order.updatedBy,
          statusChangedAt: order.statusChangedAt.toISOString(),
          statusChangedBy: order.statusChangedBy,
          statusChangeReason: order.statusChangeReason,
        }),
      })
    },
  })
}
