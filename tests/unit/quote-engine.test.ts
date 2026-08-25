import { describe, expect, it } from 'vitest'
import {
  calculateQuote,
  Decimal,
  QuoteCalculationError,
  type QuoteCalculationInput,
} from '@/domain/quote-engine'

const decimal = (value: string) => new Decimal(value)
const money = (value: Decimal) => value.toFixed(2)

function line(
  lineId: string,
  quantity: string,
  amount: string,
  discount: string,
  configuredTaxes: readonly { code: string; rate: string }[] = [],
  ipiRate = '0',
) {
  return {
    lineId,
    quantity: decimal(quantity),
    unitPrice: {
      productId: `product-${lineId}`,
      productPriceVersionId: `price-${lineId}`,
      priceListId: 'price-list-2',
      source: 'price_list' as const,
      amount: decimal(amount),
    },
    perItemDiscountRate: decimal(discount),
    ipiRate: decimal(ipiRate),
    configuredTaxes: configuredTaxes.map((tax) => ({
      code: tax.code,
      rate: decimal(tax.rate),
    })),
    commission: {
      productOverrideRate: null,
      industryDefaultRate: decimal('3'),
    },
  }
}

describe('calculateQuote', () => {
  it('calculates the documented deterministic scenario using exact decimal arithmetic', () => {
    // Independent expectations (not produced by the engine):
    // A: 3 × 10.005 = 30.015 -> 30.02; 5% = 1.50; net = 28.52
    // B: 2.5 × 19.99 = 49.975 -> 49.98; 10% = 5.00; net = 44.98
    // C: 1 × 25.00 = 25.00; no line discount
    // Header net = 98.50; 7.5% general discount = 7.39.
    // Largest-remainder allocation = A 2.14, B 3.37, C 1.88.
    // Net merchandise = A 26.38, B 41.61, C 23.12 = 91.11.
    // Freight 12.345 -> 12.35; informational taxes never change grand total.
    const input = {
      lines: [
        line('a', '3', '10.005', '5', [{ code: 'icms', rate: '18' }], '5.125'),
        line('b', '2.5', '19.99', '10', [{ code: 'icms', rate: '12' }], '2'),
        line('c', '1', '25', '0'),
      ],
      generalDiscountRate: decimal('7.5'),
      freightAmount: decimal('12.345'),
    } satisfies QuoteCalculationInput

    const result = calculateQuote(input)

    expect(
      result.lines.map((item) => ({
        id: item.lineId,
        gross: money(item.grossAmount),
        lineDiscount: money(item.perItemDiscountAmount),
        afterLineDiscount: money(item.netBeforeGeneralDiscountAmount),
        generalDiscount: money(item.allocatedGeneralDiscountAmount),
        merchandise: money(item.netAfterDiscountsAmount),
        ipi: money(item.ipi.amount),
        configuredTax: money(item.configuredTaxes[0]?.amount ?? decimal('0')),
        taxTotal: money(item.taxAmount),
        freightContribution: money(item.freightAmount),
        lineTotal: money(item.lineTotalAmount),
      })),
    ).toEqual([
      {
        id: 'a', gross: '30.02', lineDiscount: '1.50', afterLineDiscount: '28.52',
        generalDiscount: '2.14', merchandise: '26.38', ipi: '1.35',
        configuredTax: '4.75', taxTotal: '6.10', freightContribution: '0.00',
        lineTotal: '26.38',
      },
      {
        id: 'b', gross: '49.98', lineDiscount: '5.00', afterLineDiscount: '44.98',
        generalDiscount: '3.37', merchandise: '41.61', ipi: '0.83',
        configuredTax: '4.99', taxTotal: '5.82', freightContribution: '0.00',
        lineTotal: '41.61',
      },
      {
        id: 'c', gross: '25.00', lineDiscount: '0.00', afterLineDiscount: '25.00',
        generalDiscount: '1.88', merchandise: '23.12', ipi: '0.00',
        configuredTax: '0.00', taxTotal: '0.00', freightContribution: '0.00',
        lineTotal: '23.12',
      },
    ])

    expect(Object.fromEntries(Object.entries(result.totals).map(([key, value]) => [key, money(value)]))).toEqual({
      grossItemsAmount: '105.00',
      perItemDiscountAmount: '6.50',
      netItemsAmount: '98.50',
      generalDiscountAmount: '7.39',
      netAfterDiscountsAmount: '91.11',
      ipiAmount: '2.18',
      configuredTaxAmount: '9.74',
      freightAmount: '12.35',
      grandTotalAmount: '103.46',
      commissionBasisAmount: '91.11',
      commissionAmount: '2.73',
    })
  })

  it('uses ROUND_HALF_UP only at documented publication boundaries', () => {
    const result = calculateQuote({
      lines: [line('boundary', '3', '10.005', '0')],
      generalDiscountRate: decimal('0'),
      freightAmount: decimal('0'),
    })

    expect(money(result.lines[0]!.grossAmount)).toBe('30.02')
  })

  it('allocates a tied discount cent by canonical line id order', () => {
    const result = calculateQuote({
      lines: [line('b', '1', '0.01', '0'), line('a', '1', '0.01', '0'), line('c', '1', '0.01', '0')],
      generalDiscountRate: decimal('33.333333'),
      freightAmount: decimal('0'),
    })

    expect(result.lines.map((item) => [item.lineId, money(item.allocatedGeneralDiscountAmount)])).toEqual([
      ['a', '0.01'], ['b', '0.00'], ['c', '0.00'],
    ])
  })

  it.each([
    ['excess quantity scale', () => line('bad', '1.0000001', '1', '0')],
    ['rate above 100', () => line('bad', '1', '1', '100.000001')],
  ])('rejects invalid monetary input: %s', (_label, createLine) => {
    const invalidLine = createLine()

    expect(() => calculateQuote({
      lines: [invalidLine],
      generalDiscountRate: decimal('0'),
      freightAmount: decimal('0'),
    })).toThrow(QuoteCalculationError)
  })
})
