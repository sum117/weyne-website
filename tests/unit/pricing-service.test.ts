import { describe, expect, it } from 'vitest'
import {
  CANONICAL_PRICE_LIST_KEYS,
  parsePriceAmount,
} from '@/lib/catalog/pricing.server'

describe('pricing service Decimal boundary', () => {
  it('accepts exact non-negative numeric(19, 6) values and serializes six decimals', () => {
    expect(parsePriceAmount('0')).toEqual({ ok: true, value: '0.000000' })
    expect(parsePriceAmount(' 1234567890123.123456 ')).toEqual({
      ok: true,
      value: '1234567890123.123456',
    })
  })

  it('rejects negative, imprecise, oversized, and non-decimal values', () => {
    for (const value of [
      '-0.000001',
      '1.0000001',
      '12345678901234.000000',
      '1e3',
      'NaN',
      '',
    ]) {
      expect(parsePriceAmount(value)).toEqual({
        ok: false,
        message: 'Price must be a non-negative decimal with at most 13 integer and 6 fractional digits.',
      })
    }
  })

  it('defines exactly the four supported price-list keys', () => {
    expect(CANONICAL_PRICE_LIST_KEYS).toEqual([
      'PRICE_1',
      'PRICE_2',
      'PRICE_3',
      'PRICE_4',
    ])
  })
})
