import Decimal from 'decimal.js'
import {
  CommissionCalculationError,
  calculateCommission,
  type CommissionLineInput,
  type CommissionLineResult,
} from '@/domain/commission-calculator'

/**
 * Conversion-time commission fact persistence.
 *
 * The pure calculator in `@/domain/commission-calculator` is the single
 * source of commission arithmetic. This module adapts the order snapshot's
 * stored line facts into calculator inputs, invokes the calculator, and
 * cross-checks its output against the amounts already approved on the quote.
 * The persisted row is a frozen provenance record: source selection, rate,
 * basis, and value are snapshotted so later edits to product overrides or
 * industry defaults can never recalculate a converted order.
 */

export type OrderCommissionFactsErrorCode = 'SNAPSHOT_INTEGRITY_ERROR'

export class OrderCommissionFactsError extends Error {
  readonly code: OrderCommissionFactsErrorCode

  constructor(message: string) {
    super(message)
    this.name = 'OrderCommissionFactsError'
    this.code = 'SNAPSHOT_INTEGRITY_ERROR'
  }
}

const CalculationDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
})

/** Exact fixed-point representation used across the order snapshot (6 dp). */
function toSnapshotDecimal(value: string, field: string): Decimal {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) {
    throw new OrderCommissionFactsError(
      `${field} is not a valid non-negative 6-decimal amount: ${value}`,
    )
  }
  return new CalculationDecimal(value)
}

/** DECIMAL(19,2) column representation with exact HALF_UP rounding. */
function toMoneyString(value: Decimal): string {
  return value.toDecimalPlaces(2, CalculationDecimal.ROUND_HALF_UP).toFixed(2)
}

/** DECIMAL(9,6) column representation for rates. */
function toRateString(value: Decimal): string {
  return value.toDecimalPlaces(6, CalculationDecimal.ROUND_HALF_UP).toFixed(6)
}

export interface PersistedCommissionLineFacts {
  readonly industryId: string
  readonly source: 'product_override' | 'industry_default' | 'none'
  /** Selected rate snapshot in the DECIMAL(9,6) column format. */
  readonly rate: string | null
  /** Explicit calculation basis in the DECIMAL(19,2) column format. */
  readonly basisAmount: string
  /** Calculated commission value in the DECIMAL(19,2) column format. */
  readonly amount: string
  /** Gross line amount snapshot backing the basis. */
  readonly grossAmount: string
  /** Per-line discount snapshot backing the basis. */
  readonly lineDiscountAmount: string
  /** Allocated overall-discount snapshot backing the basis. */
  readonly overallDiscountAmount: string
  /** Provenance of the selected rate at conversion time. */
  readonly provenance:
    | 'product_override_snapshot'
    | 'industry_default_snapshot'
    | 'no_rate_configured'
}

export interface PersistedOrderCommissionFacts {
  readonly lines: readonly Readonly<PersistedCommissionLineFacts>[]
  readonly totalBasisAmount: string
  readonly totalAmount: string
}

type CommissionSnapshotLine = Readonly<{
  sourceQuoteLineId: string
  lineNumber: number
  industryId: string
  grossAmount: string
  perItemDiscountAmount: string
  allocatedGeneralDiscountAmount: string
  commissionSource: 'product_override' | 'industry_default' | 'none'
  commissionRate: string | null
  commissionBasisAmount: string
  commissionAmount: string
}>

const ZERO_MONEY = '0.00'

/**
 * Computes the immutable commission facts for an approved order snapshot by
 * delegating every decision to the pure calculator and verifying the result
 * against the snapshot's own approved values.
 *
 * At conversion time no cancellation exists yet; cancelled lines keep their
 * projected commission for audit and only drop out of reportable totals.
 */
export function buildOrderCommissionFacts(
  lines: readonly Readonly<CommissionSnapshotLine>[],
): PersistedOrderCommissionFacts {
  if (lines.length === 0) {
    throw new OrderCommissionFactsError('order commission facts require at least one line')
  }

  const inputs = lines.map((line): CommissionLineInput => {
    const label = `${line.sourceQuoteLineId}`
    return Object.freeze({
      lineId: line.sourceQuoteLineId,
      industryIdSnapshot: line.industryId,
      grossAmountSnapshot: toSnapshotDecimal(line.grossAmount, `${label}.grossAmount`),
      lineDiscountAmountSnapshot: toSnapshotDecimal(
        line.perItemDiscountAmount,
        `${label}.perItemDiscountAmount`,
      ),
      overallDiscountAllocationSnapshot: toSnapshotDecimal(
        line.allocatedGeneralDiscountAmount,
        `${label}.allocatedGeneralDiscountAmount`,
      ),
      productOverrideRateSnapshot:
        line.commissionSource === 'product_override' && line.commissionRate !== null
          ? toSnapshotDecimal(line.commissionRate, `${label}.commissionRate`)
          : null,
      industryDefaultRateSnapshot:
        line.commissionSource === 'industry_default' && line.commissionRate !== null
          ? toSnapshotDecimal(line.commissionRate, `${label}.commissionRate`)
          : null,
      cancellation: Object.freeze({ status: 'active' } as const),
    })
  })

  let calculated
  try {
    calculated = calculateCommission(inputs)
  } catch (error) {
    if (error instanceof CommissionCalculationError) {
      throw new OrderCommissionFactsError(
        `stored quote failed commission verification: ${error.message}`,
      )
    }
    throw error
  }

  const facts = calculated.lines.map((result, index): PersistedCommissionLineFacts => {
    const line = lines[index]!
    verifyAgainstSnapshot(result, line)
    return Object.freeze({
      industryId: result.industryIdSnapshot,
      source: result.source,
      rate: result.rate === null ? null : toRateString(result.rate),
      basisAmount: toMoneyString(result.basisAmount),
      amount: result.projectedAmount === null
        ? ZERO_MONEY
        : toMoneyString(result.projectedAmount),
      grossAmount: toMoneyString(result.discounts.grossAmount),
      lineDiscountAmount: toMoneyString(result.discounts.lineDiscountAmount),
      overallDiscountAmount: toMoneyString(result.discounts.overallDiscountAmount),
      provenance:
        result.source === 'product_override'
          ? 'product_override_snapshot'
          : result.source === 'industry_default'
            ? 'industry_default_snapshot'
            : 'no_rate_configured',
    })
  })

  return Object.freeze({
    lines: facts,
    totalBasisAmount: toMoneyString(calculated.totalBasisAmount),
    totalAmount: toMoneyString(calculated.totalReportableAmount),
  })
}

/**
 * The persisted facts must agree with the values the quote approval already
 * published. Any drift means the stored snapshot was mutated or produced by
 * different arithmetic, which blocks conversion rather than silently
 * persisting inconsistent numbers.
 */
function verifyAgainstSnapshot(
  result: Readonly<CommissionLineResult>,
  line: Readonly<CommissionSnapshotLine>,
): void {
  const label = `line ${line.lineNumber} (${line.sourceQuoteLineId})`

  if (result.source !== line.commissionSource) {
    throw new OrderCommissionFactsError(
      `${label}: commission source resolved to ${result.source} but the snapshot recorded ${line.commissionSource}`,
    )
  }

  const snapshotBasis = toSnapshotDecimal(
    line.commissionBasisAmount,
    `${label}.commissionBasisAmount`,
  ).toDecimalPlaces(2, CalculationDecimal.ROUND_HALF_UP)
  if (!snapshotBasis.equals(result.basisAmount)) {
    throw new OrderCommissionFactsError(
      `${label}: commission basis recalculated as ${result.basisAmount.toFixed(2)} but the snapshot recorded ${line.commissionBasisAmount}`,
    )
  }

  if (result.rate === null) {
    if (line.commissionRate !== null) {
      throw new OrderCommissionFactsError(
        `${label}: no commission rate resolved but the snapshot recorded ${line.commissionRate}`,
      )
    }
    if (toSnapshotDecimal(line.commissionAmount, `${label}.commissionAmount`).isZero() === false) {
      throw new OrderCommissionFactsError(
        `${label}: commission amount must be zero when no rate applies, recorded ${line.commissionAmount}`,
      )
    }
    return
  }

  const snapshotRate = toSnapshotDecimal(
    line.commissionRate ?? '',
    `${label}.commissionRate`,
  )
  if (!snapshotRate.equals(result.rate)) {
    throw new OrderCommissionFactsError(
      `${label}: commission rate resolved to ${result.rate.toFixed(6)} but the snapshot recorded ${line.commissionRate}`,
    )
  }

  const projected = result.projectedAmount?.toDecimalPlaces(2, CalculationDecimal.ROUND_HALF_UP) ?? null
  const snapshotAmount = toSnapshotDecimal(
    line.commissionAmount,
    `${label}.commissionAmount`,
  ).toDecimalPlaces(2, CalculationDecimal.ROUND_HALF_UP)
  if (!projected || !projected.equals(snapshotAmount)) {
    throw new OrderCommissionFactsError(
      `${label}: commission amount recalculated as ${result.projectedAmount?.toFixed(2) ?? 'null'} but the snapshot recorded ${line.commissionAmount}`,
    )
  }
}
