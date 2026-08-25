// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrazilianMaskedInput,
  ComboboxInput,
  CurrencyInput,
  DateInput,
  PercentInput,
} from '@/components/forms/form-inputs'

afterEach(cleanup)

describe('specialized form inputs', () => {
  it('emits raw mask values for typing, paste and clearing', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <BrazilianMaskedInput
        aria-label="CNPJ"
        mask="cnpj"
        value=""
        onValueChange={onValueChange}
      />,
    )
    const input = screen.getByRole('textbox', { name: 'CNPJ' })

    fireEvent.change(input, { target: { value: '45.723.174/0001-10' } })
    expect(onValueChange).toHaveBeenLastCalledWith('45723174000110')

    rerender(
      <BrazilianMaskedInput
        aria-label="CNPJ"
        mask="cnpj"
        value="45723174000110"
        onValueChange={onValueChange}
      />,
    )
    expect(input).toHaveValue('45.723.174/0001-10')
    fireEvent.change(input, { target: { value: '' } })
    expect(onValueChange).toHaveBeenLastCalledWith('')
  })

  it('forwards disabled and read-only input states', () => {
    render(
      <>
        <BrazilianMaskedInput
          aria-label="CEP"
          mask="cep"
          value="60160196"
          onValueChange={vi.fn()}
          disabled
        />
        <BrazilianMaskedInput
          aria-label="Telefone"
          mask="phone"
          value="85998765432"
          onValueChange={vi.fn()}
          readOnly
        />
      </>,
    )
    expect(screen.getByRole('textbox', { name: 'CEP' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Telefone' })).toHaveAttribute(
      'readonly',
    )
  })

  it('converts currency and percent display values to domain numbers', () => {
    const onCurrencyChange = vi.fn()
    const onPercentChange = vi.fn()
    render(
      <>
        <CurrencyInput
          aria-label="Limite de crédito"
          value={1234.5}
          onValueChange={onCurrencyChange}
        />
        <PercentInput
          aria-label="Comissão"
          value={12.5}
          onValueChange={onPercentChange}
        />
      </>,
    )

    const currency = screen.getByRole('textbox', {
      name: 'Limite de crédito',
    })
    expect(currency).toHaveValue('R$ 1.234,50')
    fireEvent.focus(currency)
    expect(currency).toHaveValue('1234,5')
    fireEvent.change(currency, { target: { value: 'R$ 9.876,54' } })
    expect(onCurrencyChange).toHaveBeenLastCalledWith(9876.54)
    fireEvent.change(currency, { target: { value: '' } })
    expect(onCurrencyChange).toHaveBeenLastCalledWith(null)

    const percent = screen.getByRole('textbox', { name: 'Comissão' })
    fireEvent.focus(percent)
    fireEvent.change(percent, { target: { value: '7,25%' } })
    expect(onPercentChange).toHaveBeenLastCalledWith(7.25)
  })

  it('uses an ISO domain value for the native date control', () => {
    const onValueChange = vi.fn()
    render(
      <DateInput
        aria-label="Validade"
        value="2026-08-17"
        onValueChange={onValueChange}
      />,
    )
    const input = screen.getByLabelText('Validade')
    expect(input).toHaveValue('2026-08-17')
    fireEvent.change(input, { target: { value: '2026-09-01' } })
    expect(onValueChange).toHaveBeenCalledWith('2026-09-01')
  })

  it('commits an exact combobox option with the keyboard and can clear it', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <ComboboxInput
        aria-label="Cidade"
        value=""
        onValueChange={onValueChange}
        options={[
          { value: 'fortaleza', label: 'Fortaleza' },
          { value: 'recife', label: 'Recife' },
        ]}
      />,
    )
    const combobox = screen.getByRole('combobox', { name: 'Cidade' })
    fireEvent.change(combobox, { target: { value: 'Fortaleza' } })
    fireEvent.keyDown(combobox, { key: 'Enter' })
    expect(onValueChange).toHaveBeenLastCalledWith('fortaleza')
    expect(combobox).toHaveValue('')

    rerender(
      <ComboboxInput
        aria-label="Cidade"
        value="fortaleza"
        onValueChange={onValueChange}
        options={[
          { value: 'fortaleza', label: 'Fortaleza' },
          { value: 'recife', label: 'Recife' },
        ]}
      />,
    )
    expect(combobox).toHaveValue('Fortaleza')
    fireEvent.change(combobox, { target: { value: '' } })
    expect(onValueChange).toHaveBeenLastCalledWith('')
    expect(combobox).toHaveValue('Fortaleza')
  })
})
