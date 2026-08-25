/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuoteConversion, type QuoteConversionResult } from '@/features/app/quotes/quote-conversion'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const createdOrder: QuoteConversionResult = {
  kind: 'created',
  order: { id: 'order-123', number: 'PED-2026-000123' },
}

afterEach(cleanup)

describe('QuoteConversion', () => {
  it('requires confirmation and accepts only one activation while conversion is pending', async () => {
    const pending = deferred<QuoteConversionResult>()
    const convert = vi.fn(() => pending.promise)
    render(<QuoteConversion quoteNumber="ORC-2026-000123" availability={{ kind: 'available' }} onConvert={convert} />)

    fireEvent.click(screen.getByRole('button', { name: 'Converter em pedido' }))
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Converter orçamento em pedido?')
    expect(convert).not.toHaveBeenCalled()

    const confirm = screen.getByRole('button', { name: 'Confirmar conversão' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(convert).toHaveBeenCalledOnce()
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveTextContent('Convertendo…')

    pending.resolve(createdOrder)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Pedido PED-2026-000123 criado'))
    expect(screen.getByRole('link', { name: 'Abrir pedido PED-2026-000123' })).toHaveAttribute('href', '/app/pedidos/order-123')
  })

  it('reports an existing-order response without implying another order was created', async () => {
    const convert = vi.fn(async (): Promise<QuoteConversionResult> => ({
      kind: 'existing',
      order: { id: 'order-existing', number: 'PED-2026-000099' },
    }))
    render(<QuoteConversion quoteNumber="ORC-2026-000123" availability={{ kind: 'available' }} onConvert={convert} />)

    fireEvent.click(screen.getByRole('button', { name: 'Converter em pedido' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conversão' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Este orçamento já foi convertido no pedido PED-2026-000099'))
    expect(screen.getByRole('status')).toHaveTextContent('Nenhum novo pedido foi criado')
    expect(screen.getByRole('link', { name: 'Abrir pedido PED-2026-000099' })).toHaveAttribute('href', '/app/pedidos/order-existing')
  })

  it('shows an existing order immediately after reload without an actionable conversion control', () => {
    const onConvert = vi.fn()
    const { rerender } = render(
      <QuoteConversion
        quoteNumber="ORC-2026-000123"
        availability={{ kind: 'available' }}
        onConvert={onConvert}
      />,
    )

    rerender(
      <QuoteConversion
        quoteNumber="ORC-2026-000123"
        availability={{
          kind: 'existing',
          order: { id: 'persisted-order', number: 'PED-2026-000088' },
        }}
        onConvert={onConvert}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Converter em pedido' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('já foi convertido no pedido PED-2026-000088')
    expect(screen.getByRole('link', { name: 'Abrir pedido PED-2026-000088' })).toHaveAttribute('href', '/app/pedidos/persisted-order')
  })

  it('does not expose an actionable control to read-only users or illegal source states', () => {
    const { rerender } = render(
      <QuoteConversion
        quoteNumber="ORC-2026-000123"
        availability={{ kind: 'unavailable', reason: 'read-only' }}
        onConvert={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(
      <QuoteConversion
        quoteNumber="ORC-2026-000123"
        availability={{ kind: 'unavailable', reason: 'source-state', message: 'Somente orçamentos aprovados podem ser convertidos.' }}
        onConvert={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Somente orçamentos aprovados podem ser convertidos.')
  })

  it('offers a safe retry after a timeout and preserves idempotent existing-order feedback', async () => {
    const convert = vi
      .fn<() => Promise<QuoteConversionResult>>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        kind: 'existing',
        order: { id: 'order-after-timeout', number: 'PED-2026-000077' },
      })
    render(<QuoteConversion quoteNumber="ORC-2026-000123" availability={{ kind: 'available' }} onConvert={convert} />)

    fireEvent.click(screen.getByRole('button', { name: 'Converter em pedido' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conversão' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível confirmar o resultado')

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conversão' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Nenhum novo pedido foi criado'))
    expect(convert).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['denied', 'Seu perfil não tem permissão para converter este orçamento.'],
    ['illegal-state', 'O orçamento não está mais em um estado que permita conversão.'],
  ] as const)('handles a %s response without leaving an actionable control', async (kind, message) => {
    const convert = vi.fn(async (): Promise<QuoteConversionResult> => ({ kind, message }))
    render(<QuoteConversion quoteNumber="ORC-2026-000123" availability={{ kind: 'available' }} onConvert={convert} />)

    fireEvent.click(screen.getByRole('button', { name: 'Converter em pedido' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conversão' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
