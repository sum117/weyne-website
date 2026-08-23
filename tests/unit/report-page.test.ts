import { describe, expect, it } from 'vitest'
import {
  buildSalesReportPage,
  isSalesReportGrouping,
  SALES_REPORT_GROUPINGS,
  type SalesReportRow,
} from '@/features/app/reports/report-page'
import { buildReportMetrics } from '@/features/app/reports/report-metrics'
import type { MetricClient, MetricOrder } from '@/features/app/reports/report-metrics'

const clients: readonly MetricClient[] = [
  { id: 'client-alpha', name: 'Cliente Alpha', representativeId: 'rep-1' },
  { id: 'client-beta', name: 'Cliente Beta', representativeId: 'rep-2' },
]

const orders: readonly MetricOrder[] = [
  {
    id: 'order-1',
    clientId: 'client-alpha',
    representativeId: 'rep-1',
    occurredAt: '2026-07-01T03:00:00.000Z',
    status: 'open',
    currencyCode: 'BRL',
    totalAmount: '100.005000',
    commissionAmount: '5.005000',
    lines: [
      {
        productId: 'product-a',
        productName: 'Produto A',
        industryId: 'industry-a',
        industryName: 'Indústria A',
        quantity: '2.000000',
        totalAmount: '100.005000',
      },
    ],
  },
  {
    id: 'order-2',
    clientId: 'client-alpha',
    representativeId: 'rep-1',
    occurredAt: '2026-07-15T15:00:00.000Z',
    status: 'invoiced',
    currencyCode: 'BRL',
    totalAmount: '200.005000',
    commissionAmount: '10.005000',
    lines: [
      {
        productId: 'product-b',
        productName: 'Produto B',
        industryId: 'industry-a',
        industryName: 'Indústria A',
        quantity: '4.000000',
        totalAmount: '200.005000',
      },
    ],
  },
  {
    id: 'order-3',
    clientId: 'client-beta',
    representativeId: 'rep-2',
    occurredAt: '2026-07-20T12:00:00.000Z',
    status: 'completed',
    currencyCode: 'BRL',
    totalAmount: '300.005000',
    commissionAmount: '15.005000',
    lines: [
      {
        productId: 'product-a',
        productName: 'Produto A',
        industryId: 'industry-b',
        industryName: 'Indústria B',
        quantity: '3.000000',
        totalAmount: '300.005000',
      },
    ],
  },
]

const request = {
  from: '2026-07-01',
  to: '2026-07-31',
  asOf: '2026-08-17',
  inactiveDays: 90,
  timeZone: 'America/Fortaleza',
  role: 'admin' as const,
  actorRepresentativeId: null,
  explicitlyAssignedRepresentativeIds: [],
  statuses: [],
}

const snapshot = buildReportMetrics({ clients, orders, request })

function pageRequest(
  grouping: (typeof SALES_REPORT_GROUPINGS)[number],
  overrides: Partial<Parameters<typeof buildSalesReportPage>[1]> = {},
): Parameters<typeof buildSalesReportPage>[1] {
  return {
    grouping,
    offset: 0,
    limit: 50,
    sort: null,
    filters: { from: '2026-07-01', to: '2026-07-31', statuses: [], representativeIds: [] },
    ...overrides,
  }
}

describe('sales report page projection', () => {
  it('guards the grouping allowlist', () => {
    for (const grouping of SALES_REPORT_GROUPINGS) {
      expect(isSalesReportGrouping(grouping)).toBe(true)
    }
    expect(isSalesReportGrouping('comissoes')).toBe(false)
    expect(isSalesReportGrouping('qualquer')).toBe(false)
  })

  it('renders every grouping from the canonical snapshot rows', () => {
    const clientes = buildSalesReportPage(snapshot, pageRequest('clientes'))
    expect(clientes.rows.map((row) => [row.label, row.orderCount])).toEqual([
      ['Cliente Alpha', 2],
      ['Cliente Beta', 1],
    ])

    const produtos = buildSalesReportPage(snapshot, pageRequest('produtos'))
    expect(produtos.rows.map((row) => [row.label, row.quantity])).toEqual([
      ['Produto A', '5.000000'],
      ['Produto B', '4.000000'],
    ])

    const industrias = buildSalesReportPage(snapshot, pageRequest('industrias'))
    expect(industrias.rows.map((row) => [row.label, row.orderCount])).toEqual([
      ['Indústria A', 2],
      ['Indústria B', 1],
    ])
  })

  it('reconciles overall totals with the dashboard projection for identical filters', () => {
    for (const grouping of SALES_REPORT_GROUPINGS) {
      const page = buildSalesReportPage(snapshot, pageRequest(grouping))
      expect(page.overallTotals).toEqual([
        {
          currencyCode: 'BRL',
          orderCount: snapshot.byCurrency[0]!.orderCount,
          quantity: null,
          totalAmount: snapshot.byCurrency[0]!.totalAmount,
        },
      ])
    }
  })

  it('computes exact page subtotals distinct from overall totals', () => {
    const page = buildSalesReportPage(
      snapshot,
      pageRequest('clientes', { limit: 1 }),
    )
    expect(page.rowCount).toBe(2)
    expect(page.rows).toHaveLength(1)
    // Page subtotal covers only the returned row.
    expect(page.pageSubtotals).toEqual([
      {
        currencyCode: 'BRL',
        orderCount: 2,
        quantity: null,
        totalAmount: '300.010000',
      },
    ])
    // Overall totals still cover the whole filtered period.
    expect(page.overallTotals[0]).toMatchObject({
      orderCount: 3,
      totalAmount: '600.015000',
    })
  })

  it('sums product quantities exactly across a page', () => {
    const produtos = buildSalesReportPage(snapshot, pageRequest('produtos'))
    expect(produtos.pageSubtotals).toEqual([
      {
        currencyCode: 'BRL',
        orderCount: 0,
        quantity: '9.000000',
        totalAmount: '600.015000',
      },
    ])
  })

  it('sorts server-side by name, count, quantity, and total with id tiebreaker', () => {
    const byTotalDesc = buildSalesReportPage(
      snapshot,
      pageRequest('clientes', { sort: { id: 'total', direction: 'desc' } }),
    )
    expect(byTotalDesc.rows.map((row) => row.label)).toEqual([
      'Cliente Alpha',
      'Cliente Beta',
    ])

    const byOrdersAsc = buildSalesReportPage(
      snapshot,
      pageRequest('industrias', { sort: { id: 'orders', direction: 'asc' } }),
    )
    expect(byOrdersAsc.rows.map((row) => row.orderCount)).toEqual([1, 2])

    const byQuantityDesc = buildSalesReportPage(
      snapshot,
      pageRequest('produtos', { sort: { id: 'quantity', direction: 'desc' } }),
    )
    expect(byQuantityDesc.rows.map((row) => row.quantity)).toEqual([
      '4.000000',
      '5.000000',
    ].sort().reverse())

    const byName = buildSalesReportPage(
      snapshot,
      pageRequest('clientes', { sort: { id: 'client', direction: 'asc' } }),
    )
    expect(byName.rows.map((row) => row.label)).toEqual([
      'Cliente Alpha',
      'Cliente Beta',
    ])
  })

  it('paginates with offset and bounded page size', () => {
    const page = buildSalesReportPage(
      snapshot,
      pageRequest('clientes', { offset: 1, limit: 1 }),
    )
    expect(page.rows.map((row) => row.label)).toEqual(['Cliente Beta'])
    expect(page.rowCount).toBe(2)
  })

  it('withholds commission totals when the role redacts them', () => {
    const redactedSnapshot = buildReportMetrics({
      clients,
      orders,
      request: {
        ...request,
        role: 'read_only',
        explicitlyAssignedRepresentativeIds: ['rep-1'],
      },
    })
    const page = buildSalesReportPage(redactedSnapshot, pageRequest('clientes'))
    expect(page.overallCommissionTotals).toBeNull()
  })

  it('exposes commission totals for permitted roles', () => {
    const page = buildSalesReportPage(snapshot, pageRequest('produtos'))
    expect(page.overallCommissionTotals).toEqual([
      { currencyCode: 'BRL', commissionAmount: '30.015000' },
    ])
  })

  it('returns empty pages for empty snapshots without throwing', () => {
    const empty = buildReportMetrics({ clients: [], orders: [], request })
    const page = buildSalesReportPage(empty, pageRequest('industrias'))
    expect(page.rows).toEqual([])
    expect(page.rowCount).toBe(0)
    expect(page.pageSubtotals).toEqual([])
    expect(page.overallTotals).toEqual([])
  })

  it('keeps row identity stable for drill-through keys', () => {
    const page = buildSalesReportPage(snapshot, pageRequest('clientes'))
    const ids = page.rows.map((row) => row.id)
    expect(ids).toEqual(['client-alpha', 'client-beta'])
    expect(new Set<SalesReportRow['id']>(ids).size).toBe(ids.length)
  })
})
