/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ProductCatalog,
  type ProductCatalogItem,
} from '@/features/app/products/product-catalog'

const products: ProductCatalogItem[] = [
  {
    id: 'product-1',
    internalCode: 'INT-001',
    manufacturerCode: 'FAB-77',
    name: 'Detergente concentrado',
    industry: 'Indústria Norte',
    category: 'Higiene',
    brand: 'Marca Azul',
    archived: false,
    prices: [
      { key: 'PRICE_1', label: 'Tabela 1', amount: '10.500000' },
      { key: 'PRICE_2', label: 'Tabela 2', amount: '11.000000' },
      { key: 'PRICE_3', label: 'Tabela 3', amount: '12.250000' },
      { key: 'PRICE_4', label: 'Tabela 4', amount: '13.000000' },
    ],
  },
  {
    id: 'product-2',
    internalCode: 'INT-002',
    manufacturerCode: null,
    name: 'Papel institucional',
    industry: 'Indústria Sul',
    category: 'Papéis',
    brand: 'Marca Clara',
    archived: true,
    prices: [
      { key: 'PRICE_1', label: 'Tabela 1', amount: '20.000000' },
      { key: 'PRICE_2', label: 'Tabela 2', amount: '21.000000' },
      { key: 'PRICE_3', label: 'Tabela 3', amount: '22.000000' },
      { key: 'PRICE_4', label: 'Tabela 4', amount: '23.000000' },
    ],
  },
]

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('ProductCatalog', () => {
  it('filters independently by identifier and text and exposes responsive views', () => {
    render(<ProductCatalog products={products} canManage />)

    expect(screen.getByTestId('product-catalog-table')).toHaveClass('hidden', 'md:block')
    expect(screen.getByTestId('product-catalog-cards')).toHaveClass('md:hidden')

    fireEvent.change(screen.getByLabelText('Buscar por identificador'), {
      target: { value: 'FAB77' },
    })
    expect(window.location.search).toContain('identifier=FAB77')
    expect(screen.getAllByText('Detergente concentrado')).toHaveLength(2)
    expect(screen.queryByText('Papel institucional')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Buscar por identificador'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByLabelText('Buscar por nome'), {
      target: { value: 'papel' },
    })
    expect(screen.getAllByText('Papel institucional')).toHaveLength(2)
    expect(screen.queryByText('Detergente concentrado')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getAllByText('Detergente concentrado')).toHaveLength(2)
    expect(screen.getAllByText('Papel institucional')).toHaveLength(2)
    expect(window.location.search).toBe('')
  })

  it('renders loading, empty, and retryable error states without table overflow', () => {
    const retry = vi.fn()
    const { rerender } = render(<ProductCatalog products={[]} canManage={false} loading />)
    expect(screen.getByRole('status')).toHaveTextContent('Carregando produtos')

    rerender(<ProductCatalog products={[]} canManage={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('Nenhum produto cadastrado')

    rerender(
      <ProductCatalog
        products={[]}
        canManage={false}
        error="Não foi possível carregar o catálogo."
        onRetry={retry}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('hides mutating actions from unauthorized users', () => {
    render(<ProductCatalog products={products} canManage={false} />)
    expect(screen.queryByRole('link', { name: 'Novo produto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arquivar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Editar/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Ver' })).toHaveLength(4)
  })

  it('confirms archive and reports a rejected archive request accessibly', async () => {
    const archive = vi
      .fn()
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValueOnce(undefined)
    render(
      <ProductCatalog
        products={[products[0]!]}
        canManage
        onArchiveStateChange={archive}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Arquivar' })[0]!)
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Arquivar produto?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Arquivar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível arquivar o produto',
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Arquivar' }))
    expect(archive).toHaveBeenCalledTimes(2)
  })
})
