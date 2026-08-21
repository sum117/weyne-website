import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnFiltersState, RowSelectionState } from '@tanstack/react-table'
import {
  createDataTableColumnHelper,
  DataTable,
  type DataTableColumnDef,
} from '@/components/data-table/data-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  buildCommissionPage,
  resolveCommissionAccess,
  sumCommissionColumn,
  sumCommissionOrders,
  type CommissionPage,
  type CommissionPageRequest,
  type CommissionRow,
} from './commission-report'
import type { ReportShellContext } from './reports-shell'

/**
 * Commissions tab for `/app/relatorios`.
 *
 * Renders one server-paginated row per earning representative. The page
 * receives a `loadPage` function (the authorized server operation) and the
 * shared shell context; it never fetches more than the requested page, and
 * all aggregation stays in the canonical SQL queries.
 *
 * Role behavior comes from the server-evaluated access projection:
 * - read_only users see the report without commission values or drill-through
 *   links (no mutation controls exist anywhere on this surface);
 * - representatives drill through to their own source orders only;
 * - admins drill through to any listed order.
 */

export const COMMISSIONS_TAB_LABEL = 'Comissões'

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function formatMoney(value: string): string {
  return currencyFormatter.format(Number(value))
}

type CommissionsTabProps = {
  context: ReportShellContext
  loadPage: (request: CommissionPageRequest) => Promise<
    | { ok: true; data: CommissionPage }
    | { ok: false; error: { message: string } }
  >
}

const columnHelper = createDataTableColumnHelper<CommissionRow>()

function requestFromContext(context: ReportShellContext): CommissionPageRequest {
  const { state, config } = context
  const sort = state.sorting[0]
  return {
    offset: state.pagination.pageIndex * state.pagination.pageSize,
    limit: state.pagination.pageSize,
    sort:
      sort && (config.tabs.comissoes.sortableColumns as readonly string[]).includes(sort.id)
        ? { id: sort.id as 'representative', direction: sort.desc ? 'desc' : 'asc' }
        : null,
    from: state.filters.from,
    to: state.filters.to,
    timeZone: 'America/Fortaleza',
    statuses: state.filters.statuses,
    representativeIds: state.filters.representativeIds,
    // The server re-derives the role from the authenticated actor; the client
    // value here is only a hint and is ignored by the endpoint.
    role: 'admin',
    actorRepresentativeId: null,
    explicitlyAssignedRepresentativeIds: [],
  }
}

export function CommissionsTab({ context, loadPage }: CommissionsTabProps) {
  const request = useMemo(() => requestFromContext(context), [context])
  const query = useQuery({
    queryKey: ['reports', 'comissoes', request],
    queryFn: () => loadPage(request),
    placeholderData: (previous) => previous,
  })

  const page = query.data?.ok ? query.data.data : null

  const columns = useMemo<DataTableColumnDef<CommissionRow>[]>(() => {
    const canViewCommissions = page?.canViewCommissions ?? false
    const canDrillThrough =
      page?.canDrillThrough === true &&
      page.rows.some((row) => row.sourceOrderIds && row.sourceOrderIds.length > 0)
    return columnHelper.columns([
      columnHelper.accessor('representativeName', {
        id: 'representative',
        header: 'Representante',
        enableSorting: false,
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor('orderCount', {
        id: 'orders',
        header: 'Pedidos',
        enableSorting: false,
        cell: (info) => info.getValue().toLocaleString('pt-BR'),
      }),
      columnHelper.accessor('salesAmount', {
        id: 'sales',
        header: 'Vendas',
        enableSorting: false,
        cell: (info) => formatMoney(info.getValue()),
      }),
      ...(canViewCommissions
        ? [
            columnHelper.accessor('commissionAmount', {
              id: 'commission',
              header: 'Comissão',
              enableSorting: false,
              cell: (info) => formatMoney(info.getValue()),
            }),
          ]
        : []),
      ...(canDrillThrough
        ? [
            columnHelper.display({
              id: 'drillthrough',
              header: 'Pedidos de origem',
              enableSorting: false,
              cell: ({ row }) => {
                const ids = row.original.sourceOrderIds ?? []
                if (ids.length === 0) return null
                return (
                  <span className="flex flex-wrap gap-1">
                    {ids.map((orderId) => (
                      <a
                        key={orderId}
                        href={`/app/pedidos/${orderId}`}
                        className="inline-flex min-h-6 items-center rounded-full border border-border px-2 text-xs font-medium text-blue underline-offset-2 hover:bg-paper focus-visible:ring-2 focus-visible:ring-blue focus-visible:outline-hidden"
                        aria-label={`Abrir pedido de origem ${orderId}`}
                      >
                        Pedido
                      </a>
                    ))}
                  </span>
                )
              },
            }),
          ]
        : []),
    ])
  }, [page])

  const tableState = query.isPending
    ? 'loading'
    : query.isError || (query.data && !query.data.ok)
      ? 'error'
      : page && page.rows.length === 0
        ? 'empty'
        : 'ready'

  const columnVisibility = useMemo(() => {
    const visibleIds = new Set(columns.map((column) => column.id))
    return Object.fromEntries(
      Object.entries(context.state.columnVisibility).filter(([id]) => visibleIds.has(id)),
    )
  }, [columns, context.state.columnVisibility])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{COMMISSIONS_TAB_LABEL}</CardTitle>
        <CardDescription>
          Uma linha por representante no período. Os totais gerais vêm das consultas
          canônicas do servidor; o subtotal cobre somente esta página.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tableState === 'ready' && page ? (
          <div
            role="status"
            aria-label="Totais do relatório de comissões"
            className="grid gap-3 rounded-xl border border-border bg-paper p-4 sm:grid-cols-3"
          >
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                Total geral — pedidos
              </p>
              <p className="text-lg font-semibold text-ink">
                {page.overallTotals.orderCount.toLocaleString('pt-BR')}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                Total geral — vendas
              </p>
              <p className="text-lg font-semibold text-ink">
                {formatMoney(page.overallTotals.salesAmount)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                Total geral — comissão
              </p>
              <p className="text-lg font-semibold text-ink">
                {formatMoney(page.overallTotals.commissionAmount)}
              </p>
            </div>
          </div>
        ) : null}

        <DataTable
          ariaLabel={COMMISSIONS_TAB_LABEL}
          columns={columns}
          data={page?.rows ? [...page.rows] : []}
          rowCount={page?.totalRows ?? 0}
          getRowId={(row) => row.representativeId}
          pagination={context.state.pagination}
          onPaginationChange={context.updatePagination}
          sorting={context.state.sorting}
          onSortingChange={context.updateSorting}
          columnFilters={[] satisfies ColumnFiltersState}
          onColumnFiltersChange={() => undefined}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={context.updateColumnVisibility}
          rowSelection={{} satisfies RowSelectionState}
          onRowSelectionChange={() => undefined}
          enableRowSelection={false}
          loading={tableState === 'loading'}
          error={
            tableState === 'error' ? 'Não foi possível carregar o relatório de comissões.' : undefined
          }
          onRetry={() => void query.refetch()}
          emptyTitle="Nenhuma comissão no período"
          emptyDescription="Ajuste o período ou os filtros para ampliar a consulta."
        />

        {tableState === 'ready' && page ? (
          <p
            aria-label="Subtotal da página"
            className="text-sm text-muted"
          >
            Subtotal da página ({page.rows.length}{' '}
            {page.rows.length === 1 ? 'linha' : 'linhas'}):{' '}
            {sumCommissionOrders(page.rows).toLocaleString('pt-BR')} pedidos ·{' '}
            {formatMoney(sumCommissionColumn(page.rows, 'salesAmount'))} em vendas
            {page.overallTotals.commissionAmount !== '0.000000'
              ? ` · ${formatMoney(sumCommissionColumn(page.rows, 'commissionAmount'))} em comissões`
              : ''}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Re-exported for tests that build pages without the database. */
export { buildCommissionPage, resolveCommissionAccess }
