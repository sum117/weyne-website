import {
  mutationOptions,
  queryOptions,
  type QueryClient,
} from '@tanstack/react-query'
import Decimal from 'decimal.js'

export type DecimalString = string
export type PriceListKey = 'PRICE_1' | 'PRICE_2' | 'PRICE_3' | 'PRICE_4'

export interface CatalogSearchRequest {
  readonly priceListId: string
  readonly limit: number
  readonly cursor?: string
  readonly search?: string
  readonly industryIds?: readonly string[]
  readonly brands?: readonly string[]
  readonly categories?: readonly string[]
}

export interface CatalogFacetOption {
  readonly value: string
  readonly label: string
  readonly count: number
}

export interface CatalogProductPrice {
  readonly productPriceId: string
  readonly priceListId: string
  readonly version: string
  readonly amount: DecimalString
  readonly currencyCode: 'BRL'
}

export interface CatalogProduct {
  readonly id: string
  readonly internalCode: string
  readonly manufacturerCode: string | null
  readonly description: string
  readonly unit: string
  readonly industryId: string
  readonly industryName: string
  readonly brand: string | null
  readonly category: string | null
  readonly thumbnailUrl: string | null
  readonly archived: boolean
  /** Applicable price is joined by the service for the selected list. */
  readonly selectedPrice: CatalogProductPrice | null
}

export interface PriceListSummary {
  readonly id: string
  readonly key: PriceListKey
  readonly displayName: string
}

export interface CatalogSearchResponse {
  readonly items: readonly CatalogProduct[]
  readonly facets: Readonly<{
    industries: readonly CatalogFacetOption[]
    brands: readonly CatalogFacetOption[]
    categories: readonly CatalogFacetOption[]
  }>
  readonly pageInfo: Readonly<{
    nextCursor: string | null
    hasNextPage: boolean
  }>
  readonly selectedPriceList: PriceListSummary
  readonly availablePriceLists: readonly PriceListSummary[]
  readonly defaultPriceListId: string
}

export type CatalogState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'empty'; data: CatalogSearchResponse }>
  | Readonly<{ status: 'ready'; data: CatalogSearchResponse }>
  | Readonly<{ status: 'error'; error: unknown }>

type CatalogQueryStateInput =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'success'; data: CatalogSearchResponse }>
  | Readonly<{ status: 'error'; error: unknown }>

export function toCatalogState(query: CatalogQueryStateInput): CatalogState {
  if (query.status === 'pending') return { status: 'loading' }
  if (query.status === 'error') return { status: 'error', error: query.error }
  if (query.data.items.length === 0) {
    return { status: 'empty', data: query.data }
  }
  return { status: 'ready', data: query.data }
}

export interface QuoteDataService {
  /** One shaped request returns products, applicable prices, and facets. */
  searchCatalog(request: CatalogSearchRequest): Promise<CatalogSearchResponse>
  /** Server response is the authority for every published total and rounding point. */
  recalculateQuote(
    input: QuoteRecalculationInput,
  ): Promise<QuoteRecalculationResult>
  /** One aggregate read prevents per-line product and price requests. */
  loadQuotePricing(quoteId: string): Promise<QuotePricingResponse>
}

export interface QuoteRecalculationLineInput {
  readonly lineId: string
  readonly quantity: DecimalString
  readonly unitPrice: DecimalString
  readonly discountRate: DecimalString
  readonly taxes: readonly Readonly<{
    code: string
    rate: DecimalString
  }>[]
}

export interface QuoteRecalculationInput {
  readonly quoteId: string
  /** Opaque optimistic-concurrency token; never coerce it to a number. */
  readonly expectedVersion: string
  readonly selectedPriceListId: string
  readonly generalDiscountRate: DecimalString
  readonly freightAmount: DecimalString
  readonly lines: readonly QuoteRecalculationLineInput[]
}

export interface QuoteRecalculationResult {
  readonly quoteId: string
  readonly version: string
  readonly lines: readonly Readonly<{
    lineId: string
    grossAmount: DecimalString
  }>[]
  readonly totals: Readonly<{
    subtotalAmount: DecimalString
    discountAmount: DecimalString
    taxAmount: DecimalString
    freightAmount: DecimalString
    grandTotalAmount: DecimalString
  }>
}

export type QuoteDataErrorDetails = Readonly<{
  code:
    | 'VALIDATION_FAILED'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'INTERNAL_ERROR'
    | 'NETWORK_ERROR'
  status: number
  message: string
  currentVersion?: string
}>

export class QuoteDataError extends Error {
  readonly code: QuoteDataErrorDetails['code']
  readonly status: number
  readonly currentVersion?: string

  constructor(details: QuoteDataErrorDetails) {
    super(details.message)
    this.name = 'QuoteDataError'
    this.code = details.code
    this.status = details.status
    this.currentVersion = details.currentVersion
  }
}

export type RecalculationState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'success'; data: QuoteRecalculationResult }>
  | Readonly<{
      status: 'conflict'
      error: QuoteDataError
      currentVersion: string | undefined
    }>
  | Readonly<{ status: 'error'; error: unknown }>

type MutationStateInput =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'success'; data: QuoteRecalculationResult }>
  | Readonly<{ status: 'error'; error: unknown }>

export function toRecalculationState(
  mutation: MutationStateInput,
): RecalculationState {
  if (mutation.status === 'idle') return { status: 'idle' }
  if (mutation.status === 'pending') return { status: 'loading' }
  if (mutation.status === 'success') {
    return { status: 'success', data: mutation.data }
  }
  if (
    mutation.error instanceof QuoteDataError &&
    mutation.error.code === 'CONFLICT'
  ) {
    return {
      status: 'conflict',
      error: mutation.error,
      currentVersion: mutation.error.currentVersion,
    }
  }
  return { status: 'error', error: mutation.error }
}

export type QuoteSelectionErrorCode =
  | 'PRODUCT_ARCHIVED'
  | 'PRICE_UNAVAILABLE'

export class QuoteSelectionError extends Error {
  readonly code: QuoteSelectionErrorCode

  constructor(code: QuoteSelectionErrorCode) {
    super(code)
    this.name = 'QuoteSelectionError'
    this.code = code
  }
}

/** Immutable values copied into a newly inserted draft line. */
export interface NewQuoteLineSnapshot {
  readonly productId: string
  readonly descriptionSnapshot: string
  readonly unitSnapshot: string
  readonly productPriceId: string
  readonly priceListId: string
  readonly productPriceVersion: string
  readonly unitPriceSnapshot: DecimalString
  readonly currencyCode: 'BRL'
}

export function createLineSnapshotFromCatalog(
  product: CatalogProduct,
): NewQuoteLineSnapshot {
  if (product.archived) {
    throw new QuoteSelectionError('PRODUCT_ARCHIVED')
  }
  if (product.selectedPrice === null) {
    throw new QuoteSelectionError('PRICE_UNAVAILABLE')
  }

  return {
    productId: product.id,
    descriptionSnapshot: product.description,
    unitSnapshot: product.unit,
    productPriceId: product.selectedPrice.productPriceId,
    priceListId: product.selectedPrice.priceListId,
    productPriceVersion: product.selectedPrice.version,
    unitPriceSnapshot: product.selectedPrice.amount,
    currencyCode: product.selectedPrice.currencyCode,
  }
}

export interface SavedQuoteLineSnapshot {
  readonly lineId: string
  readonly productId: string
  readonly descriptionSnapshot: string
  readonly unitSnapshot: string
  readonly quantitySnapshot: DecimalString
  readonly productPriceIdSnapshot: string
  readonly priceListIdSnapshot: string
  readonly productPriceVersionSnapshot: string
  readonly unitPriceSnapshot: DecimalString
  readonly discountRateSnapshot: DecimalString
  readonly taxSnapshots: readonly Readonly<{
    code: string
    rate: DecimalString
  }>[]
}

export interface CurrentQuoteLineSource {
  readonly productId: string
  readonly description: string
  readonly unit: string
  readonly thumbnailUrl?: string | null
  readonly archived: boolean
  readonly price: CatalogProductPrice | null
}

export type QuoteLineSourceChange =
  | 'description'
  | 'unit'
  | 'unitPrice'
  | 'priceVersion'

export interface QuoteLineWithCurrentSource {
  readonly saved: SavedQuoteLineSnapshot
  readonly current: CurrentQuoteLineSource | null
  readonly sourceStatus: 'current' | 'changed' | 'unavailable'
  readonly changes: readonly QuoteLineSourceChange[]
  readonly eligibleForNewSelection: boolean
}

export interface QuotePricingResponse {
  readonly quoteId: string
  readonly version: string
  readonly selectedPriceList: PriceListSummary
  readonly lines: readonly Readonly<{
    saved: SavedQuoteLineSnapshot
    current: CurrentQuoteLineSource | null
  }>[]
}

export interface QuotePricingModel {
  readonly quoteId: string
  readonly version: string
  readonly selectedPriceList: PriceListSummary
  readonly lines: readonly QuoteLineWithCurrentSource[]
}

/** Adds live metadata without mutating or replacing persisted snapshots. */
export function mergeSavedLineWithCurrentSource(
  saved: SavedQuoteLineSnapshot,
  current: CurrentQuoteLineSource | null,
): QuoteLineWithCurrentSource {
  if (current === null || current.archived || current.price === null) {
    return {
      saved,
      current,
      sourceStatus: 'unavailable',
      changes: [],
      eligibleForNewSelection: false,
    }
  }

  const changes: QuoteLineSourceChange[] = []
  if (saved.descriptionSnapshot !== current.description) changes.push('description')
  if (saved.unitSnapshot !== current.unit) changes.push('unit')
  if (!new Decimal(saved.unitPriceSnapshot).eq(current.price.amount)) {
    changes.push('unitPrice')
  } else if (
    saved.productPriceIdSnapshot !== current.price.productPriceId ||
    saved.productPriceVersionSnapshot !== current.price.version
  ) {
    changes.push('priceVersion')
  }

  return {
    saved,
    current,
    sourceStatus: changes.length === 0 ? 'current' : 'changed',
    changes,
    eligibleForNewSelection: true,
  }
}

function stableCatalogRequest(request: CatalogSearchRequest) {
  return {
    ...request,
    industryIds: [...(request.industryIds ?? [])].sort(),
    brands: [...(request.brands ?? [])].sort(),
    categories: [...(request.categories ?? [])].sort(),
  }
}

export const quoteDataKeys = {
  all: ['quote-data'] as const,
  catalogs: () => [...quoteDataKeys.all, 'catalog'] as const,
  catalog: (request: CatalogSearchRequest) =>
    [...quoteDataKeys.catalogs(), stableCatalogRequest(request)] as const,
  quotes: () => [...quoteDataKeys.all, 'quote'] as const,
  quote: (quoteId: string) => [...quoteDataKeys.quotes(), quoteId] as const,
}

export function quoteCatalogQueryOptions(
  service: QuoteDataService,
  request: CatalogSearchRequest,
) {
  return queryOptions({
    queryKey: quoteDataKeys.catalog(request),
    queryFn: () => service.searchCatalog(request),
  })
}

export function quotePricingQueryOptions(
  service: QuoteDataService,
  quoteId: string,
) {
  return queryOptions({
    queryKey: quoteDataKeys.quote(quoteId),
    queryFn: async (): Promise<QuotePricingModel> => {
      const response = await service.loadQuotePricing(quoteId)
      return {
        quoteId: response.quoteId,
        version: response.version,
        selectedPriceList: response.selectedPriceList,
        lines: response.lines.map(({ saved, current }) =>
          mergeSavedLineWithCurrentSource(saved, current),
        ),
      }
    },
  })
}

export function quoteRecalculationMutationOptions(
  service: QuoteDataService,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationKey: [...quoteDataKeys.all, 'recalculate'] as const,
    mutationFn: (input: QuoteRecalculationInput) =>
      service.recalculateQuote(input),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: quoteDataKeys.quote(result.quoteId) }),
        queryClient.invalidateQueries({ queryKey: quoteDataKeys.catalogs() }),
      ])
    },
  })
}
