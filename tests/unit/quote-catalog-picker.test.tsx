/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const activeProduct: CatalogProduct = {
  id: 'product-active',
  internalCode: 'INT-001',
  manufacturerCode: 'FAB-77',
  description: 'Detergente concentrado',
  unit: 'CX',
  industryId: 'industry-north',
  industryName: 'Indústria Norte',
  brand: 'Marca Azul',
  category: 'Higiene',
  thumbnailUrl: null,
  archived: false,
  selectedPrice: {
    productPriceId: 'price-active',
    priceListId: 'price-list-1',
    version: '7',
    amount: '10.500000',
    currencyCode: 'BRL',
  },
}

const archivedProduct: CatalogProduct = {
  ...activeProduct,
  id: 'product-archived',
  internalCode: 'INT-002',
  description: 'Papel institucional',
  archived: true,
}

const response: CatalogSearchResponse = {
  items: [activeProduct, archivedProduct],
  facets: {
    industries: [{ value: 'industry-north', label: 'Indústria Norte', count: 2 }],
    brands: [{ value: 'Marca Azul', label: 'Marca Azul', count: 2 }],
    categories: [{ value: 'Higiene', label: 'Higiene', count: 2 }],
  },
  pageInfo: { nextCursor: 'next-page', hasNextPage: true },
  selectedPriceList: { id: 'price-list-1', key: 'PRICE_1', displayName: 'Preço 1' },
  availablePriceLists: [
    { id: 'price-list-1', key: 'PRICE_1', displayName: 'Preço 1' },
    { id: 'price-list-2', key: 'PRICE_2', displayName: 'Preço 2' },
  ],
  defaultPriceListId: 'price-list-1',
}

function renderPicker(
  overrides: Partial<QuoteCatalogPickerProps> = {},
  searchCatalog = vi.fn<QuoteDataService['searchCatalog']>().mockResolvedValue(response),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const onSelect = vi.fn()
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
        onSelect={onSelect}
        {...overrides}
      />
    </QueryClientProvider>,
  )

  return { onSelect, searchCatalog }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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

describe('QuoteCatalogPicker', () => {
  it('selects an eligible product by keyboard and emits an immutable line snapshot', async () => {
    const { onSelect } = renderPicker()

    const search = await screen.findByRole('combobox', { name: 'Buscar produtos' })
    await screen.findByRole('option', { name: /Detergente concentrado/ })
    search.focus()
    fireEvent.keyDown(search, { key: 'Enter' })

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        productId: 'product-active',
        descriptionSnapshot: 'Detergente concentrado',
        unitSnapshot: 'CX',
        productPriceId: 'price-active',
        priceListId: 'price-list-1',
        productPriceVersion: '7',
        unitPriceSnapshot: '10.500000',
        currencyCode: 'BRL',
      }),
    )
    expect(search).toHaveFocus()
    expect(screen.getByRole('option', { name: /Papel institucional/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText(/Produto arquivado/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('Produto sem imagem')).toHaveLength(2)
  })

  it('debounces server search and resets cursor pagination when a facet changes', async () => {
    const searchCatalog = vi
      .fn<QuoteDataService['searchCatalog']>()
      .mockResolvedValue(response)
    renderPicker({}, searchCatalog)

    const search = await screen.findByRole('combobox', { name: 'Buscar produtos' })
    await screen.findByRole('option', { name: /Detergente concentrado/ })
    expect(searchCatalog).toHaveBeenCalledTimes(1)

    fireEvent.change(search, { target: { value: 'detergente' } })
    expect(searchCatalog).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(searchCatalog).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'detergente', cursor: undefined }),
      ),
    )
    await screen.findByRole('button', { name: 'Próxima página' })

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }))
    await waitFor(() =>
      expect(searchCatalog).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: 'next-page' }),
      ),
    )
    await screen.findByRole('option', { name: /Higiene/ })

    fireEvent.change(screen.getByLabelText('Categoria'), {
      target: { value: 'Higiene' },
    })
    await waitFor(() =>
      expect(searchCatalog).toHaveBeenLastCalledWith(
        expect.objectContaining({ categories: ['Higiene'], cursor: undefined }),
      ),
    )
  })

  it('changes the selected price-list context and exposes loading, empty, and retryable errors', async () => {
    const onPriceListChange = vi.fn()
    renderPicker({ onPriceListChange })
    await screen.findByRole('option', { name: /Detergente concentrado/ })

    fireEvent.change(screen.getByLabelText('Tabela de preços'), {
      target: { value: 'price-list-2' },
    })
    expect(onPriceListChange).toHaveBeenCalledWith('price-list-2')

    cleanup()
    const loading = vi.fn<QuoteDataService['searchCatalog']>(
      () => new Promise(() => undefined),
    )
    renderPicker({}, loading)
    expect(screen.getByRole('status')).toHaveTextContent('Carregando catálogo')

    cleanup()
    renderPicker(
      {},
      vi.fn<QuoteDataService['searchCatalog']>().mockResolvedValue({
        ...response,
        items: [],
        pageInfo: { nextCursor: null, hasNextPage: false },
      }),
    )
    expect(await screen.findByText(/Nenhum produto encontrado/)).toBeInTheDocument()

    cleanup()
    const failing = vi
      .fn<QuoteDataService['searchCatalog']>()
      .mockRejectedValue(new Error('offline'))
    renderPicker({}, failing)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar o catálogo',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(2))
  })
})
