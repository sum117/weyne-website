/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuoteListView } from '@/features/app/quotes/quote-list'

afterEach(cleanup)

describe('QuoteListView lifecycle integration', () => {
  it('renders the server effective status and reconciles it after a command', async () => {
    render(
      <QuoteListView
        quotes={[{
          id: 'quote-123',
          number: 'ORC-2026-000123',
          customerName: 'Mercado São José',
          status: { code: 'sent', label: 'Enviado' },
          version: '4',
          allowedActions: ['approveQuote'],
          canDuplicate: false,
        }]}
        createIdempotencyKey={() => 'approve-key'}
        onDuplicate={vi.fn()}
        onTransition={vi.fn(async () => ({
          kind: 'success' as const,
          quote: {
            id: 'quote-123',
            status: { code: 'approved', label: 'Aprovado' },
            version: '5',
          },
          history: {
            id: 'event-1',
            actor: { id: 'user-1', name: 'Marina Lima', role: 'representative' },
            occurredAt: '2026-08-17T14:30:00.000Z',
            fromStatus: { code: 'sent', label: 'Enviado' },
            toStatus: { code: 'approved', label: 'Aprovado' },
            reason: null,
            command: 'approveQuote' as const,
          },
        }))}
      />,
    )

    const row = screen.getByTestId('quote-row-quote-123')
    expect(within(row).getByText('Enviado')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Aprovar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprovação' }))

    await waitFor(() => expect(within(row).getByText('Aprovado')).toBeInTheDocument())
    expect(within(row).queryByText('Enviado')).not.toBeInTheDocument()
  })

  it('does not render controls absent from server capabilities', () => {
    render(
      <QuoteListView
        quotes={[{
          id: 'quote-read-only',
          number: 'ORC-2026-000099',
          customerName: 'Cliente leitura',
          status: { code: 'sent', label: 'Enviado' },
          version: '2',
          allowedActions: [],
          canDuplicate: false,
        }]}
        onDuplicate={vi.fn()}
        onTransition={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir ORC-2026-000099' })).toHaveAttribute(
      'href',
      '/app/orcamentos/quote-read-only',
    )
  })
})
