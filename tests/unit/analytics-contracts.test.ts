import { describe, expect, it } from 'vitest'
import {
  BUSINESS_TIME_ZONE,
  EXCLUDED_ORDER_STATUSES,
  INCLUDED_ORDER_STATUSES,
  localMidnight,
  resolveAsOfExclusive,
  resolveCivilDateRange,
  resolveInactivityFloor,
} from '@/lib/analytics/metric-contracts'
import {
  DEFAULT_ANALYTICS_PAGE_SIZE,
  MAX_ANALYTICS_PAGE_SIZE,
  assertBoundedLimit,
  boundedPageSchema,
  describeDeterministicOrdering,
  sortDirectionSchema,
} from '@/lib/analytics/bounds'

describe('metric contracts — status vocabulary', () => {
  it('partitions order statuses into included and excluded without overlap', () => {
    const all = new Set([...INCLUDED_ORDER_STATUSES, ...EXCLUDED_ORDER_STATUSES])
    expect(all.size).toBe(5)
    expect(INCLUDED_ORDER_STATUSES).toEqual([
      'open',
      'confirmed',
      'invoiced',
      'completed',
    ])
    expect(EXCLUDED_ORDER_STATUSES).toEqual(['cancelled'])
  })
})

describe('metric contracts — civil date ranges', () => {
  it('compiles an inclusive civil window to a half-open instant interval', () => {
    const range = resolveCivilDateRange({
      from: '2026-07-01',
      to: '2026-07-31',
      timeZone: BUSINESS_TIME_ZONE,
    })
    expect(range.fromInclusive.toISOString()).toBe('2026-07-01T03:00:00.000Z')
    expect(range.toExclusive.toISOString()).toBe('2026-08-01T03:00:00.000Z')
  })

  it('selects exactly one civil day when from equals to', () => {
    const range = resolveCivilDateRange({
      from: '2026-08-17',
      to: '2026-08-17',
      timeZone: BUSINESS_TIME_ZONE,
    })
    expect(range.toExclusive.valueOf() - range.fromInclusive.valueOf()).toBe(
      24 * 60 * 60 * 1000,
    )
  })

  it('rejects inverted ranges, invalid dates, and invalid zones', () => {
    expect(() =>
      resolveCivilDateRange({ from: '2026-07-02', to: '2026-07-01', timeZone: BUSINESS_TIME_ZONE }),
    ).toThrow(RangeError)
    expect(() =>
      resolveCivilDateRange({ from: '2026-02-30', to: '2026-03-01', timeZone: BUSINESS_TIME_ZONE }),
    ).toThrow(TypeError)
    expect(() =>
      resolveCivilDateRange({ from: '2026-07-01', to: '2026-07-02', timeZone: 'Mars/Olympus' }),
    ).toThrow(TypeError)
    expect(() =>
      resolveCivilDateRange({ from: '2026-7-1', to: '2026-07-02', timeZone: BUSINESS_TIME_ZONE }),
    ).toThrow(TypeError)
  })

  it('keeps the boundary instant exclusive so adjacent periods never overlap', () => {
    const july = resolveCivilDateRange({
      from: '2026-07-01',
      to: '2026-07-31',
      timeZone: BUSINESS_TIME_ZONE,
    })
    const august = resolveCivilDateRange({
      from: '2026-08-01',
      to: '2026-08-31',
      timeZone: BUSINESS_TIME_ZONE,
    })
    expect(july.toExclusive.toISOString()).toBe(august.fromInclusive.toISOString())
  })
})

describe('metric contracts — as-of and inactivity boundaries', () => {
  it('resolves the as-of edge to the end of the as-of civil day', () => {
    expect(resolveAsOfExclusive('2026-08-17', BUSINESS_TIME_ZONE).toISOString()).toBe(
      '2026-08-18T03:00:00.000Z',
    )
  })

  it('resolves the inactivity floor 90 civil days before as-of', () => {
    // Reporting contract fixture: asOf 2026-08-17, inactiveDays 90 → 2026-05-19.
    expect(
      resolveInactivityFloor('2026-08-17', 90, BUSINESS_TIME_ZONE).toISOString(),
    ).toBe('2026-05-19T03:00:00.000Z')
  })

  it('rejects negative or fractional inactivity windows', () => {
    expect(() => resolveInactivityFloor('2026-08-17', -1, BUSINESS_TIME_ZONE)).toThrow(
      RangeError,
    )
    expect(() => resolveInactivityFloor('2026-08-17', 1.5, BUSINESS_TIME_ZONE)).toThrow(
      RangeError,
    )
  })
})

describe('metric contracts — local midnight', () => {
  it('maps a civil date to local midnight as a UTC instant', () => {
    expect(localMidnight('2026-01-01', BUSINESS_TIME_ZONE).toISOString()).toBe(
      '2026-01-01T03:00:00.000Z',
    )
  })
})

describe('bounds — pagination limits', () => {
  it('defaults to the standard page size and clamps at the ceiling', () => {
    expect(boundedPageSchema.parse({})).toEqual({ limit: DEFAULT_ANALYTICS_PAGE_SIZE })
    expect(boundedPageSchema.parse({ limit: '100' })).toEqual({ limit: MAX_ANALYTICS_PAGE_SIZE })
  })

  it('rejects zero, negative, fractional, and over-ceiling limits', () => {
    expect(() => boundedPageSchema.parse(0)).toThrow()
    expect(() => boundedPageSchema.parse(-5)).toThrow()
    expect(() => boundedPageSchema.parse(1.5)).toThrow()
    expect(() => boundedPageSchema.parse(MAX_ANALYTICS_PAGE_SIZE + 1)).toThrow()
  })

  it('asserts bounded limits with a surface name in the error', () => {
    expect(() => assertBoundedLimit(0, 'top-products')).toThrow(/top-products/)
    expect(() => assertBoundedLimit(MAX_ANALYTICS_PAGE_SIZE + 1, 'export-page')).toThrow(
      /export-page/,
    )
    expect(() => assertBoundedLimit(1, 'orders')).not.toThrow()
  })
})

describe('bounds — deterministic ordering', () => {
  it('always appends the unique id tie-breaker', () => {
    expect(describeDeterministicOrdering(['createdAt'])).toEqual([
      { key: 'createdAt', direction: 'desc' },
      { key: 'id', direction: 'asc' },
    ])
  })

  it('rejects an empty key list', () => {
    expect(() => describeDeterministicOrdering([])).toThrow(TypeError)
  })

  it('allowlists sort directions only', () => {
    expect(sortDirectionSchema.safeParse('asc').success).toBe(true)
    expect(sortDirectionSchema.safeParse('sideways').success).toBe(false)
  })
})
