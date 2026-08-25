import { describe, expect, it } from 'vitest'
import {
  APP_LOCALE,
  formatCurrency,
  formatDate,
  formatPercent,
} from '@/lib/intl/format'

describe('shared international formatters', () => {
  it('binds all formatters to the application locale', () => {
    expect(APP_LOCALE).toBe('pt-BR')
    expect(formatCurrency(1234.5)).toBe('R$ 1.234,50')
    expect(formatCurrency(1234.5, 'USD')).toBe('US$ 1.234,50')
    expect(formatPercent(12.5)).toBe('12,5%')
  })

  it('applies caller-provided date options without changing the locale', () => {
    const value = new Date('2026-08-17T12:34:00.000Z')

    expect(formatDate(value, { timeZone: 'UTC' })).toBe('17/08/2026')
    expect(
      formatDate(value, {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'UTC',
      }),
    ).toBe('17/08/2026, 12:34')
  })
})
