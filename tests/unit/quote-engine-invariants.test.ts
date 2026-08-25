import { describe, expect, it } from 'vitest'
import {
  calculateQuote,
  Decimal,
  type QuoteCalculationInput,
  type QuoteCalculationResult,
  type QuoteLineCalculationInput,
} from '@/domain/quote-engine'

const decimal = (value: string) => new Decimal(value)
const zero = () => decimal('0')

function sum(values: readonly Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), zero())
}

function expectExact(actual: Decimal, expected: Decimal): void {
  expect(actual.equals(expected)).toBe(true)
  expect(actual.decimalPlaces()).toBeLessThanOrEqual(2)
}

type LineOptions = {
  readonly position: number
  readonly quantity: string
  readonly unitPrice: string
  readonly lineDiscountRate?: string
  readonly ipiRate?: string
  readonly taxes?: readonly { readonly code: string; readonly rate: string }[]
  readonly productCommissionRate?: string | null
  readonly industryCommissionRate?: string | null
}

function makeLine(lineId: string, options: LineOptions): QuoteLineCalculationInput {
  return {
    lineId,
    position: options.position,
    quantity: decimal(options.quantity),
    unitPrice: {
      productId: `product-${lineId}`,
      productPriceVersionId: `price-version-${lineId}`,
      priceListId: `price-list-${lineId}`,
      source: 'price_list',
      amount: decimal(options.unitPrice),
    },
    perItemDiscountRate: decimal(options.lineDiscountRate ?? '0'),
    ipiRate: decimal(options.ipiRate ?? '0'),
    configuredTaxes: (options.taxes ?? []).map((tax) => ({
      code: tax.code,
      rate: decimal(tax.rate),
    })),
    commission: {
      productOverrideRate:
        options.productCommissionRate === undefined || options.productCommissionRate === null
          ? null
          : decimal(options.productCommissionRate),
      industryDefaultRate:
        options.industryCommissionRate === undefined || options.industryCommissionRate === null
          ? null
          : decimal(options.industryCommissionRate),
    },
  }
}

function assertExactReconciliation(result: QuoteCalculationResult): void {
  const { lines, totals } = result

  for (const line of lines) {
    expectExact(
      line.netBeforeGeneralDiscountAmount,
      line.grossAmount.minus(line.perItemDiscountAmount),
    )
    expectExact(
      line.netAfterDiscountsAmount,
      line.netBeforeGeneralDiscountAmount.minus(line.allocatedGeneralDiscountAmount),
    )
    expectExact(line.ipi.basisAmount, line.netAfterDiscountsAmount)
    for (const tax of line.configuredTaxes) {
      expectExact(tax.basisAmount, line.netAfterDiscountsAmount)
    }
    expectExact(
      line.taxAmount,
      line.ipi.amount.plus(sum(line.configuredTaxes.map((tax) => tax.amount))),
    )
    expectExact(line.freightAmount, zero())
    expectExact(line.lineTotalAmount, line.netAfterDiscountsAmount)
    expectExact(line.commission.basisAmount, line.netAfterDiscountsAmount)

    if (line.commission.rate === null) {
      expect(line.commission.amount).toBeNull()
    } else {
      expect(line.commission.amount).not.toBeNull()
      expectExact(
        line.commission.amount!,
        line.commission.basisAmount
          .times(line.commission.rate)
          .dividedBy(100)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
      )
    }
  }

  expectExact(totals.grossItemsAmount, sum(lines.map((line) => line.grossAmount)))
  expectExact(
    totals.perItemDiscountAmount,
    sum(lines.map((line) => line.perItemDiscountAmount)),
  )
  expectExact(
    totals.netItemsAmount,
    sum(lines.map((line) => line.netBeforeGeneralDiscountAmount)),
  )
  expectExact(
    totals.generalDiscountAmount,
    sum(lines.map((line) => line.allocatedGeneralDiscountAmount)),
  )
  expectExact(
    totals.netAfterDiscountsAmount,
    sum(lines.map((line) => line.netAfterDiscountsAmount)),
  )
  expectExact(totals.ipiAmount, sum(lines.map((line) => line.ipi.amount)))
  expectExact(
    totals.configuredTaxAmount,
    sum(lines.flatMap((line) => line.configuredTaxes.map((tax) => tax.amount))),
  )
  expectExact(
    sum(lines.map((line) => line.taxAmount)),
    totals.ipiAmount.plus(totals.configuredTaxAmount),
  )
  expectExact(
    totals.grandTotalAmount,
    sum(lines.map((line) => line.lineTotalAmount)).plus(totals.freightAmount),
  )
  expectExact(
    totals.commissionBasisAmount,
    sum(lines.map((line) => line.commission.basisAmount)),
  )
  expectExact(
    totals.commissionAmount,
    sum(lines.map((line) => line.commission.amount ?? zero())),
  )
}

const adversarialLines = [
  makeLine('fractional', {
    position: 3,
    quantity: '0.333333',
    unitPrice: '10.0050',
    lineDiscountRate: '7.125001',
    ipiRate: '5.125',
    taxes: [
      { code: 'icms', rate: '18' },
      { code: 'pis', rate: '1.65' },
    ],
    productCommissionRate: '4.125',
    industryCommissionRate: '9',
  }),
  makeLine('four-decimal', {
    position: 1,
    quantity: '2.500001',
    unitPrice: '19.9999',
    lineDiscountRate: '0.000001',
    ipiRate: '0',
    taxes: [{ code: 'cofins', rate: '7.6' }],
    industryCommissionRate: '3.333333',
  }),
  makeLine('tiny-a', {
    position: 4,
    quantity: '1',
    unitPrice: '0.01',
  }),
  makeLine('tiny-b', {
    position: 2,
    quantity: '1',
    unitPrice: '0.02',
    productCommissionRate: '0',
    industryCommissionRate: '5',
  }),
] as const

function adversarialInput(lines: readonly QuoteLineCalculationInput[]): QuoteCalculationInput {
  return {
    currencyCode: 'BRL',
    lines,
    generalDiscountRate: decimal('17.333333'),
    freightAmount: decimal('9.995'),
  }
}

function serialize(result: QuoteCalculationResult): string {
  return JSON.stringify(result, (_key, value) =>
    value instanceof Decimal ? value.toFixed(value.decimalPlaces() <= 2 ? 2 : value.decimalPlaces()) : value,
  )
}

describe('quote engine exact invariants', () => {
  it.each([
    {
      name: 'adversarial fractional, four-decimal, tiny-remainder quote',
      input: adversarialInput(adversarialLines),
    },
    {
      name: 'zero-line quote with freight only',
      input: {
        currencyCode: 'BRL',
        lines: [],
        generalDiscountRate: decimal('100'),
        freightAmount: decimal('0.005'),
      } satisfies QuoteCalculationInput,
    },
  ])('reconciles every disclosed aggregate exactly for $name', ({ input }) => {
    assertExactReconciliation(calculateQuote(input))
  })

  it('allocates tied cents by canonical position regardless of input order', () => {
    const tiedLines = [
      makeLine('position-3', { position: 3, quantity: '1', unitPrice: '0.01' }),
      makeLine('position-1', { position: 1, quantity: '1', unitPrice: '0.01' }),
      makeLine('position-2', { position: 2, quantity: '1', unitPrice: '0.01' }),
    ]
    const orders = [tiedLines, [...tiedLines].reverse(), [tiedLines[1]!, tiedLines[2]!, tiedLines[0]!]]

    const allocations = orders.map((lines) => {
      const result = calculateQuote({
        currencyCode: 'BRL',
        lines,
        generalDiscountRate: decimal('66.666667'),
        freightAmount: zero(),
      })
      assertExactReconciliation(result)
      return result.lines.map((line) => [line.lineId, line.allocatedGeneralDiscountAmount.toFixed(2)])
    })

    expect(allocations).toEqual([
      [
        ['position-1', '0.01'],
        ['position-2', '0.01'],
        ['position-3', '0.00'],
      ],
      [
        ['position-1', '0.01'],
        ['position-2', '0.01'],
        ['position-3', '0.00'],
      ],
      [
        ['position-1', '0.01'],
        ['position-2', '0.01'],
        ['position-3', '0.00'],
      ],
    ])
  })

  it('returns byte-identical Decimal disclosures across reordered and repeated runs', () => {
    const permutations = [
      adversarialLines,
      [...adversarialLines].reverse(),
      [adversarialLines[2], adversarialLines[0], adversarialLines[3], adversarialLines[1]],
    ]
    const outputs = Array.from({ length: 10 }, (_, run) =>
      serialize(calculateQuote(adversarialInput(permutations[run % permutations.length]!))),
    )

    expect(new Set(outputs)).toEqual(new Set([outputs[0]]))
  })
})
