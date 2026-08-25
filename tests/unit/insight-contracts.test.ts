import { describe, expect, it } from 'vitest'
import {
  BUSINESS_TIME_ZONE,
  resolveInactivityFloor,
  resolveAsOfExclusive,
} from '@/lib/analytics/metric-contracts'
import {
  DEFAULT_INACTIVE_DAYS,
  INACTIVE_CLIENTS_TIEBREAK,
  INSIGHT_EMPTY_MESSAGES,
  insightFiltersSchema,
  MAX_INACTIVE_DAYS,
  MIN_INACTIVE_DAYS,
  PRICE_HISTORY_TIEBREAK,
  inactiveDaysSchema,
  inactiveClientsFiltersSchema,
  insightProjection,
  priceHistoryFiltersSchema,
  resolveInactiveWindow,
  resolveInsightEmptyMessage,
} from '@/lib/analytics/insight-contracts'

describe('inactive-client threshold contract', () => {
  it('defaults to 90 days and validates the documented range', () => {
    expect(inactiveDaysSchema.parse(undefined)).toBe(DEFAULT_INACTIVE_DAYS)
    expect(inactiveDaysSchema.parse(1)).toBe(MIN_INACTIVE_DAYS)
    expect(inactiveDaysSchema.parse(365)).toBe(MAX_INACTIVE_DAYS)
    expect(inactiveDaysSchema.parse('90')).toBe(90) // URL string form
  })

  it('rejects out-of-range thresholds instead of clamping', () => {
    for (const bad of [0, -5, 366, 90.5, Number.NaN]) {
      expect(() => inactiveDaysSchema.parse(bad)).toThrow()
    }
  })

  it('compiles the canonical window: floor inclusive, as-of end exclusive', () => {
    // Reporting-contract fixture: 2026-08-17 minus 90 civil days = 2026-05-19.
    const window = resolveInactiveWindow('2026-08-17', 90)
    expect(window.floorInclusive.toISOString()).toBe(
      '2026-05-19T03:00:00.000Z',
    )
    // End of as-of day in America/Fortaleza (UTC-3): next midnight = 03:00Z.
    expect(window.asOfExclusive.toISOString()).toBe('2026-08-18T03:00:00.000Z')
  })

  it('keeps a purchase exactly on the floor active (strict-boundary rule)', () => {
    const window = resolveInactiveWindow('2026-08-17', 90)
    const exactlyOnFloor = new Date('2026-05-19T03:00:00.000Z')

    // Active: last purchase NOT strictly before the floor.
    expect(exactlyOnFloor.valueOf()).toBe(window.floorInclusive.valueOf())
    expect(exactlyOnFloor < window.floorInclusive).toBe(false)
    // Inactive: one instant earlier.
    const justBefore = new Date(exactlyOnFloor.valueOf() - 1)
    expect(justBefore < window.floorInclusive).toBe(true)
  })

  it('counts an order inside the as-of day but not at its exclusive end', () => {
    const window = resolveInactiveWindow('2026-08-17', 90)
    const lateSameDay = new Date('2026-08-17T23:59:59.000-03:00')
    const atBoundaryEnd = new Date('2026-08-18T03:00:00.000Z')
    expect(lateSameDay.valueOf() < window.asOfExclusive.valueOf()).toBe(true)
    expect(atBoundaryEnd.valueOf()).toBe(window.asOfExclusive.valueOf())
    expect(atBoundaryEnd.valueOf() < window.asOfExclusive.valueOf()).toBe(false)
  })
})

describe('insight URL filters', () => {
  it('parses shared filters with defaults', () => {
    const parsed = insightBaseFixture()
    expect(parsed.asOf).toBe('2026-08-17')
    expect(parsed.timeZone).toBe(BUSINESS_TIME_ZONE)
    expect(parsed.limit).toBe(25)
  })

  it('rejects malformed dates rather than silently defaulting them', () => {
    expect(() => insightBaseFixture({ asOf: '17/08/2026' })).toThrow()
    expect(() => insightBaseFixture({ asOf: '' })).toThrow()
  })

  it('rejects pattern-valid but calendar-invalid dates at boundary resolution', () => {
    expect(() =>
      resolveInactiveWindow('2026-02-30', DEFAULT_INACTIVE_DAYS),
    ).toThrow()
  })

  it('accepts all four comparison ids and caps the selection at four', () => {
    const all = priceHistoryFiltersSchema.parse({
      asOf: '2026-08-17',
      comparisons: ['p1_vs_p2', 'p2_vs_p3', 'p3_vs_p4', 'spread_1_4'],
    })
    expect(all.comparisons).toHaveLength(4)

    const defaulted = priceHistoryFiltersSchema.parse({ asOf: '2026-08-17' })
    expect(defaulted.comparisons).toEqual([]) // empty means ALL four downstream

    expect(() =>
      priceHistoryFiltersSchema.parse({
        asOf: '2026-08-17',
        comparisons: ['p1_vs_p2', 'bogus'],
      }),
    ).toThrow()

    expect(() =>
      priceHistoryFiltersSchema.parse({
        asOf: '2026-08-17',
        comparisons: [
          'p1_vs_p2',
          'p2_vs_p3',
          'p3_vs_p4',
          'spread_1_4',
          'spread_1_4',
        ],
      }),
    ).toThrow()
  })

  it('keeps never-purchased inclusion on by default per reporting contract', () => {
    const parsed = inactiveClientsFiltersSchema.parse({ asOf: '2026-08-17' })
    expect(parsed.includeNeverPurchased).toBe(true)
    expect(parsed.inactiveDays).toBe(90)
  })
})

function insightBaseFixture(
  overrides: Record<string, unknown> = {},
): { asOf: string; timeZone: string; limit: number } {
  return insightFiltersSchema.parse({
    asOf: '2026-08-17',
    ...overrides,
  }) as { asOf: string; timeZone: string; limit: number }
}

describe('role/field visibility projection', () => {
  it('gives admin full amounts, comparisons, and change audit fields', () => {
    expect(insightProjection('admin')).toEqual({
      amounts: true,
      comparisons: true,
      changeAuditFields: true,
      clientContactFields: false,
    })
  })

  it('hides change audit fields from representatives but keeps amounts', () => {
    const p = insightProjection('representative')
    expect(p.amounts).toBe(true)
    expect(p.comparisons).toBe(true)
    expect(p.changeAuditFields).toBe(false)
  })

  it('fails closed for read_only: no amounts, no comparisons, no PII', () => {
    expect(insightProjection('read_only')).toEqual({
      amounts: false,
      comparisons: false,
      changeAuditFields: false,
      clientContactFields: false,
    })
  })
})

describe('deterministic ordering contracts', () => {
  it('declares unique-id tiebreakers after business sort keys', () => {
    expect(PRICE_HISTORY_TIEBREAK).toEqual(['product_id asc', 'id asc'])
    expect(INACTIVE_CLIENTS_TIEBREAK).toEqual(['client_id asc'])
  })
})

describe('empty-result language', () => {
  it('exposes canonical pt-BR copy for every surface', () => {
    for (const key of [
      'priceHistory',
      'priceComparisons',
      'inactiveClients',
    ] as const) {
      expect(resolveInsightEmptyMessage(key)).toBe(INSIGHT_EMPTY_MESSAGES[key])
      expect(resolveInsightEmptyMessage(key).length).toBeGreaterThan(10)
    }
  })
})

describe('boundary helpers remain consistent with metric contracts', () => {
  it('floor helper agrees with the standalone metric-contract helper', () => {
    expect(resolveInactiveWindow('2027-01-31', 31).floorInclusive).toEqual(
      resolveInactivityFloor('2027-01-31', 31, BUSINESS_TIME_ZONE),
    )
    expect(resolveInactiveWindow('2026-11-01', 1).asOfExclusive).toEqual(
      resolveAsOfExclusive('2026-11-01', BUSINESS_TIME_ZONE),
    )
  })
})
