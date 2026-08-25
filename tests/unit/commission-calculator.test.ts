import { readFileSync } from 'node:fs'
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  calculateCommission,
  calculateCommissionLines,
  type CommissionLineInput,
} from '@/domain/commission-calculator'

const decimal = (value: string) => new Decimal(value)

const line = (
  overrides: Partial<CommissionLineInput> = {},
): CommissionLineInput => ({
  lineId: 'line-1',
  industryIdSnapshot: 'industry-cleaning',
  grossAmountSnapshot: decimal('100.00'),
  lineDiscountAmountSnapshot: decimal('0.00'),
  overallDiscountAllocationSnapshot: decimal('0.00'),
  productOverrideRateSnapshot: null,
  industryDefaultRateSnapshot: decimal('5.000000'),
  cancellation: { status: 'active' },
  ...overrides,
})

describe('commission calculator', () => {
  it('uses a snapshotted product override before the industry default', () => {
    const [result] = calculateCommissionLines([
      line({
        productOverrideRateSnapshot: decimal('7.500000'),
        industryDefaultRateSnapshot: decimal('5.000000'),
      }),
    ])

    expect(result?.source).toBe('product_override')
    expect(result?.rate?.toFixed(6)).toBe('7.500000')
    expect(result?.basis).toBe('net_merchandise_after_discounts')
    expect(result?.basisAmount.toFixed(2)).toBe('100.00')
    expect(result?.projectedAmount?.toFixed(2)).toBe('7.50')
  })

  it('calculates mixed snapshotted industries independently', () => {
    const result = calculateCommission([
      line({
        lineId: 'line-industry-a',
        industryIdSnapshot: 'industry-a',
        grossAmountSnapshot: decimal('80.00'),
        industryDefaultRateSnapshot: decimal('5.000000'),
      }),
      line({
        lineId: 'line-industry-b',
        industryIdSnapshot: 'industry-b',
        grossAmountSnapshot: decimal('120.00'),
        productOverrideRateSnapshot: decimal('10.000000'),
        industryDefaultRateSnapshot: decimal('3.000000'),
      }),
    ])

    expect(
      result.lines.map((item) => [
        item.industryIdSnapshot,
        item.source,
        item.projectedAmount?.toFixed(2),
      ]),
    ).toEqual([
      ['industry-a', 'industry_default', '4.00'],
      ['industry-b', 'product_override', '12.00'],
    ])
    expect(result.totalBasisAmount.toFixed(2)).toBe('200.00')
    expect(result.totalProjectedAmount.toFixed(2)).toBe('16.00')
    expect(result.totalReportableAmount.toFixed(2)).toBe('16.00')
  })

  it('makes both discount snapshots explicit in the commission basis', () => {
    const [result] = calculateCommissionLines([
      line({
        grossAmountSnapshot: decimal('100.00'),
        lineDiscountAmountSnapshot: decimal('10.00'),
        overallDiscountAllocationSnapshot: decimal('5.00'),
        industryDefaultRateSnapshot: decimal('4.000000'),
      }),
    ])

    expect(result?.discounts.grossAmount.toFixed(2)).toBe('100.00')
    expect(result?.discounts.lineDiscountAmount.toFixed(2)).toBe('10.00')
    expect(result?.discounts.overallDiscountAmount.toFixed(2)).toBe('5.00')
    expect(result?.basisAmount.toFixed(2)).toBe('85.00')
    expect(result?.projectedAmount?.toFixed(2)).toBe('3.40')
  })

  it('retains the projection but excludes cancelled lines from reporting', () => {
    const result = calculateCommission([
      line({
        industryDefaultRateSnapshot: decimal('5.000000'),
        cancellation: {
          status: 'cancelled',
          cancelledAt: '2026-08-17T12:00:00.000Z',
          reason: 'Pedido cancelado pelo cliente',
        },
      }),
    ])

    expect(result.lines[0]?.projectedAmount?.toFixed(2)).toBe('5.00')
    expect(result.lines[0]?.cancellationEffect).toBe(
      'exclude_from_reporting',
    )
    expect(result.lines[0]?.reportingDisposition).toBe('excluded_cancelled')
    expect(result.lines[0]?.reportableAmount.toFixed(2)).toBe('0.00')
    expect(result.totalProjectedAmount.toFixed(2)).toBe('5.00')
    expect(result.totalReportableAmount.toFixed(2)).toBe('0.00')
  })

  it('rejects native numbers instead of coercing through floating point', () => {
    const floatingPointInput = line({
      grossAmountSnapshot: 0.1 as unknown as Decimal,
    })

    expect(() => calculateCommissionLines([floatingPointInput])).toThrowError(
      expect.objectContaining({ code: 'INVALID_DECIMAL' }),
    )
  })

  it('treats a zero product override as configured', () => {
    const [result] = calculateCommissionLines([
      line({
        productOverrideRateSnapshot: decimal('0.000000'),
        industryDefaultRateSnapshot: decimal('8.000000'),
      }),
    ])

    expect(result?.source).toBe('product_override')
    expect(result?.rate?.toFixed(6)).toBe('0.000000')
    expect(result?.projectedAmount?.toFixed(2)).toBe('0.00')
  })

  it('keeps an absent rate explicit instead of inventing a commission', () => {
    const [result] = calculateCommissionLines([
      line({
        productOverrideRateSnapshot: null,
        industryDefaultRateSnapshot: null,
      }),
    ])

    expect(result?.source).toBe('none')
    expect(result?.rate).toBeNull()
    expect(result?.projectedAmount).toBeNull()
    expect(result?.reportableAmount.toFixed(2)).toBe('0.00')
  })

  it('rounds a half-cent commission boundary with ROUND_HALF_UP', () => {
    const [result] = calculateCommissionLines([
      line({
        grossAmountSnapshot: decimal('99.80'),
        industryDefaultRateSnapshot: decimal('2.500000'),
      }),
    ])

    expect(result?.basisAmount.toFixed(2)).toBe('99.80')
    expect(result?.projectedAmount?.toFixed(2)).toBe('2.50')
  })

  it('has no database, framework, clock, or network dependency', () => {
    const source = readFileSync(
      new URL('../../src/domain/commission-calculator.ts', import.meta.url),
      'utf8',
    )
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      ([, dependency]) => dependency,
    )

    expect(imports).toEqual(['decimal.js'])
    expect(source).not.toMatch(
      /(?:drizzle|postgres|database|fetch|axios|Date\.|new Date|react)/i,
    )
  })

  it('validates discounts inside its private Decimal context', () => {
    const LowPrecisionDecimal = Decimal.clone({ precision: 1 })
    const lowPrecision = (value: string) => new LowPrecisionDecimal(value)

    expect(() =>
      calculateCommissionLines([
        line({
          grossAmountSnapshot: lowPrecision('0.10'),
          lineDiscountAmountSnapshot: lowPrecision('0.06'),
          overallDiscountAllocationSnapshot: lowPrecision('0.05'),
        }),
      ]),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_LINE' }))
  })

  it('publishes immutable result and cancellation snapshots', () => {
    const cancellation = {
      status: 'cancelled' as const,
      cancelledAt: '2026-08-17T12:00:00.000Z',
      reason: 'Original reason',
    }
    const results = calculateCommissionLines([line({ cancellation })])

    cancellation.reason = 'Mutated reason'

    expect(Object.isFrozen(results)).toBe(true)
    expect(Object.isFrozen(results[0])).toBe(true)
    expect(Object.isFrozen(results[0]?.cancellation)).toBe(true)
    expect(results[0]?.cancellation).toEqual({
      status: 'cancelled',
      cancelledAt: '2026-08-17T12:00:00.000Z',
      reason: 'Original reason',
    })
  })

  it('rejects money outside the DECIMAL(19,2) persistence range', () => {
    expect(() =>
      calculateCommissionLines([
        line({
          grossAmountSnapshot: decimal('100000000000000000.00'),
          industryDefaultRateSnapshot: decimal('100.000000'),
        }),
      ]),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DECIMAL' }))
  })
})
