/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  QuoteDetailView,
  type QuoteDetail,
} from '@/features/app/quotes/quote-detail'

const quote: QuoteDetail = {
  id: 'quote-123',
  number: 'ORC-2026-000123',
  status: { code: 'sent', label: 'Enviado' },
  issuedOn: '2026-08-10',
  validUntil: '2026-08-25',
  customer: { name: 'Mercado São José', document: '12.345.678/0001-90' },
  industry: { name: 'Indústria Atlântico' },
  representative: { name: 'Marina Lima' },
  paymentTerms: '28 / 56 dias',
  freight: { terms: 'CIF', amount: '1250.40' },
  transporter: { name: 'Transportes Nordeste' },
  lines: [
    {
      id: 'line-1',
      productCode: 'LIMP-01',
      description: 'Detergente profissional 5 L',
      quantity: '12',
      unit: 'UN',
      unitPrice: '154.99',
      total: '1859.88',
    },
  ],
  totals: {
    grossItems: '1859.88',
    itemDiscounts: '59.88',
    generalDiscount: '100.00',
    freight: '1250.40',
    total: '2950.40',
  },
  capabilities: { canEdit: true },
  partialDataWarnings: [],
}

afterEach(cleanup)

describe('QuoteDetailView', () => {
  it('renders document data and only server-supplied totals with pt-BR formatting', () => {
    render(
      <QuoteDetailView
        state={{
          kind: 'ready',
          quote: {
            ...quote,
            totals: { ...quote.totals, total: '2999.99' },
          },
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'ORC-2026-000123' })).toBeInTheDocument()
    expect(screen.getByText('Enviado')).toBeInTheDocument()
    expect(screen.getByText('Mercado São José')).toBeInTheDocument()
    expect(screen.getByText('10/08/2026')).toBeInTheDocument()
    expect(screen.getByText('25/08/2026')).toBeInTheDocument()

    const totals = screen.getByLabelText('Resumo de valores')
    expect(within(totals).getByText('R$ 2.999,99')).toBeInTheDocument()
    expect(within(totals).getByText('R$ 1.250,40')).toBeInTheDocument()
    expect(within(totals).getByText('R$ 100,00')).toBeInTheDocument()
    expect(within(totals).queryByText('R$ 2.950,40')).not.toBeInTheDocument()
  })

  it('formats authoritative decimal strings without IEEE-754 coercion', () => {
    render(
      <QuoteDetailView
        state={{
          kind: 'ready',
          quote: {
            ...quote,
            totals: { ...quote.totals, total: '9007199254740993.01' },
          },
        }}
      />,
    )

    expect(
      within(screen.getByLabelText('Resumo de valores')).getByText(
        'R$ 9.007.199.254.740.993,01',
      ),
    ).toBeInTheDocument()
  })

  it('uses a wrapping line layout without a horizontal table trap', () => {
    render(<QuoteDetailView state={{ kind: 'ready', quote }} />)

    const line = screen.getByTestId('quote-line-line-1')
    expect(line).toHaveClass('grid-cols-1')
    expect(line).toHaveClass('sm:grid-cols-[minmax(0,1fr)_auto_auto]')
    expect(line).toHaveTextContent('Detergente profissional 5 L')
    expect(line).toHaveTextContent('12 UN')
    expect(line).toHaveTextContent('R$ 1.859,88')
  })

  it('keeps the server unit price discoverable when a product code is absent', () => {
    render(
      <QuoteDetailView
        state={{
          kind: 'ready',
          quote: {
            ...quote,
            lines: [{ ...quote.lines[0]!, productCode: null }],
          },
        }}
      />,
    )

    expect(screen.getByTestId('quote-line-line-1')).toHaveTextContent(
      'Unitário R$ 154,99',
    )
  })

  it('gates the edit action using server capabilities', () => {
    const { rerender } = render(<QuoteDetailView state={{ kind: 'ready', quote }} />)

    expect(screen.getByRole('link', { name: 'Editar orçamento' })).toHaveAttribute(
      'href',
      '/app/orcamentos/quote-123/editar',
    )

    rerender(
      <QuoteDetailView
        state={{
          kind: 'ready',
          quote: { ...quote, capabilities: { canEdit: false } },
        }}
      />,
    )
    expect(screen.queryByRole('link', { name: 'Editar orçamento' })).not.toBeInTheDocument()
  })

  it('reconciles the effective status and history immediately after a lifecycle command', async () => {
    render(
      <QuoteDetailView
        state={{ kind: 'ready', quote }}
        lifecycle={{
          version: '4',
          history: [],
          allowedActions: ['approveQuote'],
          canDuplicate: false,
          createIdempotencyKey: () => 'approve-key',
          onDuplicate: vi.fn(),
          onTransition: vi.fn(async () => ({
            kind: 'success' as const,
            quote: {
              id: quote.id,
              status: { code: 'approved', label: 'Aprovado' },
              version: '5',
            },
            history: {
              id: 'event-approved',
              actor: { id: 'user-1', name: 'Marina Lima', role: 'representative' },
              occurredAt: '2026-08-17T14:30:00.000Z',
              fromStatus: quote.status,
              toStatus: { code: 'approved', label: 'Aprovado' },
              reason: null,
              command: 'approveQuote' as const,
            },
          })),
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprovação' }))

    await waitFor(() => expect(screen.getByText('Aprovado')).toBeInTheDocument())
    expect(screen.getByLabelText('Histórico do orçamento')).toHaveTextContent(
      'Enviado → Aprovado',
    )
  })

  it('renders accessible loading, not-found, forbidden, partial, and retry states', () => {
    const retry = vi.fn()
    const { rerender } = render(<QuoteDetailView state={{ kind: 'loading' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Carregando orçamento')
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')

    rerender(<QuoteDetailView state={{ kind: 'not-found' }} />)
    expect(screen.getByRole('heading', { name: 'Orçamento não encontrado' })).toBeInTheDocument()

    rerender(<QuoteDetailView state={{ kind: 'forbidden' }} />)
    expect(screen.getByRole('heading', { name: 'Acesso não permitido' })).toBeInTheDocument()

    rerender(
      <QuoteDetailView
        state={{ kind: 'error', message: 'Falha temporária.', onRetry: retry }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(retry).toHaveBeenCalledOnce()

    rerender(
      <QuoteDetailView
        state={{
          kind: 'ready',
          quote: {
            ...quote,
            transporter: null,
            partialDataWarnings: ['Transportadora indisponível no momento.'],
          },
        }}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Transportadora indisponível no momento.',
    )
    expect(screen.getByText('Não informado')).toBeInTheDocument()
  })
})
