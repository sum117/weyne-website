import { describe, expect, it } from 'vitest'
import {
  CommissionRequestError,
  buildCommissionPage,
  commissionSortTerm,
  normalizeCommissionRequest,
  resolveCommissionAccess,
  scopeRepresentativeFilter,
  sumCommissionColumn,
  sumCommissionOrders,
  type CommissionRow,
} from '@/features/app/reports/commission-report'

const baseRequest = {
  offset: 0,
  limit: 20,
  sort: null,
  from: '2026-07-01',
  to: '2026-07-31',
  timeZone: 'America/Fortaleza',
  statuses: [],
  representativeIds: [],
  role: 'admin' as const,
  actorRepresentativeId: null,
  explicitlyAssignedRepresentativeIds: [] as readonly string[],
}

function row(overrides: Partial<CommissionRow> = {}): CommissionRow {
  return {
    representativeId: 'rep-1',
    representativeName: 'Ana Souza',
    orderCount: 2,
    salesAmount: '100.500000',
    commissionAmount: '5.025000',
    currencyCode: 'BRL',
    sourceOrderIds: ['order-a', 'order-b'],
    ...overrides,
  }
}

describe('normalizeCommissionRequest', () => {
  it('bounds the page size and offset to the shared report caps', () => {
    const normalized = normalizeCommissionRequest({
      ...baseRequest,
      offset: 999_999_999,
      limit: 5_000,
    })
    expect(normalized.limit).toBe(50)
    expect(normalized.offset).toBeLessThanOrEqual(10_000 * 50)
  })

  it('keeps only allowlisted sort columns and directions', () => {
    const allowed = normalizeCommissionRequest({
      ...baseRequest,
      sort: { id: 'commission', direction: 'desc' },
    })
    expect(allowed.sort).toEqual({ id: 'commission', direction: 'desc' })

    const denied = normalizeCommissionRequest({
      ...baseRequest,
      sort: { id: 'password_hash', direction: 'asc' },
    })
    expect(denied.sort).toBeNull()
  })

  it('rejects invalid dates and inverted ranges', () => {
    expect(() =>
      normalizeCommissionRequest({ ...baseRequest, from: '2026-13-99' }),
    ).toThrow(CommissionRequestError)
    expect(() =>
      normalizeCommissionRequest({ ...baseRequest, from: '2026-08-01', to: '2026-07-01' }),
    ).toThrow(CommissionRequestError)
  })

  it.each([
    'Fortaleza/../../etc',
    'America/Fortaleza); DROP TABLE orders; --',
    'not-a-zone',
    '',
  ])('rejects a hostile or unknown timeZone before any query: %s', (timeZone) => {
    expect(() => normalizeCommissionRequest({ ...baseRequest, timeZone })).toThrow(
      CommissionRequestError,
    )
  })

  it('accepts the canonical business time zone', () => {
    expect(
      normalizeCommissionRequest({ ...baseRequest, timeZone: 'America/Fortaleza' })
        .timeZone,
    ).toBe('America/Fortaleza')
  })

  it('requires an actor representative for the representative role', () => {
    expect(() => normalizeCommissionRequest({ ...baseRequest, role: 'representative' })).toThrow(
      CommissionRequestError,
    )
    const scoped = normalizeCommissionRequest({
      ...baseRequest,
      role: 'representative',
      actorRepresentativeId: 'rep-9',
    })
    expect(scoped.actorRepresentativeId).toBe('rep-9')
  })
})

describe('resolveCommissionAccess', () => {
  it('grants admins full visibility and drill-through', () => {
    const access = resolveCommissionAccess(normalizeCommissionRequest(baseRequest))
    expect(access).toEqual({
      canViewCommissions: true,
      canDrillThrough: true,
      filterableRepresentativeIds: null,
    })
  })

  it('lets read-only users view reports without commission values or drill-through', () => {
    const access = resolveCommissionAccess(
      normalizeCommissionRequest({ ...baseRequest, role: 'read_only' }),
    )
    expect(access.canViewCommissions).toBe(false)
    expect(access.canDrillThrough).toBe(false)

    const assigned = resolveCommissionAccess(
      normalizeCommissionRequest({
        ...baseRequest,
        role: 'read_only',
        explicitlyAssignedRepresentativeIds: ['rep-1'],
      }),
    )
    expect(assigned.canViewCommissions).toBe(false)
    expect(assigned.canDrillThrough).toBe(true)
  })

  it('pins representatives to their own scope', () => {
    const access = resolveCommissionAccess(
      normalizeCommissionRequest({
        ...baseRequest,
        role: 'representative',
        actorRepresentativeId: 'rep-7',
      }),
    )
    expect(access.filterableRepresentativeIds).toEqual(['rep-7'])
  })
})

describe('scopeRepresentativeFilter', () => {
  it('drops denied representative filter values instead of leaking them', () => {
    const request = normalizeCommissionRequest({
      ...baseRequest,
      role: 'representative',
      actorRepresentativeId: 'rep-1',
      representativeIds: ['rep-2', 'rep-1'],
    })
    expect(scopeRepresentativeFilter(request)).toEqual(['rep-1'])
  })

  it('passes admin filters through untouched', () => {
    const request = normalizeCommissionRequest({
      ...baseRequest,
      representativeIds: ['rep-2'],
    })
    expect(scopeRepresentativeFilter(request)).toEqual(['rep-2'])
    expect(scopeRepresentativeFilter(normalizeCommissionRequest(baseRequest))).toBeNull()
  })
})

describe('page calculations', () => {
  it('sums page subtotals exactly across rows', () => {
    const rows = [
      row({ salesAmount: '100.105000', commissionAmount: '3.003150', orderCount: 3 }),
      row({ salesAmount: '200.000001', commissionAmount: '6.000000', orderCount: 1 }),
    ]
    expect(sumCommissionColumn(rows, 'salesAmount')).toBe('300.105001')
    expect(sumCommissionColumn(rows, 'commissionAmount')).toBe('9.003150')
    expect(sumCommissionOrders(rows)).toBe(4)
  })

  it('builds a page with subtotals distinct from canonical overall totals', () => {
    const page = buildCommissionPage({
      rows: [row()],
      overallTotals: { orderCount: 40, salesAmount: '9000.000000', commissionAmount: '450.000000' },
      totalRows: 12,
      offset: 20,
      limit: 20,
      currencyCode: 'BRL',
      canViewCommissions: true,
      canDrillThrough: true,
    })
    expect(page.pageSubtotal).toEqual({
      orderCount: 2,
      salesAmount: '100.500000',
      commissionAmount: '5.025000',
    })
    expect(page.overallTotals.orderCount).toBe(40)
    expect(page.totalRows).toBe(12)
    expect(page.rows[0]!.sourceOrderIds).toEqual(['order-a', 'order-b'])
  })

  it('withholds commission values and drill-through from unauthorized projections', () => {
    const page = buildCommissionPage({
      rows: [row()],
      overallTotals: { orderCount: 40, salesAmount: '9000.000000', commissionAmount: '450.000000' },
      totalRows: 12,
      offset: 0,
      limit: 20,
      currencyCode: 'BRL',
      canViewCommissions: false,
      canDrillThrough: false,
    })
    expect(page.rows[0]!.commissionAmount).toBe('0.000000')
    expect(page.rows[0]!.sourceOrderIds).toBeNull()
    expect(page.pageSubtotal.commissionAmount).toBe('0.000000')
    // Sales stay visible: read-only users may see who sold and how much.
    expect(page.rows[0]!.salesAmount).toBe('100.500000')
  })

  it('defaults sorting to commission descending', () => {
    expect(commissionSortTerm(null)).toBe('commission')
    expect(commissionSortTerm({ id: 'sales', direction: 'asc' })).toBe('sales')
  })
})
