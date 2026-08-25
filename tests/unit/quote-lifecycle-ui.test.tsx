/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  QuoteLifecycleControls,
  QuoteLifecycleHistory,
  type QuoteLifecycleCommandRequest,
  type QuoteLifecycleMutationResult,
} from '@/features/app/quotes/quote-lifecycle'
import {
  quoteLifecycleKeys,
  reconcileQuoteLifecycleCaches,
  type QuoteLifecycleSummary,
} from '@/features/app/quotes/quote-lifecycle-data'

const sentSummary: QuoteLifecycleSummary = {
  id: 'quote-123',
  status: { code: 'sent', label: 'Enviado' },
  version: '4',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

afterEach(cleanup)

describe('QuoteLifecycleControls', () => {
  it('shows only server-permitted actions and sends required reasons with one stable key', async () => {
    const requests: QuoteLifecycleCommandRequest[] = []
    const transition = vi.fn(async (request: QuoteLifecycleCommandRequest): Promise<QuoteLifecycleMutationResult> => {
      requests.push(request)
      return {
        kind: 'success',
        quote: { id: 'quote-123', status: { code: 'rejected', label: 'Rejeitado' }, version: '5' },
        history: {
          id: 'event-1',
          actor: { id: 'user-1', name: 'Marina Lima', role: 'representative' },
          occurredAt: '2026-08-17T14:30:00.000Z',
          fromStatus: { code: 'sent', label: 'Enviado' },
          toStatus: { code: 'rejected', label: 'Rejeitado' },
          reason: 'Cliente recusou as condições.',
          command: 'rejectQuote',
        },
      }
    })

    render(
      <QuoteLifecycleControls
        quote={sentSummary}
        allowedActions={['approveQuote', 'rejectQuote']}
        canDuplicate={false}
        createIdempotencyKey={() => 'stable-key'}
        onTransition={transition}
        onDuplicate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rejeitar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reabrir' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Duplicar' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rejeitar' }))
    const dialog = screen.getByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'Confirmar rejeição' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Motivo'), {
      target: { value: ' Cliente recusou as condições. ' },
    })
    fireEvent.click(confirm)

    await waitFor(() => expect(transition).toHaveBeenCalledOnce())
    expect(requests[0]).toEqual({
      quoteId: 'quote-123',
      command: 'rejectQuote',
      reason: 'Cliente recusou as condições.',
      idempotencyKey: 'stable-key',
    })
  })

  it('prevents double submission and reconciles status/history only after success', async () => {
    const pending = deferred<QuoteLifecycleMutationResult>()
    const transition = vi.fn(() => pending.promise)
    const reconciled = vi.fn()
    render(
      <QuoteLifecycleControls
        quote={sentSummary}
        allowedActions={['approveQuote']}
        canDuplicate={false}
        createIdempotencyKey={() => 'approve-key'}
        onTransition={transition}
        onDuplicate={vi.fn()}
        onReconciled={reconciled}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    const confirm = screen.getByRole('button', { name: 'Confirmar aprovação' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(transition).toHaveBeenCalledOnce()
    expect(confirm).toBeDisabled()
    expect(reconciled).not.toHaveBeenCalled()

    pending.resolve({
      kind: 'success',
      quote: { id: 'quote-123', status: { code: 'approved', label: 'Aprovado' }, version: '5' },
      history: {
        id: 'event-2',
        actor: { id: 'user-1', name: 'Marina Lima', role: 'representative' },
        occurredAt: '2026-08-17T14:30:00.000Z',
        fromStatus: { code: 'sent', label: 'Enviado' },
        toStatus: { code: 'approved', label: 'Aprovado' },
        reason: null,
        command: 'approveQuote',
      },
    })

    await waitFor(() => expect(reconciled).toHaveBeenCalledOnce())
    expect(screen.getByRole('status')).toHaveTextContent('Orçamento aprovado com sucesso')
  })

  it.each([
    ['denied', 'Seu perfil não tem permissão para esta ação.'],
    ['illegal-state', 'O orçamento mudou e esta transição não é mais permitida.'],
    ['stale', 'Outra pessoa alterou este orçamento. Atualize os dados e tente novamente.'],
    ['failed', 'Não foi possível concluir a ação. Tente novamente.'],
  ] as const)('shows an actionable %s error without claiming success', async (kind, message) => {
    const transition = vi.fn(async (): Promise<QuoteLifecycleMutationResult> => ({ kind, message }))
    render(
      <QuoteLifecycleControls
        quote={sentSummary}
        allowedActions={['approveQuote']}
        canDuplicate={false}
        createIdempotencyKey={() => 'retry-key'}
        onTransition={transition}
        onDuplicate={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprovação' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message))
    expect(screen.queryByText(/com sucesso/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })

  it('confirms duplication once and links the distinct editable draft', async () => {
    const duplicate = vi.fn(async () => ({
      kind: 'success' as const,
      quote: { id: 'quote-new', number: 'ORC-2026-000124' },
    }))
    render(
      <QuoteLifecycleControls
        quote={sentSummary}
        allowedActions={[]}
        canDuplicate
        createIdempotencyKey={() => 'duplicate-key'}
        onTransition={vi.fn()}
        onDuplicate={duplicate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Duplicar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar duplicação' }))

    const link = await screen.findByRole('link', { name: 'Editar ORC-2026-000124' })
    expect(duplicate).toHaveBeenCalledWith({
      sourceQuoteId: 'quote-123',
      idempotencyKey: 'duplicate-key',
    })
    expect(link).toHaveAttribute('href', '/app/orcamentos/quote-new/editar')
    expect(screen.getByText(/orçamento original não foi alterado/i)).toBeInTheDocument()
  })
})

describe('QuoteLifecycleHistory', () => {
  it('renders actor, time, transition, and reason', () => {
    render(
      <QuoteLifecycleHistory
        events={[{
          id: 'event-1',
          actor: { id: 'user-1', name: 'Marina Lima', role: 'representative' },
          occurredAt: '2026-08-17T14:30:00.000Z',
          fromStatus: { code: 'sent', label: 'Enviado' },
          toStatus: { code: 'rejected', label: 'Rejeitado' },
          reason: 'Cliente recusou as condições.',
          command: 'rejectQuote',
        }]}
      />,
    )

    const history = screen.getByLabelText('Histórico do orçamento')
    expect(history).toHaveTextContent('Marina Lima')
    expect(history).toHaveTextContent('Enviado → Rejeitado')
    expect(history).toHaveTextContent('Cliente recusou as condições.')
    expect(history.querySelector('time')).toHaveAttribute('datetime', '2026-08-17T14:30:00.000Z')
  })
})

describe('reconcileQuoteLifecycleCaches', () => {
  it('updates list and detail summaries before invalidating both queries', async () => {
    const client = new QueryClient()
    client.setQueryData(quoteLifecycleKeys.list({ page: 1 }), [sentSummary])
    client.setQueryData(quoteLifecycleKeys.detail('quote-123'), sentSummary)

    await reconcileQuoteLifecycleCaches(client, {
      id: 'quote-123',
      status: { code: 'approved', label: 'Aprovado' },
      version: '5',
    })

    expect(client.getQueryData<QuoteLifecycleSummary>(quoteLifecycleKeys.detail('quote-123'))?.status.code).toBe('approved')
    expect(client.getQueryData<QuoteLifecycleSummary[]>(quoteLifecycleKeys.list({ page: 1 }))?.[0]?.status.code).toBe('approved')
    expect(client.getQueryState(quoteLifecycleKeys.detail('quote-123'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(quoteLifecycleKeys.list({ page: 1 }))?.isInvalidated).toBe(true)
  })
})
