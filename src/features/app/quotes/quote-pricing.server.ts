import { and, eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { calculateQuote, Decimal, type QuoteCalculationResult } from '@/domain/quote-engine'
import type * as schema from '@/lib/db/schema'
import {
  customers,
  priceLists,
  productPrices,
  products,
  quotePricingSnapshotLines,
  quotePricingSnapshots,
} from '@/lib/db/schema'

export type PersistServerPricedQuoteRequest = Readonly<{
  customerId: string
  priceListId: string
  generalDiscountRate: string
  freightAmount: string
  lines: readonly Readonly<{
    lineId: string
    productId: string
    quantity: string
    lineDiscountRate: string
  }>[]
  /** Accepted only for compatibility with form payloads; intentionally never read. */
  clientTotals?: Readonly<Record<string, string>>
}>

type Database = PostgresJsDatabase<typeof schema>

type SerializedTotals = Readonly<{
  grossItemsAmount: string
  perItemDiscountAmount: string
  netItemsAmount: string
  generalDiscountAmount: string
  netAfterDiscountsAmount: string
  ipiAmount: string
  configuredTaxAmount: string
  freightAmount: string
  grandTotalAmount: string
  commissionBasisAmount: string
  commissionAmount: string
}>

export async function persistServerPricedQuote(
  database: Database,
  request: PersistServerPricedQuoteRequest,
): Promise<Readonly<{ id: string; totals: SerializedTotals }>> {
  const [customer, priceList] = await Promise.all([
    database.select({ id: customers.id }).from(customers).where(eq(customers.id, request.customerId)),
    database.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.id, request.priceListId)),
  ])
  if (!customer[0]) throw new Error('CUSTOMER_NOT_FOUND')
  if (!priceList[0]) throw new Error('PRICE_LIST_NOT_FOUND')
  if (request.lines.length === 0) throw new Error('QUOTE_LINES_REQUIRED')

  const productIds = request.lines.map((line) => line.productId)
  const catalogRows = await database
    .select({
      productId: products.id,
      productPriceId: productPrices.id,
      amount: productPrices.amount,
      ipiRate: products.ipiRate,
      icmsRate: products.icmsRate,
      pisRate: products.pisRate,
      cofinsRate: products.cofinsRate,
      commissionOverride: products.commissionOverride,
    })
    .from(products)
    .innerJoin(
      productPrices,
      and(
        eq(productPrices.productId, products.id),
        eq(productPrices.priceListId, request.priceListId),
      ),
    )
    .where(and(inArray(products.id, productIds), eq(products.isActive, true)))
  const catalogByProduct = new Map(catalogRows.map((row) => [row.productId, row]))

  const inputLines = request.lines.map((line) => {
    const catalog = catalogByProduct.get(line.productId)
    if (!catalog) throw new Error(`CURRENT_PRICE_NOT_FOUND:${line.productId}`)
    const configuredTaxes = [
      ['icms', catalog.icmsRate],
      ['pis', catalog.pisRate],
      ['cofins', catalog.cofinsRate],
    ] as const

    return {
      lineId: line.lineId,
      quantity: decimal(line.quantity, 'quantity'),
      unitPrice: {
        productId: line.productId,
        productPriceVersionId: catalog.productPriceId,
        priceListId: request.priceListId,
        source: 'price_list' as const,
        amount: decimal(catalog.amount, 'unitPrice'),
      },
      perItemDiscountRate: decimal(line.lineDiscountRate, 'lineDiscountRate'),
      ipiRate: decimal(catalog.ipiRate ?? '0', 'ipiRate'),
      configuredTaxes: configuredTaxes.flatMap(([code, rate]) =>
        rate === null ? [] : [{ code, rate: decimal(rate, `${code}Rate`) }],
      ),
      commission: {
        productOverrideRate:
          catalog.commissionOverride === null
            ? null
            : decimal(catalog.commissionOverride, 'commissionOverride'),
        industryDefaultRate: null,
      },
    }
  })

  const calculation = calculateQuote({
    lines: inputLines,
    generalDiscountRate: decimal(request.generalDiscountRate, 'generalDiscountRate'),
    freightAmount: decimal(request.freightAmount, 'freightAmount'),
  })
  const totals = serializeTotals(calculation)
  const requestByLineId = new Map(request.lines.map((line) => [line.lineId, line]))
  const catalogByLineId = new Map(inputLines.map((line) => [line.lineId, line]))

  const id = await database.transaction(async (transaction) => {
    const [header] = await transaction
      .insert(quotePricingSnapshots)
      .values({
        customerId: request.customerId,
        priceListId: request.priceListId,
        generalDiscountRate: fixedRate(request.generalDiscountRate),
        grossItemsAmount: totals.grossItemsAmount,
        lineDiscountAmount: totals.perItemDiscountAmount,
        netItemsAmount: totals.netItemsAmount,
        generalDiscountAmount: totals.generalDiscountAmount,
        netMerchandiseAmount: totals.netAfterDiscountsAmount,
        ipiAmount: totals.ipiAmount,
        configuredTaxAmount: totals.configuredTaxAmount,
        freightAmount: totals.freightAmount,
        grandTotalAmount: totals.grandTotalAmount,
      })
      .returning({ id: quotePricingSnapshots.id })

    await transaction.insert(quotePricingSnapshotLines).values(
      calculation.lines.map((line) => {
        const requested = requestByLineId.get(line.lineId)!
        const catalog = catalogByLineId.get(line.lineId)!
        return {
          quotePricingSnapshotId: header!.id,
          lineId: line.lineId,
          productId: requested.productId,
          productPriceId: catalog.unitPrice.productPriceVersionId,
          quantity: fixedSix(requested.quantity),
          unitPrice: fixedSix(catalog.unitPrice.amount.toString()),
          lineDiscountRate: fixedRate(requested.lineDiscountRate),
          grossAmount: money(line.grossAmount),
          lineDiscountAmount: money(line.perItemDiscountAmount),
          netAfterLineDiscountAmount: money(line.netBeforeGeneralDiscountAmount),
          generalDiscountAmount: money(line.allocatedGeneralDiscountAmount),
          netMerchandiseAmount: money(line.netAfterDiscountsAmount),
          ipiAmount: money(line.ipi.amount),
          configuredTaxes: line.configuredTaxes.map((tax) => ({
            code: tax.code,
            rate: tax.rate.toFixed(6),
            basisAmount: money(tax.basisAmount),
            amount: money(tax.amount),
          })),
          configuredTaxAmount: money(
            line.configuredTaxes.reduce((sum, tax) => sum.plus(tax.amount), new Decimal(0)),
          ),
        }
      }),
    )
    return header!.id
  })

  return { id, totals }
}

function decimal(value: string, field: string): Decimal {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error(`INVALID_DECIMAL:${field}`)
  }
  return new Decimal(value)
}

function money(value: Decimal): string {
  return value.toFixed(2)
}

function fixedSix(value: string): string {
  return decimal(value, 'fixedSix').toFixed(6)
}

function fixedRate(value: string): string {
  return decimal(value, 'rate').toFixed(6)
}

function serializeTotals(result: QuoteCalculationResult): SerializedTotals {
  return {
    grossItemsAmount: money(result.totals.grossItemsAmount),
    perItemDiscountAmount: money(result.totals.perItemDiscountAmount),
    netItemsAmount: money(result.totals.netItemsAmount),
    generalDiscountAmount: money(result.totals.generalDiscountAmount),
    netAfterDiscountsAmount: money(result.totals.netAfterDiscountsAmount),
    ipiAmount: money(result.totals.ipiAmount),
    configuredTaxAmount: money(result.totals.configuredTaxAmount),
    freightAmount: money(result.totals.freightAmount),
    grandTotalAmount: money(result.totals.grandTotalAmount),
    commissionBasisAmount: money(result.totals.commissionBasisAmount),
    commissionAmount: money(result.totals.commissionAmount),
  }
}
