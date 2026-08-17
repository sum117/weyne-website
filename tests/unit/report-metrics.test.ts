import { describe, expect, it } from 'vitest'
import {
  buildReportMetrics,
  projectDashboardMetrics,
  projectReportMetrics,
  roundMetricMoney,
  type MetricClient,
  type MetricOrder,
} from '@/features/app/reports/report-metrics'

const clients: readonly MetricClient[] = [
  { id: 'client-alpha', name: 'Cliente Alpha', representativeId: 'rep-1' },
  { id: 'client-beta', name: 'Cliente Beta', representativeId: 'rep-2' },
  { id: 'client-dormant', name: 'Cliente Dormente', representativeId: 'rep-1' },
  { id: 'client-never', name: 'Cliente Sem Pedido', representativeId: 'rep-1' },
]

const orders: readonly MetricOrder[] = [
  {
    id: 'before-period',
    clientId: 'client-dormant',
    representativeId: 'rep-1',
    occurredAt: '2026-05-01T12:00:00.000Z',
    status: 'completed',
    currencyCode: 'BRL',
    totalAmount: '50.000000',
    commissionAmount: '2.500000',
    lines: [],
  },
  {
    id: 'first-boundary',
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
    id: 'middle-period',
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
    id: 'last-boundary',
    clientId: 'client-beta',
    representativeId: 'rep-2',
    occurredAt: '2026-08-01T02:59:59.999Z',
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
  {
    id: 'cancelled',
    clientId: 'client-alpha',
    representativeId: 'rep-1',
    occurredAt: '2026-07-20T12:00:00.000Z',
    status: 'cancelled',
    currencyCode: 'BRL',
    totalAmount: '999.000000',
    commissionAmount: '99.000000',
    lines: [],
  },
  {
    id: 'after-period',
    clientId: 'client-alpha',
    representativeId: 'rep-1',
    occurredAt: '2026-08-01T03:00:00.000Z',
    status: 'confirmed',
    currencyCode: 'BRL',
    totalAmount: '400.000000',
    commissionAmount: '20.000000',
    lines: [],
  },
]

const request = {
  from: '2026-07-01',
  to: '2026-07-31',
  asOf: '2026-08-17',
  inactiveDays: 90,
  timeZone: 'America/Fortaleza',
  role: 'admin',
  actorRepresentativeId: null,
  explicitlyAssignedRepresentativeIds: [],
  statuses: [],
} as const

describe('canonical report metrics', () => {
  it('rounds money only at the presentation boundary using half-up cents', () => {
    expect(roundMetricMoney('600.015000')).toBe('600.02')
    expect(roundMetricMoney('300.010000')).toBe('300.01')
    expect(roundMetricMoney('1.004999')).toBe('1.00')
  })

  it('uses inclusive business dates, excludes cancelled orders, and reconciles every grouping', () => {
    const snapshot = buildReportMetrics({ clients, orders, request })

    expect(snapshot.period).toEqual({
      fromInclusive: '2026-07-01T03:00:00.000Z',
      toExclusive: '2026-08-01T03:00:00.000Z',
      timeZone: 'America/Fortaleza',
    })
    expect(snapshot.byCurrency).toEqual([
      {
        currencyCode: 'BRL',
        orderCount: 3,
        clientCount: 2,
        totalAmount: '600.015000',
        commissionAmount: '30.015000',
      },
    ])
    expect(snapshot.clients).toEqual([
      {
        id: 'client-alpha',
        name: 'Cliente Alpha',
        orderCount: 2,
        byCurrency: [
          { currencyCode: 'BRL', totalAmount: '300.010000', commissionAmount: '15.010000' },
        ],
      },
      {
        id: 'client-beta',
        name: 'Cliente Beta',
        orderCount: 1,
        byCurrency: [
          { currencyCode: 'BRL', totalAmount: '300.005000', commissionAmount: '15.005000' },
        ],
      },
    ])
    expect(snapshot.products).toEqual([
      {
        id: 'product-a',
        name: 'Produto A',
        quantity: '5.000000',
        byCurrency: [{ currencyCode: 'BRL', totalAmount: '400.010000' }],
      },
      {
        id: 'product-b',
        name: 'Produto B',
        quantity: '4.000000',
        byCurrency: [{ currencyCode: 'BRL', totalAmount: '200.005000' }],
      },
    ])
    expect(snapshot.industries).toEqual([
      {
        id: 'industry-a',
        name: 'Indústria A',
        orderCount: 2,
        byCurrency: [{ currencyCode: 'BRL', totalAmount: '300.010000' }],
      },
      {
        id: 'industry-b',
        name: 'Indústria B',
        orderCount: 1,
        byCurrency: [{ currencyCode: 'BRL', totalAmount: '300.005000' }],
      },
    ])

    expect(projectDashboardMetrics(snapshot)).toEqual(snapshot.byCurrency)
    expect(projectReportMetrics(snapshot, 'clientes')).toEqual(snapshot.clients)
    expect(projectReportMetrics(snapshot, 'produtos')).toEqual(snapshot.products)
    expect(projectReportMetrics(snapshot, 'industrias')).toEqual(snapshot.industries)
  })

  it('applies role scope before all cards, tables, and inactive-client results', () => {
    const representative = buildReportMetrics({
      clients,
      orders,
      request: { ...request, role: 'representative', actorRepresentativeId: 'rep-1' },
    })
    expect(representative.byCurrency[0]).toMatchObject({
      orderCount: 2,
      totalAmount: '300.010000',
      commissionAmount: '15.010000',
    })
    expect(representative.clients.map((client) => client.id)).toEqual(['client-alpha'])
    expect(representative.inactiveClients).toEqual([
      {
        id: 'client-dormant',
        name: 'Cliente Dormente',
        representativeId: 'rep-1',
        lastActivityAt: '2026-05-01T12:00:00.000Z',
        inactiveSince: '2026-05-19',
      },
      {
        id: 'client-never',
        name: 'Cliente Sem Pedido',
        representativeId: 'rep-1',
        lastActivityAt: null,
        inactiveSince: '2026-05-19',
      },
    ])

    const readOnly = buildReportMetrics({
      clients,
      orders,
      request: {
        ...request,
        role: 'read_only',
        explicitlyAssignedRepresentativeIds: ['rep-2'],
      },
    })
    expect(readOnly.byCurrency).toEqual([
      {
        currencyCode: 'BRL',
        orderCount: 1,
        clientCount: 1,
        totalAmount: '300.005000',
        commissionAmount: null,
      },
    ])
  })

  it('supports canonical status filters, empty states, and a large bounded fixture', () => {
    expect(
      buildReportMetrics({
        clients,
        orders,
        request: { ...request, statuses: ['invoiced'] },
      }).byCurrency,
    ).toEqual([
      {
        currencyCode: 'BRL',
        orderCount: 1,
        clientCount: 1,
        totalAmount: '200.005000',
        commissionAmount: '10.005000',
      },
    ])

    const empty = buildReportMetrics({
      clients: [],
      orders: [],
      request,
    })
    expect(empty.byCurrency).toEqual([])
    expect(empty.clients).toEqual([])
    expect(empty.inactiveClients).toEqual([])

    const boundedOrders = Array.from({ length: 10_000 }, (_, index) => ({
      ...orders[1]!,
      id: `bounded-${index}`,
    }))
    expect(
      buildReportMetrics({ clients, orders: boundedOrders, request }).byCurrency[0],
    ).toMatchObject({ orderCount: 10_000, totalAmount: '1000050.000000' })
    expect(() =>
      buildReportMetrics({
        clients,
        orders: [...boundedOrders, ...boundedOrders, ...boundedOrders, ...boundedOrders, ...boundedOrders, orders[1]!],
        request,
      }),
    ).toThrow(/50,000/)
  })

  it('rejects invalid filters and mixed-currency line/header drift', () => {
    expect(() =>
      buildReportMetrics({
        clients,
        orders,
        request: { ...request, from: '31/07/2026' },
      }),
    ).toThrow(/from/)

    expect(() =>
      buildReportMetrics({
        clients,
        orders: [
          {
            ...orders[1]!,
            lines: [{ ...orders[1]!.lines[0]!, currencyCode: 'USD' }],
          },
        ],
        request,
      }),
    ).toThrow(/currency/i)
  })
})
