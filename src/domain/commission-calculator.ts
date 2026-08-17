import Decimal from 'decimal.js'

const CalculationDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
})
const MAX_MONEY = new CalculationDecimal('99999999999999999.99')

export type CommissionSource =
  | 'product_override'
  | 'industry_default'
  | 'none'

export type CommissionBasis = 'net_merchandise_after_discounts'

export type CommissionCancellationSnapshot =
  | Readonly<{ status: 'active' }>
  | Readonly<{
      status: 'cancelled'
      cancelledAt: string
      reason: string
    }>

export interface CommissionLineInput {
  readonly lineId: string
  readonly industryIdSnapshot: string
  readonly grossAmountSnapshot: Decimal
  readonly lineDiscountAmountSnapshot: Decimal
  readonly overallDiscountAllocationSnapshot: Decimal
  readonly productOverrideRateSnapshot: Decimal | null
  readonly industryDefaultRateSnapshot: Decimal | null
  readonly cancellation: CommissionCancellationSnapshot
}

export interface CommissionLineResult {
  readonly lineId: string
  readonly industryIdSnapshot: string
  readonly source: CommissionSource
  readonly rate: Decimal | null
  readonly basis: CommissionBasis
  readonly discounts: Readonly<{
    readonly grossAmount: Decimal
    readonly lineDiscountAmount: Decimal
    readonly overallDiscountAmount: Decimal
  }>
  readonly basisAmount: Decimal
  readonly projectedAmount: Decimal | null
  readonly cancellationEffect: 'none' | 'exclude_from_reporting'
  readonly reportingDisposition: 'included' | 'excluded_cancelled'
  readonly reportableAmount: Decimal
  readonly cancellation: CommissionCancellationSnapshot
}

export interface CommissionCalculationResult {
  readonly lines: readonly Readonly<CommissionLineResult>[]
  readonly totalBasisAmount: Decimal
  readonly totalProjectedAmount: Decimal
  readonly totalReportableAmount: Decimal
}

export type CommissionCalculationErrorCode =
  | 'INVALID_DECIMAL'
  | 'INVALID_LINE'
  | 'DUPLICATE_LINE_ID'
  | 'INVALID_CANCELLATION'

export class CommissionCalculationError extends Error {
  readonly code: CommissionCalculationErrorCode

  constructor(code: CommissionCalculationErrorCode, message: string) {
    super(message)
    this.name = 'CommissionCalculationError'
    this.code = code
  }
}

function assertDecimal(
  value: Decimal,
  field: string,
  maximumDecimalPlaces: number,
): void {
  if (
    !Decimal.isDecimal(value) ||
    !value.isFinite() ||
    value.isNegative() ||
    value.decimalPlaces() > maximumDecimalPlaces
  ) {
    throw new CommissionCalculationError(
      'INVALID_DECIMAL',
      `${field} must be a non-negative Decimal with at most ${maximumDecimalPlaces} decimal places`,
    )
  }
  if (
    maximumDecimalPlaces === 2 &&
    new CalculationDecimal(value).greaterThan(MAX_MONEY)
  ) {
    throw new CommissionCalculationError(
      'INVALID_DECIMAL',
      `${field} exceeds the DECIMAL(19,2) persistence range`,
    )
  }
}

function assertRate(value: Decimal | null, field: string): void {
  if (value === null) return
  assertDecimal(value, field, 6)
  if (new CalculationDecimal(value).greaterThan(100)) {
    throw new CommissionCalculationError(
      'INVALID_DECIMAL',
      `${field} must be between 0 and 100`,
    )
  }
}

function validateLine(line: Readonly<CommissionLineInput>): void {
  if (line.lineId.trim() === '' || line.industryIdSnapshot.trim() === '') {
    throw new CommissionCalculationError(
      'INVALID_LINE',
      'lineId and industryIdSnapshot must not be empty',
    )
  }
  assertDecimal(line.grossAmountSnapshot, 'grossAmountSnapshot', 2)
  assertDecimal(line.lineDiscountAmountSnapshot, 'lineDiscountAmountSnapshot', 2)
  assertDecimal(
    line.overallDiscountAllocationSnapshot,
    'overallDiscountAllocationSnapshot',
    2,
  )
  assertRate(line.productOverrideRateSnapshot, 'productOverrideRateSnapshot')
  assertRate(line.industryDefaultRateSnapshot, 'industryDefaultRateSnapshot')

  const discounts = new CalculationDecimal(line.lineDiscountAmountSnapshot).plus(
    line.overallDiscountAllocationSnapshot,
  )
  if (discounts.greaterThan(new CalculationDecimal(line.grossAmountSnapshot))) {
    throw new CommissionCalculationError(
      'INVALID_LINE',
      'discount snapshots cannot exceed the gross amount snapshot',
    )
  }
  if (
    line.cancellation.status === 'cancelled' &&
    (line.cancellation.cancelledAt.trim() === '' ||
      line.cancellation.reason.trim() === '')
  ) {
    throw new CommissionCalculationError(
      'INVALID_CANCELLATION',
      'cancelled lines require cancelledAt and reason snapshots',
    )
  }
}

const money = (value: Decimal.Value) => {
  const rounded = new CalculationDecimal(value).toDecimalPlaces(
    2,
    CalculationDecimal.ROUND_HALF_UP,
  )
  if (rounded.isNegative() || rounded.greaterThan(MAX_MONEY)) {
    throw new CommissionCalculationError(
      'INVALID_DECIMAL',
      'calculated money is outside the DECIMAL(19,2) persistence range',
    )
  }
  return rounded
}

export function calculateCommissionLines(
  lines: readonly Readonly<CommissionLineInput>[],
): readonly Readonly<CommissionLineResult>[] {
  const lineIds = new Set<string>()
  for (const line of lines) {
    validateLine(line)
    if (lineIds.has(line.lineId)) {
      throw new CommissionCalculationError(
        'DUPLICATE_LINE_ID',
        `duplicate commission line id: ${line.lineId}`,
      )
    }
    lineIds.add(line.lineId)
  }

  return Object.freeze(lines.map((line) => {
    const source = line.productOverrideRateSnapshot !== null
      ? 'product_override'
      : line.industryDefaultRateSnapshot !== null
        ? 'industry_default'
        : 'none'
    const selectedRate =
      line.productOverrideRateSnapshot ?? line.industryDefaultRateSnapshot
    const rate = selectedRate === null ? null : new CalculationDecimal(selectedRate)
    const grossAmount = money(line.grossAmountSnapshot)
    const lineDiscountAmount = money(line.lineDiscountAmountSnapshot)
    const overallDiscountAmount = money(
      line.overallDiscountAllocationSnapshot,
    )
    const basisAmount = money(
      grossAmount.minus(lineDiscountAmount).minus(overallDiscountAmount),
    )
    const projectedAmount = rate
      ? money(basisAmount.times(rate).dividedBy(100))
      : null
    const reportingDisposition =
      line.cancellation.status === 'cancelled'
        ? 'excluded_cancelled'
        : 'included'
    const cancellation = Object.freeze(
      line.cancellation.status === 'cancelled'
        ? {
            status: line.cancellation.status,
            cancelledAt: line.cancellation.cancelledAt,
            reason: line.cancellation.reason,
          }
        : { status: line.cancellation.status },
    )

    return Object.freeze({
      lineId: line.lineId,
      industryIdSnapshot: line.industryIdSnapshot,
      source,
      rate,
      basis: 'net_merchandise_after_discounts' as const,
      discounts: Object.freeze({
        grossAmount,
        lineDiscountAmount,
        overallDiscountAmount,
      }),
      basisAmount,
      projectedAmount,
      cancellationEffect:
        reportingDisposition === 'excluded_cancelled'
          ? 'exclude_from_reporting'
          : 'none',
      reportingDisposition,
      reportableAmount:
        reportingDisposition === 'included' && projectedAmount
          ? projectedAmount
          : money(0),
      cancellation,
    })
  }))
}

export function calculateCommission(
  lines: readonly Readonly<CommissionLineInput>[],
): Readonly<CommissionCalculationResult> {
  const calculatedLines = Object.freeze(calculateCommissionLines(lines))
  const sum = (values: readonly Decimal[]) =>
    money(
      values.reduce(
        (total, value) => total.plus(value),
        new CalculationDecimal(0),
      ),
    )

  return Object.freeze({
    lines: calculatedLines,
    totalBasisAmount: sum(calculatedLines.map((line) => line.basisAmount)),
    totalProjectedAmount: sum(
      calculatedLines.map((line) => line.projectedAmount ?? money(0)),
    ),
    totalReportableAmount: sum(
      calculatedLines.map((line) => line.reportableAmount),
    ),
  })
}
