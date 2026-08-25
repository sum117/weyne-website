/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommissionsTab } from '@/features/app/reports/commissions-tab'
import type {
  CommissionPage,
  CommissionPageRequest,
} from '@/features/app/reports/commission-report'
import type { ReportShellContext } from '@/features/app/reports/reports-shell'
import { parseReportSearch, type ReportStateConfig } from '@/features/app/reports/report-state'

afterEach(cleanup)

const config: ReportStateConfig = {
  defaultTab: 'comissoes',
  availableTabs: ['comissoes'],
  defaultPageSize: 20,
  pageSizes: [10, 20, 50],
  maxPage: 10_000,
  maxDateRangeDays: 366,
  statuses: ['open', 'confirmed', 'invoiced', 'completed', 'cancelled'],
  representativeIds: ['rep-1', 'rep-2'],
  tabs: {
    clientes: { sortableColumns: ['client'], columns: ['client'] },
    produtos: { sortableColumns: ['product'], columns: ['product'] },
    industrias: { sortableColumns: ['industry'], columns: ['industry'] },
    comissoes: {
      sortableColumns: ['representative', 'sales', 'commission'],
      columns: ['representative', 'sales', 'commission'],
    },
  },
}

function contextFor(search: Record<string, unknown> = {}): ReportShellContext {
  const state = parseReportSearch(search, config, '2026-08-21')
  return {
    state,
    config,
    updatePagination: () => undefined,
    updateSorting: () => undefined,
    updateColumnVisibility: () => undefined,
  }
}

const authorizedRow = {
  representativeId: 'rep-1',
  representativeName: 'Ana Souza',
  orderCount: 3,
  salesAmount: '1500.250000',
  commissionAmount: '75.012500',
  currencyCode: 'BRL',
  sourceOrderIds: ['order-1', 'order-2'],
}

function page(overrides: Partial<CommissionPage> = {}): CommissionPage {
  return {
    rows: [authorizedRow],
    pageSubtotal: { orderCount: 3, salesAmount: '1500.250000', commissionAmount: '75.012500' },
    overallTotals: { orderCount: 30, salesAmount: '15000.000000', commissionAmount: '750.000000' },
    totalRows: 4,
    offset: 0,
    limit: 20,
    currencyCode: 'BRL',
    canViewCommissions: true,
    canDrillThrough: true,
    ...overrides,
  }
}

function renderTab(
  loadPage: (request: CommissionPageRequest) => Promise<
    { ok: true; data: CommissionPage } | { ok: false; error: { message: string } }
  >,
  search: Record<string, unknown> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CommissionsTab context={contextFor(search)} loadPage={loadPage} />
    </QueryClientProvider>,
  )
}

describe('CommissionsTab', () => {
  it('renders canonical overall totals and the page subtotal distinctly', async () => {
    const loadPage = vi.fn().mockResolvedValue({ ok: true as const, data: page() })
    renderTab(loadPage)

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())

    const totals = screen.getByLabelText('Totais do relatório de comissões')
    expect(totals).toHaveTextContent('R$ 15.000,00')
    expect(totals).toHaveTextContent('750,00')

    const subtotal = screen.getByLabelText('Subtotal da página')
    expect(subtotal).toHaveTextContent('R$ 1.500,25')
    // Subtotal must never be confused with the overall total.
    expect(subtotal).not.toHaveTextContent('15.000')
  })

  it('sends bounded server pagination and shared filters to the endpoint', async () => {
    const loadPage = vi.fn().mockResolvedValue({ ok: true as const, data: page() })
    renderTab(
      loadPage,
      { page: 3, pageSize: 10, sort: 'commission.desc', status: ['confirmed'] },
    )

    await waitFor(() => expect(loadPage).toHaveBeenCalled())
    const request = loadPage.mock.calls[0]![0] as CommissionPageRequest
    expect(request.offset).toBe(20)
    expect(request.limit).toBe(10)
    expect(request.sort).toEqual({ id: 'commission', direction: 'desc' })
    expect(request.statuses).toEqual(['confirmed'])
  })

  it('hides commission values and drill-through for read-only projections', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValue({ ok: true as const, data: page({ canViewCommissions: false, canDrillThrough: false }) })
    renderTab(loadPage)

    await waitFor(() => expect(screen.getByText('Ana Souza')).toBeInTheDocument())
    expect(screen.queryByText('Comissão')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('link', { name: /pedido de origem/i })).toHaveLength(0)
    // Sales remain visible for read-only users.
    expect(screen.getByLabelText('Subtotal da página')).toHaveTextContent('R$ 1.500,25')
  })

  it('exposes drill-through links to permitted source orders', async () => {
    const loadPage = vi.fn().mockResolvedValue({ ok: true as const, data: page() })
    renderTab(loadPage)

    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: /pedido de origem/i })).toHaveLength(2),
    )
  })

  it('shows an accessible empty state when no commissions exist in the period', async () => {
    const loadPage = vi.fn().mockResolvedValue({
      ok: true as const,
      data: page({ rows: [], totalRows: 0 }),
    })
    renderTab(loadPage)

    await waitFor(() => expect(screen.getByText('Nenhuma comissão no período')).toBeInTheDocument())
  })

  it('shows an accessible error state with retry when the query fails', async () => {
    const loadPage = vi.fn().mockRejectedValue(new Error('boom'))
    renderTab(loadPage)

    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o relatório de comissões.')).toBeInTheDocument(),
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled()
  })

  it('shows the loading state while the first page is in flight', async () => {
    const loadPage = vi.fn().mockReturnValue(new Promise(() => undefined))
    renderTab(loadPage)

    expect(screen.getByText('Carregando dados…')).toBeInTheDocument()
  })
})
