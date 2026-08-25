// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProductPricing,
  pricingCapabilities,
  type ProductPricingProps,
} from '@/features/app/products/product-pricing'

const prices = [
  {
    priceListId: 'price-list-1',
    key: 'PRICE_1',
    displayName: 'Preço 1',
    amount: '1234567890123.123456',
    currencyCode: 'BRL',
    version: '1',
  },
  {
    priceListId: 'price-list-2',
    key: 'PRICE_2',
    displayName: 'Preço 2',
    amount: '0.000001',
    currencyCode: 'BRL',
    version: '2',
  },
  {
    priceListId: 'price-list-3',
    key: 'PRICE_3',
    displayName: 'Preço 3',
    amount: null,
    currencyCode: 'BRL',
    version: null,
  },
  {
    priceListId: 'price-list-4',
    key: 'PRICE_4',
    displayName: 'Preço 4',
    amount: '99.990000',
    currencyCode: 'BRL',
    version: '4',
  },
] as const

const baseProps = {
  role: 'admin',
  prices,
  commissionOverride: null,
  industryCommission: '4.250000',
  history: [],
  onSavePrices: vi.fn(),
  onSaveCommissionOverride: vi.fn(),
} satisfies ProductPricingProps

describe('product pricing', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('shows exactly the four canonical price-list labels', () => {
    render(<ProductPricing {...baseProps} />)

    expect(screen.getAllByLabelText(/^Preço [1-4]$/)).toHaveLength(4)
    expect(screen.getByLabelText('Preço 1')).toHaveValue('1234567890123.123456')
    expect(screen.getByLabelText('Preço 2')).toHaveValue('0.000001')
    expect(screen.getByLabelText('Preço 3')).toHaveValue('')
    expect(screen.getByLabelText('Preço 4')).toHaveValue('99.990000')
  })

  it('submits changed decimal strings exactly and requires a reason', async () => {
    const onSavePrices = vi.fn()
    render(<ProductPricing {...baseProps} onSavePrices={onSavePrices} />)

    fireEvent.change(screen.getByLabelText('Preço 1'), {
      target: { value: '9999999999999.999999' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar preços' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Informe o motivo da alteração de preço',
    )
    expect(onSavePrices).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Motivo da alteração'), {
      target: { value: 'Reajuste da indústria' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar preços' }))

    await waitFor(() =>
      expect(onSavePrices).toHaveBeenCalledWith({
        reason: 'Reajuste da indústria',
        changes: [
          {
            priceListId: 'price-list-1',
            amount: '9999999999999.999999',
            expectedVersion: '1',
          },
        ],
      }),
    )
  }, 15_000)

  it('rejects an invalid price without coercing it to a JavaScript number', async () => {
    const onSavePrices = vi.fn()
    render(<ProductPricing {...baseProps} onSavePrices={onSavePrices} />)

    fireEvent.change(screen.getByLabelText('Preço 2'), {
      target: { value: '0.0000001' },
    })
    fireEvent.change(screen.getByLabelText('Motivo da alteração'), {
      target: { value: 'Correção' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar preços' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Preço 2 deve ter no máximo 6 casas decimais',
    )
    expect(onSavePrices).not.toHaveBeenCalled()
  })

  it('preserves zero as a commission override and clears back to the industry default', async () => {
    const onSaveCommissionOverride = vi.fn()
    render(
      <ProductPricing
        {...baseProps}
        onSaveCommissionOverride={onSaveCommissionOverride}
      />,
    )

    expect(screen.getByText('Padrão da indústria: 4.250000%')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Comissão própria do produto'), {
      target: { value: '0.000000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar comissão' }))
    await waitFor(() =>
      expect(onSaveCommissionOverride).toHaveBeenLastCalledWith('0.000000'),
    )

    fireEvent.change(screen.getByLabelText('Comissão própria do produto'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar comissão' }))
    await waitFor(() =>
      expect(onSaveCommissionOverride).toHaveBeenLastCalledWith(null),
    )
  })

  it.each(['representative', 'read_only'] as const)(
    'gives the %s role a read-only presentation',
    (role) => {
      render(<ProductPricing {...baseProps} role={role} />)

      for (const label of ['Preço 1', 'Preço 2', 'Preço 3', 'Preço 4']) {
        expect(screen.getByLabelText(label)).toHaveAttribute('readonly')
      }
      expect(
        screen.queryByRole('button', { name: 'Salvar preços' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByLabelText('Comissão própria do produto'),
      ).not.toBeInTheDocument()
      expect(screen.getByText('Somente leitura')).toBeInTheDocument()
    },
  )

  it('derives visibility from the centralized matrix, not role comparisons', () => {
    // Representative holds price_list.view but not commission_rule.view:
    // current values stay visible, history does not.
    const { unmount } = render(<ProductPricing {...baseProps} role="representative" />)
    expect(screen.getByLabelText('Preço 1')).toHaveValue('1234567890123.123456')
    expect(screen.queryByText(/Histórico de preços/)).not.toBeInTheDocument()
    unmount()

    // read_only receives the O-projection: structure without price values.
    render(<ProductPricing {...baseProps} role="read_only" />)
    expect(screen.getByLabelText('Preço 1')).toHaveValue('')
    expect(screen.getByLabelText('Preço 1')).toHaveAttribute(
      'placeholder',
      'Restrito',
    )
    expect(pricingCapabilities('admin').canManagePrices).toBe(true)
    expect(pricingCapabilities('representative').canManageCommissionOverride).toBe(false)
    expect(pricingCapabilities('read_only').priceValuesVisible).toBe(false)
  })

  it('shows immutable history details without edit or delete controls', () => {
    render(
      <ProductPricing
        {...baseProps}
        history={[
          {
            id: 'history-1',
            priceListKey: 'PRICE_1',
            priceListName: 'Preço 1',
            oldAmount: '10.000001',
            newAmount: '10.123456',
            currencyCode: 'BRL',
            reason: 'Reajuste anual',
            actor: 'Ana Admin',
            changedAt: '2026-08-17T12:34:56.000Z',
          },
        ]}
      />,
    )

    const history = screen.getByRole('region', { name: 'Histórico de preços' })
    expect(history).toHaveTextContent('10.000001')
    expect(history).toHaveTextContent('10.123456')
    expect(history).toHaveTextContent('Reajuste anual')
    expect(history).toHaveTextContent('Ana Admin')
    expect(history.querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-08-17T12:34:56.000Z',
    )
    expect(screen.queryByRole('button', { name: /editar|excluir/i })).not.toBeInTheDocument()
  })

  it('announces API failures accessibly', () => {
    render(<ProductPricing {...baseProps} apiError="Conflito ao salvar preços" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Conflito ao salvar preços')
  })
})
