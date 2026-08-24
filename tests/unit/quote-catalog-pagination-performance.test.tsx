/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  QuoteCatalogPicker,
  type QuoteCatalogPickerProps,
} from '@/features/app/quotes/quote-catalog-picker'
import type {
  CatalogProduct,
  CatalogSearchResponse,
  QuoteDataService,
} from '@/features/app/quotes/quote-data'

/**
 * Large-catalog guard: the picker must keep requesting server pages of
 * `pageSize` items and render exactly one page at a time. Virtualization
 * stays out of the dependency tree until measured profiling justifies it —
 * these assertions pin the bounded-page-size contract that makes that
 * decision safe.
 */

const PAGE_SIZE = 20

function buildProduct(index: number): CatalogProduct {
  return {
    id: `product-${String(index).padStart(4, '0')}`,
    internalCode: `INT-${String(index).padStart(4, '0')}`,
    manufacturerCode: null,
    description: `Produto de catálogo ${index} — descrição longa para medição de renderização`,
    unit: 'CX',
    industryId: `industry-${index % 5}`,
    industryName: `Indústria ${index % 5}`,
    brand: index % 3 === 0 ? 'Marca A' : null,
    category: `Categoria ${index % 4}`,
    thumbnailUrl: null,
    archived: false,
    selectedPrice: {
      productPriceId: `price-${index}`,
      priceListId: 'price-list-1',
      version: '1',
      amount: `${index + 1}.250000`,
      currencyCode: 'BRL',
    },
  }
}

const fullPage: CatalogSearchResponse = {
  items: Array.from({ length: PAGE_SIZE }, (_, index) => buildProduct(index)),
  facets: {
    industries: Array.from({ length: 5 }, (_, index) => ({
      value: `industry-${index}`,
      label: `Indústria ${index}`,
      count: PAGE_SIZE,
    })),
    brands: [{ value: 'Marca A', label: 'Marca A', count: PAGE_SIZE }],
    categories: Array.from({ length: 4 }, (_, index) => ({
      value: `Categoria ${index}`,
      label: `Categoria ${index}`,
      count: PAGE_SIZE,
    })),
  },
  pageInfo: { nextCursor: 'cursor-page-2', hasNextPage: true },
  selectedPriceList: { id: 'price-list-1', key: 'PRICE_1', displayName: 'Preço 1' },
  availablePriceLists: [{ id: 'price-list-1', key: 'PRICE_1', displayName: 'Preço 1' }],
  defaultPriceListId: 'price-list-1',
}

function renderPicker(overrides: Partial<QuoteCatalogPickerProps> = {}) {
  const searchCatalog = vi
    .fn<QuoteDataService['searchCatalog']>()
    .mockResolvedValue(fullPage)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const service: QuoteDataService = {
    searchCatalog,
    loadQuotePricing: vi.fn(),
    recalculateQuote: vi.fn(),
  }
  render(
    <QueryClientProvider client={client}>
      <QuoteCatalogPicker
        service={service}
        defaultPriceListId="price-list-1"
        onSelect={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  )
  return { searchCatalog }
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('large-catalog pagination contract', () => {
  it('renders a full 20-item page within the interaction budget without virtualization', async () => {
    const start = performance.now()
    renderPicker()

    const firstItem = await screen.findByRole('option', { name: /Produto de catálogo 0\b/ })
    expect(firstItem).toBeInTheDocument()
    const renderMs = performance.now() - start

    // This is a jsdom wall-clock guard, not a browser interaction metric.
    // Keep generous CI headroom for a bounded 20-row page while retaining a
    // budget far below a user-perceptible interaction delay; the structural
    // assertions below still prevent unbounded rendering without virtualization.
    expect(renderMs).toBeLessThan(1_500)
  })

  it('never fetches more than pageSize items in a single request', async () => {
    const { searchCatalog } = renderPicker()

    await screen.findByRole('option', { name: /Produto de catálogo 0\b/ })
    expect(searchCatalog).toHaveBeenCalledTimes(1)
    expect(searchCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ limit: PAGE_SIZE }),
    )
    // The listbox holds exactly one page of rows; facet selects add their
    // own option roles, so scope the count to the product listbox.
    const listbox = screen.getByRole('listbox', { name: 'Suggestions' })
    expect(within(listbox).getAllByRole('option')).toHaveLength(PAGE_SIZE)
  })

  it('keeps subsequent pages server-authoritative: each page is one request of pageSize', async () => {
    const { searchCatalog } = renderPicker()

    await screen.findByRole('option', { name: /Produto de catálogo 0\b/ })
    await screen.findByRole('button', { name: 'Próxima página' })

    const nextPage = {
      ...fullPage,
      items: Array.from({ length: PAGE_SIZE }, (_, index) => buildProduct(index + PAGE_SIZE)),
      pageInfo: { nextCursor: null, hasNextPage: false },
    }
    searchCatalog.mockResolvedValue(nextPage)

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }))

    await screen.findByRole('option', { name: /Produto de catálogo 20\b/ })
    expect(searchCatalog).toHaveBeenCalledTimes(2)
    expect(searchCatalog).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: PAGE_SIZE, cursor: 'cursor-page-2' }),
    )
    // Still exactly one page of rows in the DOM — no unbounded accumulation.
    const listboxAfter = screen.getByRole('listbox', { name: 'Suggestions' })
    expect(within(listboxAfter).getAllByRole('option')).toHaveLength(PAGE_SIZE)
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled()
  })
})
