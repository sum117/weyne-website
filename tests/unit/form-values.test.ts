import { describe, expect, it } from 'vitest'
import {
  formatBrazilianDate,
  formatBrazilianMask,
  formatCurrency,
  formatPercent,
  normalizeBrazilianMask,
  parseBrazilianDecimal,
} from '@/components/forms/form-values'

describe('Brazilian form values', () => {
  it('keeps domain digits separate from CPF, CNPJ, CEP and phone display masks', () => {
    expect(normalizeBrazilianMask('cnpj', '45.723.174/0001-10')).toBe(
      '45723174000110',
    )
    expect(formatBrazilianMask('cnpj', '45723174000110')).toBe(
      '45.723.174/0001-10',
    )
    expect(formatBrazilianMask('cpf', '36641876870')).toBe('366.418.768-70')
    expect(formatBrazilianMask('cep', '60160196')).toBe('60160-196')
    expect(formatBrazilianMask('phone', '85998765432')).toBe(
      '(85) 99876-5432',
    )
  })

  it('handles paste noise, length limits and clearing', () => {
    expect(normalizeBrazilianMask('phone', '+55 (85) 99876-5432')).toBe(
      '85998765432',
    )
    expect(normalizeBrazilianMask('cep', '60.160-196 extra')).toBe('60160196')
    expect(formatBrazilianMask('cep', '')).toBe('')
    expect(formatBrazilianMask('cnpj', '457231740001109999')).toBe(
      '45.723.174/0001-10',
    )
  })

  it('preserves the alphanumeric CNPJ base introduced by Receita Federal', () => {
    expect(normalizeBrazilianMask('cnpj', '12.abc.345/01de-35')).toBe(
      '12ABC34501DE35',
    )
    expect(formatBrazilianMask('cnpj', '12ABC34501DE35')).toBe(
      '12.ABC.345/01DE-35',
    )
  })

  it('parses pt-BR decimals without floating display ambiguity', () => {
    expect(parseBrazilianDecimal('R$ 1.234,56')).toBe(1234.56)
    expect(parseBrazilianDecimal('1.234')).toBe(1234)
    expect(parseBrazilianDecimal('-12,5%')).toBe(-12.5)
    expect(parseBrazilianDecimal('')).toBeNull()
    expect(parseBrazilianDecimal('texto')).toBeNull()
  })

  it('formats currency, percent and calendar dates deterministically in pt-BR', () => {
    expect(formatCurrency(1234.5)).toBe('R$ 1.234,50')
    expect(formatPercent(12.5)).toBe('12,5%')
    expect(formatBrazilianDate('2026-08-17')).toBe('17/08/2026')
    expect(formatBrazilianDate('')).toBe('')
  })
})
