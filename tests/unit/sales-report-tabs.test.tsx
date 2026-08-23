/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SalesReportTabs } from '@/features/app/reports/sales-report-tabs'
import type { ReportShellContext } from '@/features/app/reports/reports-shell'
import type { SalesReportPage } from '@/features/app/reports/report-page'

afterEach(cleanup)

function makeContext(
  overrides: Partial<ReportShellContext> = {},
): ReportShellContext {
  return {
    state: {
      tab: 'clientes',
      filters: {
        from: '2026-07-01',
        to: '2026-07-31',
        statuses: [],
        representativeIds: [],
      },
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [],
      columnVisibility: {},
    },
    config: {
      defaultTab: 'clientes',
      defaultPageSize: 20,
      pageSizes: [10, 20, 50],
      maxPage: 10_000,
      maxDateRangeDays: 366,
      statuses: ['open', 'confirmed', 'invoiced', 'completed', 'cancelled'],
      representativeIds: [],
      tabs: {
        clientes: { sortableColumns: ['client', 'orders', 'total'], columns: ['client', 'orders', 'total'] },
        produtos: { sortableColumns: ['product', 'quantity', 'total'], columns: ['product', 'quantity', 'total'] },
        industrias: { sortableColumns: ['industry', 'orders', 'total'], columns: ['industry', 'orders', 'total'] },
        comissoes: { sortableColumns: ['representative'], columns: ['representative'] },
      },
    },
    updatePagination: () => undefined,
    updateSorting: () => undefined,
    updateColumnVisibility: () => undefined,
    ...overrides,
  }
}

function pageFixture(overrides: Partial<SalesReportPage> = {}): SalesReportPage {
  return {
    grouping: 'clientes',
    rows: [
      {
        id: 'client-alpha',
        label: 'Cliente Alpha',
        orderCount: 2,
        quantity: null,
        byCurrency: [{ currencyCode: 'BRL', totalAmount: '300.010000' }],
      },
      {
        id: 'client-beta',
        label: 'Cliente Beta',
        orderCount: 1,
        quantity: null,
        byCurrency: [{ currencyCode: 'BRL', totalAmount: '300.005000' }],
      },
    ],
    rowCount: 2,
    pageSubtotals: [
      { currencyCode: 'BRL', orderCount: 3, quantity: null, totalAmount: '600.015000' },
    ],
    overallTotals: [
      { currencyCode: 'BRL', orderCount: 3, quantity: null, totalAmount: '600.015000' },
    ],
    overallCommissionTotals: [
      { currencyCode: 'BRL', commissionAmount: '30.015000' },
    ],
    ...overrides,
  }
}

type LoadCall = {
  grouping: string
  offset: number
  limit: number
  sort: { id: string; direction: string } | null
  filters: { from: string; to: string; statuses: readonly string[]; representativeIds: readonly string[] }
}

function renderTabs(options: {
  context?: ReportShellContext
  result:
    | { ok: true; data: SalesReportPage }
    | { ok: false; error: { message: string } }
  loadPage?: (request: LoadCall) => Promise<unknown>
  drillThrough?: { orderListHref: string | null }
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const loadPage =
    options.loadPage ?? vi.fn(async () => options.result)
  render(
    <QueryClientProvider client={client}>
      <SalesReportTabs
        context={options.context ?? makeContext()}
        loadPage={loadPage as never}
        drillThrough={options.drillThrough}
      />
    </QueryClientProvider>,
  )
  return { loadPage }
}

describe('SalesReportTabs', () => {
  it('renders rows from the canonical server page with accessible table naming', async () => {
    renderTabs({ result: { ok: true, data: pageFixture() } })

    const region = await screen.findByRole('region', { name: 'Vendas por cliente' })
    expect(region).toBeInTheDocument()
    await screen.findByText('Cliente Alpha')
    const table = within(region).getByRole('table', { name: /Vendas por cliente/ })
    expect(table).toBeInTheDocument()
    expect(within(region).getByText('Cliente Alpha')).toBeInTheDocument()
    expect(within(region).getByText('Cliente Beta')).toBeInTheDocument()
  })

  it('requests exactly one bounded server page per render (no N+1)', async () => {
    const { loadPage } = renderTabs({ result: { ok: true, data: pageFixture() } })

    await waitFor(() =>
      expect(screen.getByText('Cliente Alpha')).toBeInTheDocument(),
    )
    expect(loadPage).toHaveBeenCalledTimes(1)
    const request = (loadPage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as LoadCall
    expect(request.grouping).toBe('clientes')
    expect(request.offset).toBe(0)
    expect(request.limit).toBe(20)
    expect(request.filters.from).toBe('2026-07-01')
    expect(request.filters.to).toBe('2026-07-31')
  })

  it('labels page subtotals and canonical period totals so they cannot be confused', async () => {
    renderTabs({ result: { ok: true, data: pageFixture() } })

    const subtotalTable = await screen.findByRole('table', {
      name: /Subtotais da página atual/,
    })
    expect(
      within(subtotalTable).getByText('Subtotal da página'),
    ).toBeInTheDocument()

    const overallTable = screen.getByRole('table', {
      name: /Totais canônicos do período/,
    })
    expect(
      within(overallTable).getByText('Total do período'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Comissões do período/)).toBeInTheDocument()
  })

  it('shows distinct totals when the page is a strict subset of the period', async () => {
    renderTabs({
      result: {
        ok: true,
        data: pageFixture({
          rows: [pageFixture().rows[0]!],
          rowCount: 2,
          pageSubtotals: [
            { currencyCode: 'BRL', orderCount: 2, quantity: null, totalAmount: '300.010000' },
          ],
        }),
      },
    })

    await screen.findByRole('table', { name: /Subtotais da página atual/ })
    const overall = screen.getByRole('table', { name: /Totais canônicos do período/ })
    expect(within(overall).getByText('R$ 600,02')).toBeInTheDocument()
  })

  it('renders drill-through links to permitted source sales records', async () => {
    renderTabs({
      result: { ok: true, data: pageFixture() },
      drillThrough: { orderListHref: '/app/pedidos' },
    })

    const link = await screen.findByRole('link', { name: 'Cliente Alpha' })
    expect(link).toHaveAttribute('href')
    expect(link.getAttribute('href')).toContain('/app/pedidos')
  })

  it('hides drill-through links when not permitted', async () => {
    renderTabs({ result: { ok: true, data: pageFixture() } })

    await screen.findByText('Cliente Alpha')
    expect(screen.queryByRole('link', { name: 'Cliente Alpha' })).not.toBeInTheDocument()
  })

  it('exposes loading and error states accessibly with retry', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const loadPage = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'Não foi possível concluir a operação.' },
    }))
    render(
      <QueryClientProvider client={client}>
        <SalesReportTabs context={makeContext()} loadPage={loadPage as never} />
      </QueryClientProvider>,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível carregar os dados.')
    expect(
      screen.getByRole('button', { name: 'Tentar novamente' }),
    ).toBeInTheDocument()
  })

  it('renders the empty state when the filtered period has no results', async () => {
    renderTabs({
      result: {
        ok: true,
        data: pageFixture({ rows: [], rowCount: 0, pageSubtotals: [] }),
      },
    })

    expect(await screen.findByText('Nenhum resultado')).toBeInTheDocument()
    expect(
      screen.queryByRole('table', { name: /Subtotais da página atual/ }),
    ).not.toBeInTheDocument()
  })

  it('withholds commission figures for read-only authorization', async () => {
    renderTabs({
      result: {
        ok: true,
        data: pageFixture({ overallCommissionTotals: null }),
      },
    })

    await screen.findByRole('table', { name: /Totais canônicos do período/ })
    expect(
      screen.getByText(/Comissões não disponíveis para o seu perfil/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Comissões do período/)).not.toBeInTheDocument()
  })

  it('switches the requested grouping with the active tab', async () => {
    const context = makeContext({
      state: {
        ...makeContext().state,
        tab: 'produtos',
      },
    })
    const { loadPage } = renderTabs({
      context,
      result: {
        ok: true,
        data: pageFixture({
          grouping: 'produtos',
          rows: [
            {
              id: 'product-a',
              label: 'Produto A',
              orderCount: null,
              quantity: '5.000000',
              byCurrency: [{ currencyCode: 'BRL', totalAmount: '400.010000' }],
            },
          ],
        }),
      },
    })

    await screen.findByText('Produto A')
    const request = (loadPage as ReturnType<typeof vi.fn>).mock.calls[0]![0] as LoadCall
    expect(request.grouping).toBe('produtos')
  })
})
