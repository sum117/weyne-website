import Decimal from 'decimal.js'

export { Decimal }

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

/** Exact business quantity. Construction and scale validation happen at boundaries. */
export type Quantity = Decimal

/** Exact BRL monetary value. Native JavaScript numbers are not part of this API. */
export type Money = Decimal

/** Exact percentage in the inclusive 0..100 domain range. */
export type Percentage = Decimal

export type UnitPriceSource = 'price_list' | 'manual_override'

/**
 * Immutable evidence of the unit price selected when the quote line was priced.
 * The engine consumes this snapshot and never resolves live catalog data.
 */
export interface UnitPriceSnapshot {
  readonly productId: string
  readonly productPriceVersionId: string
  readonly priceListId: string
  readonly source: UnitPriceSource
  readonly amount: Money
}

/** A configured commercial tax rate; it does not imply fiscal-document logic. */
export interface ConfiguredTaxRate {
  readonly code: string
  readonly rate: Percentage
}

/** Inputs required to resolve product-override-before-industry-default precedence. */
export interface CommissionSettings {
  readonly productOverrideRate: Percentage | null
  readonly industryDefaultRate: Percentage | null
}

export interface QuoteLineCalculationInput {
  readonly lineId: string
  /** Canonical document order. Optional only for backwards-compatible callers. */
  readonly position?: number
  readonly quantity: Quantity
  readonly unitPrice: Readonly<UnitPriceSnapshot>
  readonly perItemDiscountRate: Percentage
  readonly ipiRate: Percentage
  readonly configuredTaxes: readonly Readonly<ConfiguredTaxRate>[]
  readonly commission: Readonly<CommissionSettings>
}

export interface QuoteCalculationInput {
  /** Phase 1 calculations are BRL-only. Optional only for backwards-compatible callers. */
  readonly currencyCode?: string
  readonly lines: readonly Readonly<QuoteLineCalculationInput>[]
  readonly generalDiscountRate: Percentage
  readonly freightAmount: Money
}

export interface AppliedTaxAmount {
  readonly code: string
  readonly rate: Percentage
  readonly basisAmount: Money
  readonly amount: Money
}

export interface AppliedIpiAmount {
  readonly rate: Percentage
  readonly basisAmount: Money
  readonly amount: Money
}

export type CommissionSource =
  | 'product_override'
  | 'industry_default'
  | 'none'

export interface AppliedCommissionAmount {
  readonly source: CommissionSource
  readonly rate: Percentage | null
  readonly basisAmount: Money
  readonly amount: Money | null
}

/** Auditable published amounts for one calculated quote line. */
export interface QuoteLineCalculationResult {
  readonly lineId: string
  readonly position?: number
  readonly quantity: Quantity
  /** Complete snapshot used by calculated results; optional for legacy serialized results. */
  readonly unitPrice?: Readonly<UnitPriceSnapshot>
  readonly unitPriceAmount: Money
  readonly grossAmount: Money
  readonly perItemDiscountRate: Percentage
  readonly perItemDiscountAmount: Money
  readonly netBeforeGeneralDiscountAmount: Money
  readonly allocatedGeneralDiscountAmount: Money
  readonly netAfterDiscountsAmount: Money
  readonly ipi: Readonly<AppliedIpiAmount>
  readonly configuredTaxes: readonly Readonly<AppliedTaxAmount>[]
  readonly taxAmount: Money
  readonly freightAmount: Money
  readonly lineTotalAmount: Money
  readonly commission: Readonly<AppliedCommissionAmount>
}

/** Auditable aggregates; every component remains visible instead of being folded away. */
export interface QuoteCalculationTotals {
  readonly grossItemsAmount: Money
  readonly perItemDiscountAmount: Money
  readonly netItemsAmount: Money
  readonly generalDiscountAmount: Money
  readonly netAfterDiscountsAmount: Money
  readonly ipiAmount: Money
  readonly configuredTaxAmount: Money
  readonly freightAmount: Money
  readonly grandTotalAmount: Money
  readonly commissionBasisAmount: Money
  readonly commissionAmount: Money
}

export interface QuoteCalculationResult {
  readonly lines: readonly Readonly<QuoteLineCalculationResult>[]
  readonly totals: Readonly<QuoteCalculationTotals>
}

export type QuoteCalculationErrorCode =
  | 'INVALID_DECIMAL'
  | 'CURRENCY_MISMATCH'
  | 'DUPLICATE_LINE_KEY'
  | 'CALCULATION_INVARIANT'

export class QuoteCalculationError extends Error {
  readonly code: QuoteCalculationErrorCode

  constructor(message: string, code: QuoteCalculationErrorCode = 'INVALID_DECIMAL') {
    super(message)
    this.name = 'QuoteCalculationError'
    this.code = code
  }
}

const ZERO = new Decimal(0)
const CENT = new Decimal('0.01')
const MAX_MONEY = new Decimal('99999999999999999.99')

export function calculateQuote(input: Readonly<QuoteCalculationInput>): QuoteCalculationResult {
  if (input.currencyCode !== undefined && input.currencyCode !== 'BRL') {
    throw new QuoteCalculationError('currencyCode must be BRL', 'CURRENCY_MISMATCH')
  }
  assertPercentage(input.generalDiscountRate, 'generalDiscountRate')
  assertDecimal(input.freightAmount, 'freightAmount', 6, true)

  const lineIds = new Set<string>()
  const positions = new Set<number>()
  const prepared = [...input.lines]
    .map((line) => {
      if (!line.lineId.trim() || lineIds.has(line.lineId)) {
        throw new QuoteCalculationError(
          `lineId must be non-empty and unique: ${line.lineId}`,
          lineIds.has(line.lineId) ? 'DUPLICATE_LINE_KEY' : 'INVALID_DECIMAL',
        )
      }
      lineIds.add(line.lineId)
      if (line.position !== undefined) {
        if (!Number.isSafeInteger(line.position) || line.position <= 0) {
          throw new QuoteCalculationError(`${line.lineId}.position must be a positive integer`)
        }
        if (positions.has(line.position)) {
          throw new QuoteCalculationError(
            `position must be unique: ${line.position}`,
            'DUPLICATE_LINE_KEY',
          )
        }
        positions.add(line.position)
      }
      const unitPriceCurrencyCode = (
        line.unitPrice as Readonly<UnitPriceSnapshot> & { readonly currencyCode?: string }
      ).currencyCode
      if (unitPriceCurrencyCode !== undefined && unitPriceCurrencyCode !== 'BRL') {
        throw new QuoteCalculationError(
          `${line.lineId}.unitPrice.currencyCode must be BRL`,
          'CURRENCY_MISMATCH',
        )
      }
      assertDecimal(line.quantity, `${line.lineId}.quantity`, 6, false)
      assertDecimal(line.unitPrice.amount, `${line.lineId}.unitPrice.amount`, 6, true)
      assertPercentage(line.perItemDiscountRate, `${line.lineId}.perItemDiscountRate`)
      assertPercentage(line.ipiRate, `${line.lineId}.ipiRate`)
      line.configuredTaxes.forEach((tax) =>
        assertPercentage(tax.rate, `${line.lineId}.configuredTaxes.${tax.code}`),
      )
      if (line.commission.productOverrideRate !== null) {
        assertPercentage(line.commission.productOverrideRate, `${line.lineId}.commission.productOverrideRate`)
      }
      if (line.commission.industryDefaultRate !== null) {
        assertPercentage(line.commission.industryDefaultRate, `${line.lineId}.commission.industryDefaultRate`)
      }

      const grossAmount = money(line.quantity.times(line.unitPrice.amount))
      const perItemDiscountAmount = percentageOf(grossAmount, line.perItemDiscountRate)
      return {
        line,
        grossAmount,
        perItemDiscountAmount,
        netBeforeGeneralDiscountAmount: grossAmount.minus(perItemDiscountAmount),
      }
    })
    .sort((left, right) => compareLines(left.line, right.line))

  const grossItemsAmount = moneySum(
    prepared.map((item) => item.grossAmount),
    'grossItemsAmount',
  )
  const perItemDiscountAmount = moneySum(
    prepared.map((item) => item.perItemDiscountAmount),
    'perItemDiscountAmount',
  )
  const netItemsAmount = publishedMoney(
    grossItemsAmount.minus(perItemDiscountAmount),
    'netItemsAmount',
  )
  const generalDiscountAmount = percentageOf(netItemsAmount, input.generalDiscountRate)
  const allocations = allocateDiscount(
    generalDiscountAmount,
    prepared.map((item) => item.netBeforeGeneralDiscountAmount),
  )

  const lines = prepared.map((item, index): QuoteLineCalculationResult => {
    const allocatedGeneralDiscountAmount = allocations[index] ?? ZERO
    const netAfterDiscountsAmount = publishedMoney(
      item.netBeforeGeneralDiscountAmount.minus(allocatedGeneralDiscountAmount),
      `${item.line.lineId}.netAfterDiscountsAmount`,
    )
    const ipiAmount = percentageOf(netAfterDiscountsAmount, item.line.ipiRate)
    const configuredTaxes = item.line.configuredTaxes.map((tax) => ({
      code: tax.code,
      rate: tax.rate,
      basisAmount: netAfterDiscountsAmount,
      amount: percentageOf(netAfterDiscountsAmount, tax.rate),
    }))
    const configuredTaxAmount = moneySum(
      configuredTaxes.map((tax) => tax.amount),
      `${item.line.lineId}.configuredTaxAmount`,
    )
    const commissionRate =
      item.line.commission.productOverrideRate ?? item.line.commission.industryDefaultRate
    const commissionSource: CommissionSource =
      item.line.commission.productOverrideRate !== null
        ? 'product_override'
        : item.line.commission.industryDefaultRate !== null
          ? 'industry_default'
          : 'none'

    return {
      lineId: item.line.lineId,
      ...(item.line.position === undefined ? {} : { position: item.line.position }),
      quantity: item.line.quantity,
      unitPrice: item.line.unitPrice,
      unitPriceAmount: item.line.unitPrice.amount,
      grossAmount: item.grossAmount,
      perItemDiscountRate: item.line.perItemDiscountRate,
      perItemDiscountAmount: item.perItemDiscountAmount,
      netBeforeGeneralDiscountAmount: item.netBeforeGeneralDiscountAmount,
      allocatedGeneralDiscountAmount,
      netAfterDiscountsAmount,
      ipi: {
        rate: item.line.ipiRate,
        basisAmount: netAfterDiscountsAmount,
        amount: ipiAmount,
      },
      configuredTaxes,
      taxAmount: publishedMoney(
        ipiAmount.plus(configuredTaxAmount),
        `${item.line.lineId}.taxAmount`,
      ),
      freightAmount: ZERO,
      lineTotalAmount: netAfterDiscountsAmount,
      commission: {
        source: commissionSource,
        rate: commissionRate,
        basisAmount: netAfterDiscountsAmount,
        amount:
          commissionRate === null
            ? null
            : percentageOf(netAfterDiscountsAmount, commissionRate),
      },
    }
  })

  const freightAmount = money(input.freightAmount)
  const netAfterDiscountsAmount = publishedMoney(
    netItemsAmount.minus(generalDiscountAmount),
    'netAfterDiscountsAmount',
  )

  return {
    lines,
    totals: {
      grossItemsAmount,
      perItemDiscountAmount,
      netItemsAmount,
      generalDiscountAmount,
      netAfterDiscountsAmount,
      ipiAmount: moneySum(lines.map((line) => line.ipi.amount), 'ipiAmount'),
      configuredTaxAmount: moneySum(
        lines.flatMap((line) => line.configuredTaxes.map((tax) => tax.amount)),
        'configuredTaxAmount',
      ),
      freightAmount,
      grandTotalAmount: publishedMoney(
        netAfterDiscountsAmount.plus(freightAmount),
        'grandTotalAmount',
      ),
      commissionBasisAmount: moneySum(
        lines.map((line) => line.commission.basisAmount),
        'commissionBasisAmount',
      ),
      commissionAmount: moneySum(
        lines.map((line) => line.commission.amount ?? ZERO),
        'commissionAmount',
      ),
    },
  }
}

function money(value: Decimal): Decimal {
  const rounded = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  return publishedMoney(rounded, 'calculated money')
}

function publishedMoney(value: Decimal, field: string): Decimal {
  if (
    !value.isFinite() ||
    value.isNegative() ||
    value.decimalPlaces() > 2 ||
    value.greaterThan(MAX_MONEY)
  ) {
    throw new QuoteCalculationError(`${field} exceeds DECIMAL(19,2)`)
  }
  return value
}

function moneySum(values: readonly Decimal[], field: string): Decimal {
  return publishedMoney(sum(values), field)
}

function compareLines(
  left: Readonly<QuoteLineCalculationInput>,
  right: Readonly<QuoteLineCalculationInput>,
): number {
  if (left.position !== undefined && right.position !== undefined) {
    const positionOrder = left.position - right.position
    if (positionOrder !== 0) return positionOrder
  } else if (left.position !== undefined) {
    return -1
  } else if (right.position !== undefined) {
    return 1
  }
  return left.lineId.localeCompare(right.lineId)
}

function percentageOf(basis: Decimal, rate: Decimal): Decimal {
  return money(basis.times(rate).dividedBy(100))
}

function sum(values: readonly Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), ZERO)
}

function allocateDiscount(total: Decimal, bases: readonly Decimal[]): Decimal[] {
  const basisTotal = sum(bases)
  if (total.isZero() || basisTotal.isZero()) return bases.map(() => ZERO)

  const candidates = bases.map((basis, index) => {
    const ideal = total.times(basis).dividedBy(basisTotal)
    const floor = ideal.toDecimalPlaces(2, Decimal.ROUND_DOWN)
    return { index, floor, remainder: ideal.minus(floor) }
  })
  const allocations = candidates.map((candidate) => candidate.floor)
  let remainingCents = total.minus(sum(allocations)).dividedBy(CENT)
  const ranked = [...candidates].sort(
    (left, right) => right.remainder.comparedTo(left.remainder) || left.index - right.index,
  )
  for (let offset = 0; remainingCents.greaterThan(0); offset += 1) {
    const candidate = ranked[offset % ranked.length]
    if (candidate) allocations[candidate.index] = allocations[candidate.index]!.plus(CENT)
    remainingCents = remainingCents.minus(1)
  }
  return allocations
}

function assertPercentage(value: Decimal, field: string): void {
  assertDecimal(value, field, 6, true)
  if (value.greaterThan(100)) {
    throw new QuoteCalculationError(`${field} must be between 0 and 100`)
  }
}

function assertDecimal(value: Decimal, field: string, scale: number, allowZero: boolean): void {
  if (!(value instanceof Decimal) || !value.isFinite() || value.isNegative()) {
    throw new QuoteCalculationError(`${field} must be a finite non-negative Decimal`)
  }
  if ((!allowZero && value.isZero()) || value.decimalPlaces() > scale) {
    throw new QuoteCalculationError(`${field} has an invalid value or scale`)
  }
}
