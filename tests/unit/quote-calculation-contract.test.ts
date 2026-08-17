import { describe, expect, it } from 'vitest'
import {
  calculateQuote,
  Decimal,
  QuoteCalculationError,
  type QuoteCalculationInput,
  type QuoteLineCalculationInput,
  type QuoteLineCalculationResult,
  type UnitPriceSnapshot,
} from '@/domain/quote-engine'

const decimal = (value: string) => new Decimal(value)

interface ContractUnitPriceSnapshot extends UnitPriceSnapshot {
  readonly productArchived?: boolean
  readonly priceListArchived?: boolean
}

interface ContractLineInput extends QuoteLineCalculationInput {
  readonly position: number
  readonly unitPrice: Readonly<ContractUnitPriceSnapshot>
}

interface ContractInput extends QuoteCalculationInput {
  readonly currencyCode: string
  readonly lines: readonly Readonly<ContractLineInput>[]
}

interface ContractLineResult extends QuoteLineCalculationResult {
  readonly position: number
  readonly unitPrice: Readonly<ContractUnitPriceSnapshot>
  readonly commission: QuoteLineCalculationResult['commission'] & {
    readonly amount: Decimal | null
  }
}

type LineOptions = {
  readonly position?: number
  readonly quantity?: string
  readonly unitPrice?: string
  readonly lineDiscountRate?: string
  readonly ipiRate?: string
  readonly configuredTaxes?: readonly { readonly code: string; readonly rate: string }[]
  readonly productOverrideRate?: string | null
  readonly industryDefaultRate?: string | null
  readonly productArchived?: boolean
  readonly priceListArchived?: boolean
}

function makeLine(lineId: string, options: LineOptions = {}): ContractLineInput {
  return {
    lineId,
    position: options.position ?? 1,
    quantity: decimal(options.quantity ?? '1'),
    unitPrice: {
      productId: `product-${lineId}`,
      productPriceVersionId: `price-${lineId}`,
      priceListId: `price-list-${lineId}`,
      source: 'price_list',
      amount: decimal(options.unitPrice ?? '100'),
      ...(options.productArchived === undefined
        ? {}
        : { productArchived: options.productArchived }),
      ...(options.priceListArchived === undefined
        ? {}
        : { priceListArchived: options.priceListArchived }),
    },
    perItemDiscountRate: decimal(options.lineDiscountRate ?? '0'),
    ipiRate: decimal(options.ipiRate ?? '0'),
    configuredTaxes: (options.configuredTaxes ?? []).map((tax) => ({
      code: tax.code,
      rate: decimal(tax.rate),
    })),
    commission: {
      productOverrideRate:
        options.productOverrideRate === undefined || options.productOverrideRate === null
          ? null
          : decimal(options.productOverrideRate),
      industryDefaultRate:
        options.industryDefaultRate === undefined || options.industryDefaultRate === null
          ? null
          : decimal(options.industryDefaultRate),
    },
  }
}

function makeInput(
  lines: readonly ContractLineInput[],
  options: {
    readonly currencyCode?: string
    readonly generalDiscountRate?: string
    readonly freightAmount?: string
  } = {},
): ContractInput {
  return {
    currencyCode: options.currencyCode ?? 'BRL',
    lines,
    generalDiscountRate: decimal(options.generalDiscountRate ?? '0'),
    freightAmount: decimal(options.freightAmount ?? '0'),
  }
}

function expectMoney(actual: Decimal, expected: string): void {
  expect(actual).toBeInstanceOf(Decimal)
  expect(actual.toFixed(2)).toBe(expected)
}

function contractLines(input: ContractInput): readonly ContractLineResult[] {
  return calculateQuote(input).lines as readonly ContractLineResult[]
}

describe('quote calculation decision table', () => {
  it('publishes an empty draft quote with freight and exact zero audit totals', () => {
    const result = calculateQuote(makeInput([], { freightAmount: '12.345' }))

    expect(result.lines).toEqual([])
    expectMoney(result.totals.grossItemsAmount, '0.00')
    expectMoney(result.totals.perItemDiscountAmount, '0.00')
    expectMoney(result.totals.netItemsAmount, '0.00')
    expectMoney(result.totals.generalDiscountAmount, '0.00')
    expectMoney(result.totals.netAfterDiscountsAmount, '0.00')
    expectMoney(result.totals.ipiAmount, '0.00')
    expectMoney(result.totals.configuredTaxAmount, '0.00')
    expectMoney(result.totals.freightAmount, '12.35')
    expectMoney(result.totals.grandTotalAmount, '12.35')
    expectMoney(result.totals.commissionBasisAmount, '0.00')
    expectMoney(result.totals.commissionAmount, '0.00')
  })

  it.each([
    {
      name: 'fractional quantity and four-decimal price round below half-cent',
      quantity: '0.500000',
      unitPrice: '10.0050',
      gross: '5.00',
    },
    {
      name: 'four-decimal price rounds an exact half-cent with ROUND_HALF_UP',
      quantity: '3',
      unitPrice: '10.0050',
      gross: '30.02',
    },
  ])('$name', ({ quantity, unitPrice, gross }) => {
    const [line] = contractLines(
      makeInput([makeLine('rounding', { quantity, unitPrice })]),
    )

    expectMoney(line!.grossAmount, gross)
    expect(line!.quantity.toString()).toBe(decimal(quantity).toString())
    expect(line!.unitPriceAmount.toString()).toBe(decimal(unitPrice).toString())
  })

  it.each([
    {
      name: 'zero discounts preserve gross merchandise',
      lineDiscountRate: '0',
      generalDiscountRate: '0',
      lineDiscount: '0.00',
      generalDiscount: '0.00',
      net: '30.02',
    },
    {
      name: 'a maximum line discount removes the entire line',
      lineDiscountRate: '100',
      generalDiscountRate: '0',
      lineDiscount: '30.02',
      generalDiscount: '0.00',
      net: '0.00',
    },
    {
      name: 'a maximum general discount is allocated in full',
      lineDiscountRate: '0',
      generalDiscountRate: '100',
      lineDiscount: '0.00',
      generalDiscount: '30.02',
      net: '0.00',
    },
  ])(
    '$name',
    ({ lineDiscountRate, generalDiscountRate, lineDiscount, generalDiscount, net }) => {
      const result = calculateQuote(
        makeInput(
          [makeLine('discount', { quantity: '3', unitPrice: '10.0050', lineDiscountRate })],
          { generalDiscountRate },
        ),
      )
      const [line] = result.lines

      expectMoney(line!.perItemDiscountAmount, lineDiscount)
      expectMoney(line!.allocatedGeneralDiscountAmount, generalDiscount)
      expectMoney(line!.netAfterDiscountsAmount, net)
      expectMoney(result.totals.generalDiscountAmount, generalDiscount)
      expectMoney(result.totals.netAfterDiscountsAmount, net)
      expectMoney(result.totals.grandTotalAmount, net)
    },
  )

  it('allocates tied remainder cents by position before line id and returns canonical order', () => {
    const result = calculateQuote(
      makeInput(
        [
          makeLine('a', { position: 2, unitPrice: '0.01' }),
          makeLine('z', { position: 1, unitPrice: '0.01' }),
          makeLine('m', { position: 3, unitPrice: '0.01' }),
        ],
        { generalDiscountRate: '33.333333' },
      ),
    )
    const lines = result.lines as readonly ContractLineResult[]

    expect(lines.map((line) => line.lineId)).toEqual(['z', 'a', 'm'])
    expect(lines.map((line) => line.position)).toEqual([1, 2, 3])
    expect(lines.map((line) => line.allocatedGeneralDiscountAmount.toFixed(2))).toEqual([
      '0.01',
      '0.00',
      '0.00',
    ])
    expectMoney(result.totals.generalDiscountAmount, '0.01')
    expectMoney(
      lines.reduce(
        (total, line) => total.plus(line.allocatedGeneralDiscountAmount),
        decimal('0'),
      ),
      '0.01',
    )
  })

  it('allocates non-tied rounding remainders without losing a cent', () => {
    const result = calculateQuote(
      makeInput(
        [
          makeLine('small', { position: 1, unitPrice: '0.01' }),
          makeLine('large', { position: 2, unitPrice: '0.02' }),
        ],
        { generalDiscountRate: '50' },
      ),
    )

    expect(result.lines.map((line) => line.allocatedGeneralDiscountAmount.toFixed(2))).toEqual([
      '0.01',
      '0.01',
    ])
    expectMoney(result.totals.generalDiscountAmount, '0.02')
    expectMoney(result.totals.netAfterDiscountsAmount, '0.01')
  })

  it('uses post-discount merchandise as every tax basis without adding taxes to grand total', () => {
    const result = calculateQuote(
      makeInput([
        makeLine('taxed', {
          ipiRate: '5.125',
          configuredTaxes: [
            { code: 'icms', rate: '18' },
            { code: 'pis', rate: '1.65' },
            { code: 'cofins', rate: '7.6' },
          ],
        }),
      ]),
    )
    const [line] = result.lines

    expectMoney(line!.ipi.basisAmount, '100.00')
    expectMoney(line!.ipi.amount, '5.13')
    expect(
      line!.configuredTaxes.map((tax) => ({
        code: tax.code,
        basis: tax.basisAmount.toFixed(2),
        amount: tax.amount.toFixed(2),
      })),
    ).toEqual([
      { code: 'icms', basis: '100.00', amount: '18.00' },
      { code: 'pis', basis: '100.00', amount: '1.65' },
      { code: 'cofins', basis: '100.00', amount: '7.60' },
    ])
    expectMoney(line!.taxAmount, '32.38')
    expectMoney(result.totals.ipiAmount, '5.13')
    expectMoney(result.totals.configuredTaxAmount, '27.25')
    expectMoney(result.totals.grandTotalAmount, '100.00')
  })

  it('omits absent tax codes but publishes a configured zero rate with its basis', () => {
    const result = calculateQuote(
      makeInput([
        makeLine('zero-tax', {
          configuredTaxes: [{ code: 'icms', rate: '0' }],
        }),
      ]),
    )
    const [line] = result.lines

    expect(line!.configuredTaxes).toHaveLength(1)
    expect(line!.configuredTaxes[0]!.code).toBe('icms')
    expect(line!.configuredTaxes[0]!.rate.toString()).toBe('0')
    expectMoney(line!.configuredTaxes[0]!.basisAmount, '100.00')
    expectMoney(line!.configuredTaxes[0]!.amount, '0.00')
    expect(line!.configuredTaxes.some((tax) => tax.code === 'pis')).toBe(false)
  })

  it('rounds freight once and excludes it from tax and commission bases', () => {
    const result = calculateQuote(
      makeInput(
        [
          makeLine('freight', {
            lineDiscountRate: '10',
            ipiRate: '5',
            productOverrideRate: '4',
          }),
        ],
        { freightAmount: '12.345' },
      ),
    )
    const [line] = result.lines

    expectMoney(line!.netAfterDiscountsAmount, '90.00')
    expectMoney(line!.ipi.basisAmount, '90.00')
    expectMoney(line!.commission.basisAmount, '90.00')
    expectMoney(result.totals.freightAmount, '12.35')
    expectMoney(result.totals.grandTotalAmount, '102.35')
  })

  it.each([
    {
      name: 'zero override wins over a positive default',
      override: '0',
      defaultRate: '5',
      source: 'product_override',
      rate: '0',
      value: '0.00',
    },
    {
      name: 'positive override wins over a different default',
      override: '4',
      defaultRate: '5',
      source: 'product_override',
      rate: '4',
      value: '4.00',
    },
    {
      name: 'industry default applies when override is absent',
      override: null,
      defaultRate: '5',
      source: 'industry_default',
      rate: '5',
      value: '5.00',
    },
  ])('$name', ({ override, defaultRate, source, rate, value }) => {
    const [line] = contractLines(
      makeInput([
        makeLine('commission', {
          productOverrideRate: override,
          industryDefaultRate: defaultRate,
        }),
      ]),
    )

    expect(line!.commission.source).toBe(source)
    expect(line!.commission.rate!.toString()).toBe(rate)
    expectMoney(line!.commission.amount!, value)
    expectMoney(line!.commission.basisAmount, '100.00')
  })

  it('keeps absent commission explicit while its document total remains zero', () => {
    const result = calculateQuote(makeInput([makeLine('no-commission')]))
    const [line] = result.lines as readonly ContractLineResult[]

    expect(line!.commission.source).toBe('none')
    expect(line!.commission.rate).toBeNull()
    expect(line!.commission.amount).toBeNull()
    expectMoney(line!.commission.basisAmount, '100.00')
    expectMoney(result.totals.commissionBasisAmount, '100.00')
    expectMoney(result.totals.commissionAmount, '0.00')
  })

  it('calculates archived snapshots unchanged and preserves the complete snapshot for audit', () => {
    const archivedLine = makeLine('archived', {
      unitPrice: '50.0000',
      productArchived: true,
      priceListArchived: true,
    })
    const [line] = contractLines(makeInput([archivedLine]))

    expectMoney(line!.grossAmount, '50.00')
    expect(line!.unitPrice).toEqual(archivedLine.unitPrice)
    expect(line!.unitPrice.productArchived).toBe(true)
    expect(line!.unitPrice.priceListArchived).toBe(true)
  })

  it('does not mutate input lines, order, decimals, tax arrays, or snapshots', () => {
    const first = makeLine('later', {
      position: 2,
      quantity: '0.500000',
      unitPrice: '10.0050',
      configuredTaxes: [{ code: 'icms', rate: '18' }],
    })
    const second = makeLine('earlier', { position: 1, unitPrice: '2.00' })
    const input = makeInput([first, second], { generalDiscountRate: '1' })
    const before = {
      ids: input.lines.map((line) => line.lineId),
      quantity: first.quantity.toString(),
      amount: first.unitPrice.amount.toString(),
      taxes: first.configuredTaxes.map((tax) => [tax.code, tax.rate.toString()]),
    }

    calculateQuote(input)

    expect(input.lines.map((line) => line.lineId)).toEqual(before.ids)
    expect(first.quantity.toString()).toBe(before.quantity)
    expect(first.unitPrice.amount.toString()).toBe(before.amount)
    expect(first.configuredTaxes.map((tax) => [tax.code, tax.rate.toString()])).toEqual(
      before.taxes,
    )
  })

  it.each([
    {
      name: 'quantity scale above six places',
      input: () => makeInput([makeLine('bad', { quantity: '1.0000001' })]),
      code: 'INVALID_DECIMAL',
    },
    {
      name: 'unit-price scale above six places',
      input: () => makeInput([makeLine('bad', { unitPrice: '1.0000001' })]),
      code: 'INVALID_DECIMAL',
    },
    {
      name: 'rate above one hundred',
      input: () => makeInput([makeLine('bad', { lineDiscountRate: '100.000001' })]),
      code: 'INVALID_DECIMAL',
    },
    {
      name: 'money overflow after multiplication',
      input: () =>
        makeInput([
          makeLine('overflow', {
            quantity: '999999999999.999999',
            unitPrice: '9999999999999.999999',
          }),
        ]),
      code: 'INVALID_DECIMAL',
    },
    {
      name: 'non-BRL document currency',
      input: () => makeInput([], { currencyCode: 'USD' }),
      code: 'CURRENCY_MISMATCH',
    },
    {
      name: 'duplicate line id',
      input: () =>
        makeInput([
          makeLine('duplicate', { position: 1 }),
          makeLine('duplicate', { position: 2 }),
        ]),
      code: 'DUPLICATE_LINE_KEY',
    },
    {
      name: 'duplicate position',
      input: () =>
        makeInput([
          makeLine('first', { position: 1 }),
          makeLine('second', { position: 1 }),
        ]),
      code: 'DUPLICATE_LINE_KEY',
    },
  ])('rejects $name without a partial result', ({ input, code }) => {
    let thrown: unknown

    try {
      calculateQuote(input())
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(QuoteCalculationError)
    expect(thrown).toMatchObject({ code })
  })
})
