import { describe, expect, it } from 'vitest'
import {
  parseReportSearch,
  serializeReportSearch,
  switchReportTab,
  toReportPageRequest,
  type ReportStateConfig,
} from '@/features/app/reports/report-state'

const config = {
  defaultTab: 'clientes',
  defaultPageSize: 20,
  pageSizes: [10, 20, 50],
  maxPage: 10_000,
  maxDateRangeDays: 366,
  statuses: ['pending', 'invoiced', 'cancelled'],
  representativeIds: ['rep-1', 'rep-2'],
  tabs: {
    clientes: {
      sortableColumns: ['client', 'total'],
      columns: ['client', 'orders', 'total'],
    },
    produtos: {
      sortableColumns: ['product', 'quantity'],
      columns: ['product', 'quantity', 'total'],
    },
    industrias: {
      sortableColumns: ['industry', 'total'],
      columns: ['industry', 'orders', 'total'],
    },
    comissoes: {
      sortableColumns: ['representative', 'commission'],
      columns: ['representative', 'sales', 'commission'],
    },
  },
} as const satisfies ReportStateConfig

const today = '2026-08-17'

describe('report URL state', () => {
  it('round-trips a valid tab, filters, pagination, sorting, and column visibility', () => {
    const state = parseReportSearch(
      {
        tab: 'produtos',
        from: '2026-07-01',
        to: '2026-08-10',
        status: ['pending', 'invoiced'],
        representative: 'rep-1',
        page: '3',
        pageSize: '50',
        sort: 'quantity.desc',
        columns: ['product', 'total'],
      },
      config,
      today,
    )

    expect(state).toEqual({
      tab: 'produtos',
      filters: {
        from: '2026-07-01',
        to: '2026-08-10',
        statuses: ['pending', 'invoiced'],
        representativeIds: ['rep-1'],
      },
      pagination: { pageIndex: 2, pageSize: 50 },
      sorting: [{ id: 'quantity', desc: true }],
      columnVisibility: { product: true, quantity: false, total: true },
    })

    expect(
      parseReportSearch(serializeReportSearch(state, config), config, today),
    ).toEqual(state)
  })

  it('bounds dates, page size, page number, statuses, representatives, sort, and columns', () => {
    expect(
      parseReportSearch(
        {
          tab: 'private',
          from: '2020-01-01',
          to: '2099-12-31',
          status: ['pending', 'private', 'pending'],
          representative: ['rep-2', 'unknown'],
          page: '999999999',
          pageSize: '1000000',
          sort: 'secret.desc',
          columns: ['secret'],
        },
        config,
        today,
      ),
    ).toEqual({
      tab: 'clientes',
      filters: {
        from: '2025-08-17',
        to: today,
        statuses: ['pending'],
        representativeIds: ['rep-2'],
      },
      pagination: { pageIndex: 9_999, pageSize: 20 },
      sorting: [],
      columnVisibility: {},
    })
  })

  it('normalizes a reversed date range without creating an invalid interval', () => {
    const state = parseReportSearch(
      { from: '2026-08-10', to: '2026-08-01' },
      config,
      today,
    )

    expect(state.filters).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-10',
    })
  })

  it('preserves shared valid filters while resetting tab-specific table state', () => {
    const current = parseReportSearch(
      {
        tab: 'clientes',
        from: '2026-07-01',
        to: '2026-08-01',
        status: 'invoiced',
        representative: 'rep-1',
        page: 4,
        sort: 'client.asc',
        columns: ['client', 'total'],
      },
      config,
      today,
    )

    expect(switchReportTab(current, 'produtos', config)).toEqual({
      ...current,
      tab: 'produtos',
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [],
      columnVisibility: {},
    })
  })

  it('always creates a bounded server page request rather than a full-data query', () => {
    const state = parseReportSearch(
        { tab: 'comissoes', page: 2, pageSize: 50, sort: 'commission.desc' },
        config,
        today,
      )
    const request = toReportPageRequest(state)
    const tamperedRequest = toReportPageRequest({
      ...state,
      pagination: { pageIndex: 1, pageSize: 1_000_000 },
    })

    expect(request).toMatchObject({
      grouping: 'comissoes',
      offset: 50,
      limit: 50,
      sort: { id: 'commission', direction: 'desc' },
    })
    expect(request).not.toHaveProperty('fetchAll')
    expect(tamperedRequest).toMatchObject({ offset: 50, limit: 50 })
  })
})
