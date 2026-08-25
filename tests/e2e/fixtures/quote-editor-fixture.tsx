import React, { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import { QuoteCatalogPicker } from '@/features/app/quotes/quote-catalog-picker'
import { QuoteLineItemEditor } from '@/features/app/quotes/quote-line-item-editor'
import {
  QuoteDataError,
  type CatalogProduct,
  type CatalogSearchResponse,
  type CurrentQuoteLineSource,
  type NewQuoteLineSnapshot,
  type QuoteDataService,
  type QuotePricingResponse,
  type QuotePricingModel,
  type QuoteRecalculationInput,
  type QuoteRecalculationResult,
  type QuoteLineWithCurrentSource,
  type SavedQuoteLineSnapshot,
} from '@/features/app/quotes/quote-data'
import '@/styles/app.css'

/**
 * Deterministic, dependency-free QuoteDataService backing the quote editor
 * E2E suite. All Decimal values are base-10 strings; recalculation mirrors
 * the server engine's published rounding points (money at 2dp,
 * ROUND_HALF_UP, tax display-only) without importing server code.
 */

const PRICE_LISTS = [
  { id: 'list-standard', key: 'PRICE_1' as const, displayName: 'Tabela Padrão' },
  { id: 'list-varejo', key: 'PRICE_2' as const, displayName: 'Tabela Varejo' },
]

interface FixtureProduct {
  readonly product: CatalogProduct
  readonly priceByList: Readonly<Record<string, string>>
}

const PRODUCTS: readonly FixtureProduct[] = [
  {
    product: {
      id: 'prod-detergente',
      internalCode: 'DET-001',
      manufacturerCode: null,
      description: 'Detergente concentrado 5 L',
      unit: 'CX',
      industryId: 'ind-totalclean',
      industryName: 'Total Clean',
      brand: 'Limpol',
      category: 'Saneantes',
      thumbnailUrl: null,
      archived: false,
      selectedPrice: null,
    },
    priceByList: { 'list-standard': '42.0050', 'list-varejo': '46.5000' },
  },
  {
    product: {
      id: 'prod-papel',
      internalCode: 'PAP-204',
      manufacturerCode: null,
      description: 'Papel toalha interfolhado',
      unit: 'PCT',
      industryId: 'ind-century',
      industryName: 'Century',
      brand: 'Softis',
      category: 'Papéis',
      thumbnailUrl: null,
      archived: false,
      selectedPrice: null,
    },
    priceByList: { 'list-standard': '68.0000', 'list-varejo': '71.2500' },
  },
  {
    product: {
      id: 'prod-alcool',
      internalCode: 'ALC-070',
      manufacturerCode: null,
      description: 'Álcool antisséptico 70%',
      unit: 'UN',
      industryId: 'ind-bello',
      industryName: 'Bello Bella',
      brand: null,
      category: 'Antissépticos',
      thumbnailUrl: null,
      archived: true,
      selectedPrice: null,
    },
    priceByList: { 'list-standard': '24.0000', 'list-varejo': '26.0000' },
  },
]

function withSelectedPrice(
  fixture: FixtureProduct,
  priceListId: string,
): CatalogProduct {
  const amount = fixture.priceByList[priceListId] ?? null
  return {
    ...fixture.product,
    selectedPrice:
      amount === null
        ? null
        : {
            productPriceId: `pp-${fixture.product.id}-${priceListId}`,
            priceListId,
            version: '3',
            amount,
            currencyCode: 'BRL',
          },
  }
}

function catalogResponse(
  request: Parameters<QuoteDataService['searchCatalog']>[0],
): CatalogSearchResponse {
  const priced = PRODUCTS.map((fixture) =>
    withSelectedPrice(fixture, request.priceListId),
  )
  const search = request.search?.toLowerCase()
  const items = priced.filter((product) => {
    if (search) {
      const haystack =
        `${product.description} ${product.internalCode} ${product.brand ?? ''}`.toLowerCase()
      if (!haystack.includes(search)) return false
    }
    if (request.industryIds?.length && !request.industryIds.includes(product.industryId)) {
      return false
    }
    if (request.brands?.length && (!product.brand || !request.brands.includes(product.brand))) {
      return false
    }
    if (request.categories?.length && !request.categories.includes(product.category ?? '')) {
      return false
    }
    return true
  })

  const limit = request.limit
  const startIndex = request.cursor ? Number(request.cursor) : 0
  const pageItems = items.slice(startIndex, startIndex + limit)
  const nextIndex = startIndex + limit
  const hasNextPage = nextIndex < items.length

  return {
    items: pageItems,
    facets: {
      industries: [...new Set(priced.map((p) => p.industryName))].map((name) => ({
        value: priced.find((p) => p.industryName === name)!.industryId,
        label: name,
        count: priced.filter((p) => p.industryName === name).length,
      })),
      brands: [...new Set(priced.filter((p) => p.brand).map((p) => p.brand!))].map(
        (brand) => ({
          value: brand,
          label: brand,
          count: priced.filter((p) => p.brand === brand).length,
        }),
      ),
      categories: [...new Set(priced.map((p) => p.category ?? ''))].map((category) => ({
        value: category,
        label: category,
        count: priced.filter((p) => p.category === category).length,
      })),
    },
    pageInfo: {
      nextCursor: hasNextPage ? String(nextIndex) : null,
      hasNextPage,
    },
    selectedPriceList:
      PRICE_LISTS.find((list) => list.id === request.priceListId) ?? PRICE_LISTS[0]!,
    availablePriceLists: PRICE_LISTS,
    defaultPriceListId: 'list-standard',
  }
}

interface DraftLine {
  readonly lineId: string
  readonly snapshot: NewQuoteLineSnapshot
  quantity: string
  discountRate: string
}

const state = {
  version: 7,
  lines: [] as DraftLine[],
  /** Simulates another user changing a source price between loads. */
  sourcePriceShift: false,
  /** Next recalculation fails with a 409 carrying a newer version. */
  conflictOnce: false,
  emptyCatalog: new URLSearchParams(window.location.search).has('empty-catalog'),
}

function savedLine(line: DraftLine): SavedQuoteLineSnapshot {
  return {
    lineId: line.lineId,
    productId: line.snapshot.productId,
    descriptionSnapshot: line.snapshot.descriptionSnapshot,
    unitSnapshot: line.snapshot.unitSnapshot,
    quantitySnapshot: line.quantity,
    productPriceIdSnapshot: line.snapshot.productPriceId,
    priceListIdSnapshot: line.snapshot.priceListId,
    productPriceVersionSnapshot: line.snapshot.productPriceVersion,
    unitPriceSnapshot: line.snapshot.unitPriceSnapshot,
    discountRateSnapshot: line.discountRate,
    taxSnapshots: [{ code: 'IPI', rate: '5.000000' }],
  }
}

function currentSource(line: DraftLine): CurrentQuoteLineSource {
  const fixture = PRODUCTS.find((entry) => entry.product.id === line.snapshot.productId)
  const baseAmount = fixture?.priceByList['list-standard'] ?? line.snapshot.unitPriceSnapshot
  const amount = state.sourcePriceShift
    ? new Decimal(baseAmount).plus('1.50').toFixed(4)
    : new Decimal(baseAmount).toFixed(4)
  return {
    productId: line.snapshot.productId,
    description: line.snapshot.descriptionSnapshot,
    unit: line.snapshot.unitSnapshot,
    thumbnailUrl: null,
    archived: false,
    price: {
      productPriceId: line.snapshot.productPriceId,
      priceListId: 'list-standard',
      version: state.sourcePriceShift ? '4' : '3',
      amount,
      currencyCode: 'BRL',
    },
  }
}

function pricingModel(): QuotePricingModel {
  const lines: readonly QuoteLineWithCurrentSource[] = state.lines.map((line) => {
    const current = currentSource(line)
    const saved = savedLine(line)
    const changed =
      saved.unitPriceSnapshot !== current.price!.amount ||
      state.sourcePriceShift
    return {
      saved,
      current,
      sourceStatus: changed ? 'changed' : 'current',
      changes: changed ? ['unitPrice'] : [],
      eligibleForNewSelection: true,
    }
  })
  return {
    quoteId: 'quote-e2e',
    version: String(state.version),
    selectedPriceList: PRICE_LISTS[0]!,
    lines,
  }
}

function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

function recalculate(input: QuoteRecalculationInput): QuoteRecalculationResult {
  if (state.conflictOnce) {
    state.conflictOnce = false
    throw new QuoteDataError({
      code: 'CONFLICT',
      status: 409,
      message: 'O orçamento foi alterado por outra pessoa.',
      currentVersion: String(state.version + 1),
    })
  }

  let subtotal = new Decimal(0)
  let itemDiscount = new Decimal(0)
  let tax = new Decimal(0)
  for (const line of input.lines) {
    const gross = money(new Decimal(line.quantity).times(line.unitPrice))
    const discount = money(gross.times(line.discountRate).dividedBy(100))
    const net = gross.minus(discount)
    subtotal = subtotal.plus(gross)
    itemDiscount = itemDiscount.plus(discount)
    tax = tax.plus(
      line.taxes.reduce(
        (sum, configured) =>
          sum.plus(money(net.times(configured.rate).dividedBy(100))),
        new Decimal(0),
      ),
    )
  }
  const netItems = money(subtotal.minus(itemDiscount))
  const generalDiscount = money(netItems.times(input.generalDiscountRate).dividedBy(100))
  const freight = money(new Decimal(input.freightAmount))
  const grandTotal = money(netItems.minus(generalDiscount).plus(freight))

  state.version += 1
  for (const line of input.lines) {
    const draft = state.lines.find((entry) => entry.lineId === line.lineId)
    if (draft) {
      draft.quantity = line.quantity
      draft.discountRate = line.discountRate
    }
  }

  return {
    quoteId: input.quoteId,
    version: String(state.version),
    lines: input.lines.map((line) => ({ lineId: line.lineId, grossAmount: '0' })),
    totals: {
      subtotalAmount: money(subtotal).toFixed(2),
      discountAmount: money(itemDiscount.plus(generalDiscount)).toFixed(2),
      taxAmount: money(tax).toFixed(2),
      freightAmount: freight.toFixed(2),
      grandTotalAmount: grandTotal.toFixed(2),
    },
  }
}

let searchCatalogCallCount = 0
let loadQuotePricingCallCount = 0

const service: QuoteDataService = {
  async searchCatalog(request) {
    searchCatalogCallCount += 1
    if (state.emptyCatalog) {
      return {
        ...catalogResponse(request),
        items: [],
        pageInfo: { nextCursor: null, hasNextPage: false },
      }
    }
    return catalogResponse(request)
  },
  async loadQuotePricing() {
    loadQuotePricingCallCount += 1
    const response: QuotePricingResponse = {
      quoteId: 'quote-e2e',
      version: String(state.version),
      selectedPriceList: PRICE_LISTS[0]!,
      lines: state.lines.map((line) => ({
        saved: savedLine(line),
        current: currentSource(line),
      })),
    }
    return response
  },
  async recalculateQuote(input) {
    return recalculate(input)
  },
}

function QuoteWorkspace({ emptyQuote }: { emptyQuote?: boolean }) {
  const client = React.useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      }),
    [],
  )
  const [editorKey, setEditorKey] = useState(0)
  const [lines, setLines] = useState<readonly QuoteLineWithCurrentSource[]>([])
  const [version, setVersion] = useState(String(state.version))
  const [totals, setTotals] = useState({
    subtotalAmount: '0.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    freightAmount: '0.00',
    grandTotalAmount: '0.00',
  })

  const reload = useCallback(async () => {
    await service.loadQuotePricing('quote-e2e')
    setVersion(String(state.version))
    setLines(pricingModel().lines)
  }, [])

  useEffect(() => {
    if (!emptyQuote) void reload()
  }, [emptyQuote, reload])

  const model: QuotePricingModel = React.useMemo(
    () => ({
      quoteId: 'quote-e2e',
      version,
      selectedPriceList: PRICE_LISTS[0]!,
      lines,
    }),
    [lines, version],
  )

  return (
    <QueryClientProvider client={client}>
      <main className="min-h-screen bg-paper px-4 py-8">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
          <section aria-label="Montagem do orçamento">
            <h1 className="font-display text-2xl text-navy">Novo orçamento</h1>
            <QuoteCatalogPicker
              service={service}
              defaultPriceListId="list-standard"
              onSelect={(snapshot) => {
                state.lines.push({
                  lineId: `line-${state.lines.length + 1}`,
                  snapshot,
                  quantity: '1',
                  discountRate: '0',
                })
                void reload().then(() => setEditorKey((key) => key + 1))
              }}
            />
          </section>
          {!emptyQuote ? (
            <QuoteLineItemEditor
              key={editorKey}
              model={model}
              authoritativeTotals={totals}
              generalDiscountRate="0"
              freightAmount="0"
              onRecalculate={async (input) => {
                const result = recalculate(input)
                setTotals(result.totals)
                await reload()
                return result
              }}
              onUpdateSourcePrice={() => undefined}
              onReloadConflict={() => void reload()}
            />
          ) : (
            <section aria-label="Editor de itens do orçamento" data-testid="empty-quote-surface">
              <h2 className="font-display text-xl text-navy">Itens do orçamento</h2>
            </section>
          )}
        </div>
      </main>
    </QueryClientProvider>
  )
}

Object.assign(window, {
  __quoteFixture: {
    setSourcePriceShift(value: boolean) {
      state.sourcePriceShift = value
    },
    queueConflict() {
      state.conflictOnce = true
    },
    setEmptyCatalog(value: boolean) {
      state.emptyCatalog = value
    },
    getSearchCatalogCallCount() {
      return searchCatalogCallCount
    },
    getLoadQuotePricingCallCount() {
      return loadQuotePricingCallCount
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QuoteWorkspace />
  </StrictMode>,
)
