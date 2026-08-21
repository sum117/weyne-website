import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import {
  createLineSnapshotFromCatalog,
  mergeSavedLineWithCurrentSource,
  quoteCatalogQueryOptions,
  quoteDataKeys,
  quotePricingQueryOptions,
  quoteRecalculationMutationOptions,
  QuoteDataError,
  toCatalogState,
  toRecalculationState,
  QuoteSelectionError,
  type QuoteDataService,
} from '@/features/app/quotes/quote-data'

describe('quote catalog and pricing data integration', () => {
  it('keys and fetches catalog pages by the explicitly selected price list', async () => {
    const searchCatalog = vi.fn(async (request) => ({
      items: [],
      facets: { industries: [], brands: [], categories: [] },
      pageInfo: { nextCursor: null, hasNextPage: false },
      selectedPriceList: {
        id: request.priceListId,
        key: request.priceListId === 'list-1' ? 'PRICE_1' : 'PRICE_2',
        displayName: request.priceListId === 'list-1' ? 'Preço 1' : 'Preço 2',
      },
    }))
    const service = { searchCatalog } as unknown as QuoteDataService
    const queryClient = new QueryClient()
    const firstRequest = { priceListId: 'list-1', limit: 25 } as const
    const secondRequest = { priceListId: 'list-2', limit: 25 } as const

    await queryClient.fetchQuery(quoteCatalogQueryOptions(service, firstRequest))
    await queryClient.fetchQuery(quoteCatalogQueryOptions(service, secondRequest))

    expect(quoteDataKeys.catalog(firstRequest)).not.toEqual(
      quoteDataKeys.catalog(secondRequest),
    )
    expect(searchCatalog).toHaveBeenNthCalledWith(1, firstRequest)
    expect(searchCatalog).toHaveBeenNthCalledWith(2, secondRequest)
  })

  it('rejects archived products for new lines with an explicit unavailable reason', () => {
    const archivedProduct = {
      id: 'product-archived',
      internalCode: 'INT-9',
      manufacturerCode: null,
      description: 'Produto histórico',
      unit: 'CX',
      industryId: 'industry-1',
      industryName: 'Indústria',
      brand: null,
      category: null,
      thumbnailUrl: null,
      archived: true,
      selectedPrice: {
        productPriceId: 'price-1',
        priceListId: 'list-1',
        version: '7',
        amount: '10.005000',
        currencyCode: 'BRL',
      },
    } as const

    expect(() => createLineSnapshotFromCatalog(archivedProduct)).toThrow(
      new QuoteSelectionError('PRODUCT_ARCHIVED'),
    )
  })

  it('keeps saved snapshots renderable while exposing a changed current source price', () => {
    const saved = {
      lineId: 'line-1',
      productId: 'product-1',
      descriptionSnapshot: 'Descrição vendida',
      unitSnapshot: 'CX',
      quantitySnapshot: '2.000000',
      productPriceIdSnapshot: 'price-v1',
      priceListIdSnapshot: 'list-1',
      productPriceVersionSnapshot: '1',
      unitPriceSnapshot: '10.005000',
      discountRateSnapshot: '5.000000',
      taxSnapshots: [{ code: 'ipi', rate: '3.250000' }],
    } as const
    const merged = mergeSavedLineWithCurrentSource(saved, {
      productId: 'product-1',
      description: 'Descrição atualizada',
      unit: 'CX',
      archived: false,
      price: {
        productPriceId: 'price-v2',
        priceListId: 'list-1',
        version: '2',
        amount: '10.015000',
        currencyCode: 'BRL',
      },
    })

    expect(merged.saved).toBe(saved)
    expect(merged.saved.unitPriceSnapshot).toBe('10.005000')
    expect(merged.current?.price?.amount).toBe('10.015000')
    expect(merged.sourceStatus).toBe('changed')
    expect(merged.changes).toEqual(['description', 'unitPrice'])
  })

  it('passes Decimal strings through and keeps authoritative server rounding', async () => {
    const serverResult = {
      quoteId: 'quote-1',
      version: '13',
      lines: [{ lineId: 'line-1', grossAmount: '30.02' }],
      totals: {
        subtotalAmount: '30.02',
        discountAmount: '0.00',
        taxAmount: '1.54',
        freightAmount: '12.35',
        grandTotalAmount: '42.37',
      },
    } as const
    const recalculateQuote = vi.fn(async () => serverResult)
    const service = { recalculateQuote } as unknown as QuoteDataService
    const queryClient = new QueryClient()
    const input = {
      quoteId: 'quote-1',
      expectedVersion: '12',
      selectedPriceListId: 'list-1',
      generalDiscountRate: '0.000000',
      freightAmount: '12.345',
      lines: [
        {
          lineId: 'line-1',
          quantity: '3.000000',
          unitPrice: '10.005000',
          discountRate: '0.000000',
          taxes: [{ code: 'ipi', rate: '5.125000' }],
        },
      ],
    } as const
    const options = quoteRecalculationMutationOptions(service, queryClient)

    const result = await options.mutationFn!(input, {} as never)

    expect(recalculateQuote).toHaveBeenCalledWith(input)
    expect(result).toBe(serverResult)
    expect(result.lines[0]?.grossAmount).toBe('30.02')
    expect(result.totals.freightAmount).toBe('12.35')
  })

  it('surfaces optimistic-concurrency conflict responses separately from generic errors', async () => {
    const error = new QuoteDataError({
      code: 'CONFLICT',
      status: 409,
      message: 'O orçamento foi alterado por outra pessoa.',
      currentVersion: '13',
    })
    const recalculateQuote = vi.fn(async () => Promise.reject(error))
    const service = { recalculateQuote } as unknown as QuoteDataService
    const options = quoteRecalculationMutationOptions(service, new QueryClient())
    const input = {
      quoteId: 'quote-1',
      expectedVersion: '12',
      selectedPriceListId: 'list-1',
      generalDiscountRate: '0',
      freightAmount: '0',
      lines: [],
    } as const

    const responseError = await options.mutationFn!(input, {} as never).catch(
      (caught: unknown) => caught,
    )

    expect(recalculateQuote).toHaveBeenCalledWith(input)
    expect(toRecalculationState({ status: 'error', error: responseError })).toEqual({
      status: 'conflict',
      error,
      currentVersion: '13',
    })
  })

  it('invalidates only the recalculated quote, leaving cached catalog pages fresh', async () => {
    const serverResult = {
      quoteId: 'quote-1',
      version: '13',
      lines: [],
      totals: {
        subtotalAmount: '0.00',
        discountAmount: '0.00',
        taxAmount: '0.00',
        freightAmount: '0.00',
        grandTotalAmount: '0.00',
      },
    } as const
    const recalculateQuote = vi.fn(async () => serverResult)
    const service = { recalculateQuote } as unknown as QuoteDataService
    const queryClient = new QueryClient()
    const catalogRequest = { priceListId: 'list-1', limit: 20 } as const
    const catalogKey = quoteCatalogQueryOptions(service, catalogRequest).queryKey
    const catalogData = {
      items: [],
      facets: { industries: [], brands: [], categories: [] },
      pageInfo: { nextCursor: null, hasNextPage: false },
      selectedPriceList: {
        id: 'list-1',
        key: 'PRICE_1' as const,
        displayName: 'Preço 1',
      },
      availablePriceLists: [],
      defaultPriceListId: 'list-1',
    } as const
    // Seed cached read models without fetching: the mock service only
    // implements the mutation under test.
    const quoteKey = quotePricingQueryOptions(service, 'quote-1').queryKey
    queryClient.setQueryData(quoteKey, {
      quoteId: 'quote-1',
      version: '12',
      selectedPriceList: {
        id: 'list-1',
        key: 'PRICE_1' as const,
        displayName: 'Preço 1',
      },
      lines: [],
    })
    queryClient.setQueryData(catalogKey, catalogData)

    const options = quoteRecalculationMutationOptions(service, queryClient)
    await options.onSuccess?.(
      serverResult,
      {} as never,
      undefined as never,
      {} as never,
    )

    // The quote's pricing projection is stale and must refetch…
    const quoteState = queryClient.getQueryState(quoteKey)
    expect(quoteState?.isInvalidated).toBe(true)

    // …while the untouched catalog page stays fresh — no refetch storm.
    const catalogState = queryClient.getQueryState(catalogKey)
    expect(catalogState?.isInvalidated).toBe(false)
    expect(queryClient.getQueryData(catalogKey)).toEqual(catalogData)
  })

  it('loads saved lines and their current sources in one batched quote request', async () => {
    const line = {
      lineId: 'line-archived',
      productId: 'product-archived',
      descriptionSnapshot: 'Produto salvo',
      unitSnapshot: 'UN',
      quantitySnapshot: '1.000000',
      productPriceIdSnapshot: 'price-old',
      priceListIdSnapshot: 'list-1',
      productPriceVersionSnapshot: '1',
      unitPriceSnapshot: '7.000000',
      discountRateSnapshot: '0.000000',
      taxSnapshots: [],
    } as const
    const loadQuotePricing = vi.fn(async () => ({
      quoteId: 'quote-1',
      version: '4',
      selectedPriceList: {
        id: 'list-1',
        key: 'PRICE_1' as const,
        displayName: 'Preço 1',
      },
      lines: [{ saved: line, current: null }],
    }))
    const service = { loadQuotePricing } as unknown as QuoteDataService
    const queryClient = new QueryClient()

    const result = await queryClient.fetchQuery(
      quotePricingQueryOptions(service, 'quote-1'),
    )

    expect(loadQuotePricing).toHaveBeenCalledTimes(1)
    expect(loadQuotePricing).toHaveBeenCalledWith('quote-1')
    expect(result.lines[0]?.saved.descriptionSnapshot).toBe('Produto salvo')
    expect(result.lines[0]?.sourceStatus).toBe('unavailable')
  })

  it('maps catalog query lifecycle into explicit loading, empty, and error states', () => {
    const emptyData = {
      items: [],
      facets: { industries: [], brands: [], categories: [] },
      pageInfo: { nextCursor: null, hasNextPage: false },
      selectedPriceList: {
        id: 'list-1',
        key: 'PRICE_1' as const,
        displayName: 'Preço 1',
      },
      availablePriceLists: [],
      defaultPriceListId: 'list-1',
    }
    const error = new Error('offline')

    expect(toCatalogState({ status: 'pending' })).toEqual({ status: 'loading' })
    expect(toCatalogState({ status: 'success', data: emptyData })).toEqual({
      status: 'empty',
      data: emptyData,
    })
    expect(toCatalogState({ status: 'error', error })).toEqual({
      status: 'error',
      error,
    })
  })
})
