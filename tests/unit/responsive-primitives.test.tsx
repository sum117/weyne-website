// @vitest-environment jsdom

import * as React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SidebarInset } from '@/components/ui/sidebar'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import {
  ProductCatalog,
  type ProductCatalogItem,
} from '@/features/app/products/product-catalog'

const h = React.createElement

afterEach(cleanup)

describe('responsive primitive contracts', () => {
  it('keeps wide tables inside an intentional local scroll region', () => {
    render(
      h(
        Table,
        null,
        h(TableBody, null, h(TableRow, null, h(TableCell, null, 'Conteúdo'))),
      ),
    )

    const container = screen.getByText('Conteúdo').closest('[data-slot="table-container"]')
    expect(container).toHaveClass('max-w-full', 'overflow-x-auto', 'overscroll-x-contain')
  })

  it('allows app content to shrink beside the responsive sidebar', () => {
    render(h(SidebarInset, null, 'Conteúdo principal'))

    expect(screen.getByRole('main')).toHaveClass('min-w-0', 'w-full')
  })

  it('keeps long confirmation dialogs within the reflow viewport', () => {
    render(
      h(
        AlertDialog,
        { defaultOpen: true },
        h(
          AlertDialogContent,
          null,
          h(AlertDialogTitle, null, 'Confirmar ação'),
          h(AlertDialogDescription, null, 'Descrição extensa'),
        ),
      ),
    )

    expect(screen.getByRole('alertdialog')).toHaveClass(
      'max-h-[calc(100dvh-2rem)]',
      'overflow-y-auto',
      'overscroll-contain',
    )
  })

  it('stacks long product metadata and removes fixed mobile minimum widths', () => {
    const product: ProductCatalogItem = {
      id: 'product-with-long-content',
      internalCode: 'INTERNAL-CODE-WITHOUT-BREAKS-1234567890',
      manufacturerCode: 'MANUFACTURER-CODE-WITHOUT-BREAKS-1234567890',
      name: 'ProdutoComUmNomeMuitoLongoSemEspacosQuePrecisaRefluir',
      industry: 'IndustriaComUmNomeMuitoLongoSemEspacos',
      category: 'CategoriaComUmNomeMuitoLongoSemEspacos',
      brand: 'MarcaComUmNomeMuitoLongoSemEspacos',
      archived: false,
      prices: [
        { key: 'PRICE_1', label: 'Tabela 1', amount: '10.00' },
        { key: 'PRICE_2', label: 'Tabela 2', amount: '11.00' },
        { key: 'PRICE_3', label: 'Tabela 3', amount: '12.00' },
        { key: 'PRICE_4', label: 'Tabela 4', amount: '13.00' },
      ],
    }

    render(h(ProductCatalog, { products: [product], canManage: false }))

    const cards = screen.getByTestId('product-catalog-cards')
    expect(cards.querySelector('h2')).toHaveClass('break-words')
    expect(cards.querySelector('dl.grid-cols-1')).toHaveClass('sm:grid-cols-2')
    expect(cards.querySelector('dl.sm\\:min-w-48')).toHaveClass('min-w-0', 'max-w-full')
  })
})
