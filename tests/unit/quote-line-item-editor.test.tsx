/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  QuoteLineItemEditor,
  type QuoteLineItemEditorProps,
} from '@/features/app/quotes/quote-line-item-editor'
import {
  QuoteDataError,
  type QuoteRecalculationInput,
} from '@/features/app/quotes/quote-data'

const baseProps: QuoteLineItemEditorProps = {
  model: {
    quoteId: 'quote-1',
    version: '12',
    selectedPriceList: { id: 'list-1', key: 'PRICE_1', displayName: 'Preço 1' },
    lines: [
      {
        saved: {
          lineId: 'line-1',
          productId: 'product-1',
          descriptionSnapshot: 'Detergente profissional',
          unitSnapshot: 'CX',
          quantitySnapshot: '2.000000',
          productPriceIdSnapshot: 'price-v1',
          priceListIdSnapshot: 'list-1',
          productPriceVersionSnapshot: '1',
          unitPriceSnapshot: '10.005000',
          discountRateSnapshot: '5.000000',
          taxSnapshots: [{ code: 'IPI', rate: '3.250000' }],
        },
        current: {
          productId: 'product-1',
          description: 'Detergente profissional',
          unit: 'CX',
          archived: false,
          thumbnailUrl: '/images/product.webp',
          price: {
            productPriceId: 'price-v2',
            priceListId: 'list-1',
            version: '2',
            amount: '10.015000',
            currencyCode: 'BRL',
          },
        },
        sourceStatus: 'changed',
        changes: ['unitPrice'],
        eligibleForNewSelection: true,
      },
      {
        saved: {
          lineId: 'line-2',
          productId: 'product-2',
          descriptionSnapshot: 'Sabão líquido',
          unitSnapshot: 'UN',
          quantitySnapshot: '1',
          productPriceIdSnapshot: 'price-2',
          priceListIdSnapshot: 'list-1',
          productPriceVersionSnapshot: '1',
          unitPriceSnapshot: '20',
          discountRateSnapshot: '0',
          taxSnapshots: [],
        },
        current: null,
        sourceStatus: 'unavailable',
        changes: [],
        eligibleForNewSelection: false,
      },
    ],
  },
  authoritativeTotals: {
    subtotalAmount: '40.01',
    discountAmount: '1.00',
    taxAmount: '0.65',
    freightAmount: '0.00',
    grandTotalAmount: '39.01',
  },
  generalDiscountRate: '0',
  freightAmount: '0',
  onRecalculate: vi.fn(async (input: QuoteRecalculationInput) => ({
    quoteId: input.quoteId,
    version: '13',
    lines: input.lines.map((line) => ({ lineId: line.lineId, grossAmount: '20.01' })),
    totals: {
      subtotalAmount: '40.01',
      discountAmount: '1.00',
      taxAmount: '0.65',
      freightAmount: '0.00',
      grandTotalAmount: '39.01',
    },
  })),
  onUpdateSourcePrice: vi.fn(),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('QuoteLineItemEditor', () => {
  it('keeps invalid Decimal text recoverable and blocks server recalculation', async () => {
    const onRecalculate = vi.fn(baseProps.onRecalculate)
    render(<QuoteLineItemEditor {...baseProps} onRecalculate={onRecalculate} />)

    const quantity = screen.getByRole('textbox', { name: /quantidade de detergente/i })
    fireEvent.change(quantity, { target: { value: '1,' } })
    fireEvent.click(screen.getByRole('button', { name: 'Recalcular no servidor' }))

    expect(quantity).toHaveValue('1,')
    expect(screen.getByRole('alert')).toHaveTextContent('Informe um número decimal válido')
    expect(onRecalculate).not.toHaveBeenCalled()
  })

  it('shows a Decimal-safe live preview separately from authoritative totals', () => {
    render(<QuoteLineItemEditor {...baseProps} />)

    fireEvent.change(screen.getByRole('textbox', { name: /quantidade de detergente/i }), {
      target: { value: '3' },
    })

    expect(within(screen.getByLabelText('Prévia de valores')).getByText('R$ 48,52')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Valores oficiais do servidor')).getByText('R$ 39,01')).toBeInTheDocument()
    expect(screen.getByText(/prévia local.*servidor/i)).toBeInTheDocument()
  })

  it('keeps snapshots stable and offers an explicit current-price update', () => {
    const onUpdateSourcePrice = vi.fn()
    render(<QuoteLineItemEditor {...baseProps} onUpdateSourcePrice={onUpdateSourcePrice} />)

    const line = screen.getByTestId('quote-editor-line-line-1')
    expect(line).toHaveTextContent('Preço salvo R$ 10,005')
    expect(line).toHaveTextContent('Preço atual R$ 10,015')
    expect(screen.getByRole('img', { name: 'Detergente profissional' })).toHaveAttribute(
      'src',
      '/images/product.webp',
    )

    fireEvent.click(within(line).getByRole('button', { name: 'Atualizar para o preço atual' }))
    expect(onUpdateSourcePrice).toHaveBeenCalledWith('line-1')
  })

  it('adds selected-list snapshots without overwriting an edited persisted line', () => {
    const { rerender } = render(<QuoteLineItemEditor {...baseProps} />)
    const quantity = screen.getByRole('textbox', { name: /quantidade de detergente/i })
    fireEvent.change(quantity, { target: { value: '7.5' } })

    const addedLine = {
      ...baseProps.model.lines[1]!,
      saved: {
        ...baseProps.model.lines[1]!.saved,
        lineId: 'line-3',
        productId: 'product-3',
        descriptionSnapshot: 'Desinfetante',
        unitPriceSnapshot: '33.125000',
        priceListIdSnapshot: 'list-1',
      },
    }
    rerender(
      <QuoteLineItemEditor
        {...baseProps}
        model={{ ...baseProps.model, lines: [...baseProps.model.lines, addedLine] }}
      />,
    )

    expect(quantity).toHaveValue('7.5')
    expect(screen.getByTestId('quote-editor-line-line-3')).toHaveTextContent(
      'Preço salvo R$ 33,125',
    )
  })

  it('reorders and removes with accessible announcements and mobile-safe controls', () => {
    render(<QuoteLineItemEditor {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mover Sabão líquido para cima' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sabão líquido movido para a posição 1')
    expect(screen.getAllByTestId(/quote-editor-line-/)[0]).toHaveTextContent('Sabão líquido')

    fireEvent.click(screen.getByRole('button', { name: 'Remover Sabão líquido' }))
    expect(screen.getByRole('status')).toHaveTextContent('Sabão líquido removido')
    expect(screen.queryByText('Sabão líquido')).not.toBeInTheDocument()
  })

  it('preserves draft edits and surfaces optimistic-concurrency conflicts', async () => {
    const onRecalculate = vi.fn(async () => {
      throw new QuoteDataError({
        code: 'CONFLICT',
        status: 409,
        message: 'O orçamento foi alterado por outra pessoa.',
        currentVersion: '13',
      })
    })
    render(<QuoteLineItemEditor {...baseProps} onRecalculate={onRecalculate} />)

    const quantity = screen.getByRole('textbox', { name: /quantidade de detergente/i })
    fireEvent.change(quantity, { target: { value: '7.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Recalcular no servidor' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('alterado por outra pessoa')
    })
    expect(quantity).toHaveValue('7.5')
    expect(screen.getByRole('button', { name: 'Recarregar e reconciliar' })).toBeInTheDocument()
  })
})
