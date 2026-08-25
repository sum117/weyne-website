import { describe, expect, it } from 'vitest'
import {
  compareDecimalStrings,
  decimalStringSchema,
  formatMoneyPtBr,
  formatPercentagePtBr,
  formatQuantityPtBr,
  formatUnitPricePtBr,
  moneySchema,
  parseMoneyPtBr,
  parsePercentagePtBr,
  parseQuantityPtBr,
  parseUnitPricePtBr,
  percentageSchema,
  quantitySchema,
  roundMoney,
  unitPriceSchema,
} from '@/domain/primitives/decimal'

describe('canonical decimal schemas', () => {
  it('accepts canonical locale-neutral decimal strings without changing them', () => {
    expect(decimalStringSchema.parse('0')).toBe('0')
    expect(decimalStringSchema.parse('1234567890123456789012345678901234')).toBe(
      '1234567890123456789012345678901234',
    )
    expect(decimalStringSchema.parse('1.2300')).toBe('1.2300')
  })

  it.each([
    '',
    ' 1',
    '1 ',
    '+1',
    '-1',
    '.5',
    '1.',
    '01',
    '1,5',
    '1.000,00',
    '1e3',
    'NaN',
    'Infinity',
  ])('rejects malformed, signed, localized, or over-precision input: %s', (value) => {
    expect(decimalStringSchema.safeParse(value).success).toBe(false)
  })

  it('enforces quantity DECIMAL(18,6) boundaries and positive sign', () => {
    expect(quantitySchema.parse('0.000001')).toBe('0.000001')
    expect(quantitySchema.parse('999999999999.999999')).toBe('999999999999.999999')
    expect(quantitySchema.safeParse('0').success).toBe(false)
    expect(quantitySchema.safeParse('0.000000').success).toBe(false)
    expect(quantitySchema.safeParse('0.0000001').success).toBe(false)
    expect(quantitySchema.safeParse('1000000000000.000000').success).toBe(false)
  })

  it('enforces unit-price DECIMAL(19,6) boundaries without rounding', () => {
    expect(unitPriceSchema.parse('0')).toBe('0')
    expect(unitPriceSchema.parse('9999999999999.999999')).toBe(
      '9999999999999.999999',
    )
    expect(unitPriceSchema.safeParse('0.0000001').success).toBe(false)
    expect(unitPriceSchema.safeParse('10000000000000').success).toBe(false)
  })

  it('requires published DECIMAL(19,2) money with exactly two places', () => {
    expect(moneySchema.parse('0.00')).toBe('0.00')
    expect(moneySchema.parse('99999999999999999.99')).toBe('99999999999999999.99')
    expect(moneySchema.safeParse('0').success).toBe(false)
    expect(moneySchema.safeParse('1.2').success).toBe(false)
    expect(moneySchema.safeParse('0.001').success).toBe(false)
    expect(moneySchema.safeParse('100000000000000000.00').success).toBe(false)
  })

  it('enforces the inclusive DECIMAL(9,6) percentage range', () => {
    expect(percentageSchema.parse('0')).toBe('0')
    expect(percentageSchema.parse('100.000000')).toBe('100.000000')
    expect(percentageSchema.safeParse('100.000001').success).toBe(false)
    expect(percentageSchema.safeParse('0.0000001').success).toBe(false)
  })
})

describe('exact decimal operations', () => {
  it('rounds money with ROUND_HALF_UP without IEEE-754 leakage', () => {
    expect(roundMoney('10.005')).toBe('10.01')
    expect(roundMoney('2.675')).toBe('2.68')
    expect(roundMoney('0.0049')).toBe('0.00')
  })

  it('rejects a rounded result outside the money persistence range', () => {
    expect(() => roundMoney('99999999999999999.995')).toThrow(
      'intervalo permitido',
    )
  })

  it('compares canonical values using arbitrary precision', () => {
    expect(compareDecimalStrings('9007199254740993', '9007199254740992')).toBe(1)
    expect(compareDecimalStrings('1.2300', '1.23')).toBe(0)
    expect(compareDecimalStrings('0.1', '0.10')).toBe(0)
  })
})

describe('strict pt-BR decimal boundaries', () => {
  it('parses strict pt-BR display values into canonical stored values', () => {
    expect(parseMoneyPtBr('1.234,56')).toBe('1234.56')
    expect(parseQuantityPtBr('0,500000')).toBe('0.500000')
    expect(parseUnitPricePtBr('10,0050')).toBe('10.0050')
    expect(parsePercentagePtBr('12,5')).toBe('12.5')
  })

  it.each([
    ['money', () => parseMoneyPtBr('1234.56')],
    ['currency symbol', () => parseMoneyPtBr('R$ 1.234,56')],
    ['spaces', () => parseMoneyPtBr(' 1,00')],
    ['bad grouping', () => parseMoneyPtBr('12.34,56')],
    ['missing cents', () => parseMoneyPtBr('1.234')],
    ['quantity scale', () => parseQuantityPtBr('1,0000001')],
    ['percentage range', () => parsePercentagePtBr('100,000001')],
  ])('rejects malformed or ambiguous pt-BR %s input', (_label, parse) => {
    expect(parse).toThrow('Informe')
  })

  it('formats canonical values without converting through JavaScript number', () => {
    expect(formatMoneyPtBr('12345678901234567.89')).toBe('12.345.678.901.234.567,89')
    expect(formatQuantityPtBr('1234.500000')).toBe('1.234,500000')
    expect(formatUnitPricePtBr('10.0050')).toBe('10,0050')
    expect(formatPercentagePtBr('12.5')).toBe('12,5')
  })
})
