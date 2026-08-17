import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  Decimal,
  type QuoteCalculationInput,
  type QuoteCalculationResult,
} from '@/domain/quote-engine'

const decimal = (value: string) => new Decimal(value)

const emptyInput = {
  lines: [],
  generalDiscountRate: decimal('0'),
  freightAmount: decimal('0.00'),
} as const satisfies QuoteCalculationInput

const emptyResult = {
  lines: [],
  totals: {
    grossItemsAmount: decimal('0.00'),
    perItemDiscountAmount: decimal('0.00'),
    netItemsAmount: decimal('0.00'),
    generalDiscountAmount: decimal('0.00'),
    netAfterDiscountsAmount: decimal('0.00'),
    ipiAmount: decimal('0.00'),
    configuredTaxAmount: decimal('0.00'),
    freightAmount: decimal('0.00'),
    grandTotalAmount: decimal('0.00'),
    commissionBasisAmount: decimal('0.00'),
    commissionAmount: decimal('0.00'),
  },
} as const satisfies QuoteCalculationResult

describe('quote engine domain boundary', () => {
  it('represents an empty quote with exact Decimal audit totals', () => {
    expectTypeOf(emptyInput).toMatchTypeOf<QuoteCalculationInput>()
    expectTypeOf(emptyResult).toMatchTypeOf<QuoteCalculationResult>()

    expect(emptyResult.lines).toHaveLength(0)
    for (const amount of Object.values(emptyResult.totals)) {
      expect(amount).toBeInstanceOf(Decimal)
      expect(amount.isZero()).toBe(true)
    }
  })

  it('represents immutable price, discount, tax, freight, and commission audit fields', () => {
    const input = {
      lines: [
        {
          lineId: 'line-1',
          quantity: decimal('1.250'),
          unitPrice: {
            productId: 'product-1',
            productPriceVersionId: 'price-version-1',
            priceListId: 'price-list-1',
            source: 'price_list',
            amount: decimal('10.0050'),
          },
          perItemDiscountRate: decimal('5.000000'),
          ipiRate: decimal('2.000000'),
          configuredTaxes: [
            { code: 'icms', rate: decimal('18.000000') },
            { code: 'pis', rate: decimal('1.650000') },
          ],
          commission: {
            productOverrideRate: null,
            industryDefaultRate: decimal('3.000000'),
          },
        },
      ],
      generalDiscountRate: decimal('1.000000'),
      freightAmount: decimal('12.34'),
    } as const satisfies QuoteCalculationInput

    const result = {
      lines: [
        {
          lineId: 'line-1',
          quantity: decimal('1.250'),
          unitPriceAmount: decimal('10.0050'),
          grossAmount: decimal('12.51'),
          perItemDiscountRate: decimal('5.000000'),
          perItemDiscountAmount: decimal('0.63'),
          netBeforeGeneralDiscountAmount: decimal('11.88'),
          allocatedGeneralDiscountAmount: decimal('0.12'),
          netAfterDiscountsAmount: decimal('11.76'),
          ipi: {
            rate: decimal('2.000000'),
            basisAmount: decimal('11.76'),
            amount: decimal('0.24'),
          },
          configuredTaxes: [
            {
              code: 'icms',
              rate: decimal('18.000000'),
              basisAmount: decimal('11.76'),
              amount: decimal('2.12'),
            },
          ],
          taxAmount: decimal('2.36'),
          freightAmount: decimal('12.34'),
          lineTotalAmount: decimal('26.46'),
          commission: {
            source: 'industry_default',
            rate: decimal('3.000000'),
            basisAmount: decimal('11.76'),
            amount: decimal('0.35'),
          },
        },
      ],
      totals: {
        grossItemsAmount: decimal('12.51'),
        perItemDiscountAmount: decimal('0.63'),
        netItemsAmount: decimal('11.88'),
        generalDiscountAmount: decimal('0.12'),
        netAfterDiscountsAmount: decimal('11.76'),
        ipiAmount: decimal('0.24'),
        configuredTaxAmount: decimal('2.12'),
        freightAmount: decimal('12.34'),
        grandTotalAmount: decimal('26.46'),
        commissionBasisAmount: decimal('11.76'),
        commissionAmount: decimal('0.35'),
      },
    } as const satisfies QuoteCalculationResult

    expectTypeOf(input).toMatchTypeOf<QuoteCalculationInput>()
    expectTypeOf(result).toMatchTypeOf<QuoteCalculationResult>()
    expect(result.lines[0]?.unitPriceAmount.toFixed(4)).toBe('10.0050')
  })

  it('has no framework, persistence, or I/O imports', () => {
    const source = readFileSync(
      new URL('../../src/domain/quote-engine.ts', import.meta.url),
      'utf8',
    )
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      ([, dependency]) => dependency,
    )

    expect(imports).toEqual(['decimal.js'])
    expect(source).not.toMatch(
      /(?:react|drizzle|postgres|database|orm|fetch|axios|node:fs|node:http)/i,
    )
  })

  it('keeps financial arithmetic Decimal-only and makes every rounding mode explicit', () => {
    const source = readFileSync(
      new URL('../../src/domain/quote-engine.ts', import.meta.url),
      'utf8',
    )
    const roundingCalls = [...source.matchAll(/\.toDecimalPlaces\(([^)]*)\)/g)].map(
      ([, argumentsSource]) => argumentsSource,
    )

    expect(source).toContain(
      'Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })',
    )
    expect(source).not.toMatch(
      /(?:Math\.|parseFloat\(|parseInt\(|Number\(|\.toNumber\(|\.valueOf\()/,
    )
    expect(roundingCalls).not.toHaveLength(0)
    expect(roundingCalls.every((call) => call?.includes('Decimal.ROUND_'))).toBe(true)
  })
})
