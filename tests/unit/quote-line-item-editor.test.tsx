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

const onRetryLoad = vi.fn()

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

  it('renders per-line taxes with Decimal-safe labels and validates their ranges', () => {
    render(<QuoteLineItemEditor {...baseProps} />)

    const ipiField = screen.getByRole('textbox', { name: /IPI percentual de detergente/i })
    expect(ipiField).toHaveValue('3.250000')

    fireEvent.change(ipiField, { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Recalcular no servidor' }))
    expect(screen.getByText('Informe uma porcentagem entre 0 e 100.')).toBeInTheDocument()
  })

  it('applies line discounts, general discounts, and freight in the live preview', () => {
    render(
      <QuoteLineItemEditor
        {...baseProps}
        generalDiscountRate="10"
        freightAmount="15.5"
      />,
    )

    // Line 1: 2 × 10.005 = 20.01 gross, 5% item discount → 19.0095 net.
    // Line 2: 1 × 20 = 20 gross, no discount.
    // Subtotal 40.01; item discounts 1.0005 → net items 39.0095;
    // general discount 10% → 3.90095; freight 15.5.
    // Grand total = 39.0095 − 3.90095 + 15.5 = 50.61 (tax is display-only).
    const preview = screen.getByLabelText('Prévia de valores')
    expect(within(preview).getByText('R$ 40,01')).toBeInTheDocument()
    expect(within(preview).getByText('R$ 4,90')).toBeInTheDocument()
    expect(within(preview).getByText('R$ 15,50')).toBeInTheDocument()
    expect(within(preview).getByText('R$ 50,61')).toBeInTheDocument()

    // The server card stays untouched by draft edits.
    const official = screen.getByLabelText('Valores oficiais do servidor')
    expect(within(official).getByText('R$ 39,01')).toBeInTheDocument()
  })

  it('shows skeleton loading and retryable error availability states', async () => {
    const { rerender } = render(<QuoteLineItemEditor {...baseProps} availability="loading" />)
    expect(screen.getByLabelText('Carregando editor de itens')).toHaveAttribute('aria-busy', 'true')

    rerender(
      <QuoteLineItemEditor
        {...baseProps}
        availability="error"
        errorMessage="Catálogo indisponível."
        onRetryLoad={onRetryLoad}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível carregar os itens')
    expect(alert).toHaveTextContent('Catálogo indisponível.')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(onRetryLoad).toHaveBeenCalledTimes(1)
  })

  it('keeps focus on the edited field after a change and announces successful recalculation', async () => {
    const onRecalculate = vi.fn(baseProps.onRecalculate)
    render(<QuoteLineItemEditor {...baseProps} onRecalculate={onRecalculate} />)

    const quantity = screen.getByRole('textbox', { name: /quantidade de detergente/i })
    quantity.focus()
    fireEvent.change(quantity, { target: { value: '4' } })
    expect(quantity).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Recalcular no servidor' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Valores oficiais recalculados pelo servidor.',
      )
    })
    expect(onRecalculate).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: 'quote-1',
        expectedVersion: '12',
        selectedPriceListId: 'list-1',
      }),
    )
  })

  it('reports generic server failures without discarding drafts', async () => {
    const onRecalculate = vi.fn(async () => {
      throw new QuoteDataError({
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Falha interna do servidor.',
      })
    })
    render(<QuoteLineItemEditor {...baseProps} onRecalculate={onRecalculate} />)

    const quantity = screen.getByRole('textbox', { name: /quantidade de detergente/i })
    fireEvent.change(quantity, { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Recalcular no servidor' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Falha interna do servidor.')
    })
    expect(quantity).toHaveValue('9')
  })

  it('emits draft payloads for external conflict detection while editing', () => {
    const onDraftChange = vi.fn()
    render(<QuoteLineItemEditor {...baseProps} onDraftChange={onDraftChange} />)

    fireEvent.change(
      screen.getByRole('textbox', { name: /desconto percentual de detergente/i }),
      { target: { value: '12.5' } },
    )

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: 'quote-1',
        expectedVersion: '12',
        lines: [
          expect.objectContaining({
            lineId: 'line-1',
            quantity: '2.000000',
            unitPrice: '10.005000',
            discountRate: '12.5',
            taxes: [{ code: 'IPI', rate: '3.250000' }],
          }),
          expect.objectContaining({ lineId: 'line-2' }),
        ],
      }),
    )
  })
})
