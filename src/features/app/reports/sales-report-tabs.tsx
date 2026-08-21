'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  createDataTableColumnHelper,
  DataTable,
  type DataTableColumnDef,
} from '@/components/data-table/data-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toReportPageRequest } from './report-state'
import type { ReportShellContext } from './reports-shell'
import {
  isSalesReportGrouping,
  type SalesReportGrouping,
  type SalesReportPage,
  type SalesReportRow,
} from './report-page'

/**
 * Sales report tab tables (clientes / produtos / industrias). Data comes from
 * one authorized server function per render — never a full-dataset fetch and
 * never per-row follow-ups. Page subtotals and canonical overall totals are
 * rendered as separate, clearly labeled summaries so they cannot be confused.
 */

const TAB_TITLES = {
  clientes: 'Vendas por cliente',
  produtos: 'Vendas por produto',
  industrias: 'Vendas por indústria',
  comissoes: 'Comissões',
} as const

const TAB_DESCRIPTIONS = {
  clientes: 'Totais de pedidos por cliente no período filtrado.',
  produtos: 'Quantidade e totais por produto no período filtrado.',
  industrias: 'Pedidos e totais por indústria no período filtrado.',
  comissoes: '',
} as const

const currencyFormatters = new Map<string, Intl.NumberFormat>()

function formatMoney(currencyCode: string, value: string): string {
  let formatter = currencyFormatters.get(currencyCode)
  if (!formatter) {
    formatter = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currencyCode,
    })
    currencyFormatters.set(currencyCode, formatter)
  }
  const amount = Number(value)
  return formatter.format(Number.isFinite(amount) ? amount : 0)
}

function formatQuantity(value: string): string {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(amount)
    : value
}

type DrillThroughContext = Readonly<{
  /** Base href for permitted source sales records; null hides drill-through. */
  orderListHref: string | null
}>

export type SalesReportTabsProps = {
  context: ReportShellContext
  /** Server page loader; returns a public error result on failure. */
  loadPage: (request: {
    grouping: string
    offset: number
    limit: number
    sort: { id: string; direction: 'asc' | 'desc' } | null
    filters: {
      from: string
      to: string
      statuses: readonly string[]
      representativeIds: readonly string[]
    }
  }) => Promise<
    | { ok: true; data: SalesReportPage }
    | { ok: false; error: { message: string } }
  >
  drillThrough?: DrillThroughContext
}

function moneyCell(entries: SalesReportRow['byCurrency']) {
  if (entries.length === 0) return '—'
  return entries
    .map((entry) => formatMoney(entry.currencyCode, entry.totalAmount))
    .join(' · ')
}

function buildColumns(
  grouping: SalesReportGrouping,
  drillThrough: DrillThroughContext,
): Array<DataTableColumnDef<SalesReportRow>> {
  const helper = createDataTableColumnHelper<SalesReportRow>()
  const labelColumn =
    grouping === 'clientes'
      ? helper.accessor('label', {
          header: 'Cliente',
          cell: ({ row }) =>
            drillThrough.orderListHref ? (
              <a
                href={`${drillThrough.orderListHref}?clientId=${encodeURIComponent(row.original.id)}`}
                className="font-medium text-blue underline decoration-sand decoration-2 underline-offset-4 hover:text-navy"
              >
                {row.original.label}
              </a>
            ) : (
              row.original.label
            ),
        })
      : helper.accessor('label', {
          header: grouping === 'produtos' ? 'Produto' : 'Indústria',
        })

  const countOrQuantity =
    grouping === 'produtos'
      ? helper.accessor('quantity', {
          header: 'Quantidade',
          cell: ({ getValue }) => formatQuantity(getValue() ?? '0'),
        })
      : helper.accessor('orderCount', {
          header: 'Pedidos',
          cell: ({ row }) => {
            const count = row.original.orderCount ?? 0
            if (!drillThrough.orderListHref || count === 0) return count
            const search =
              grouping === 'clientes'
                ? `?clientId=${encodeURIComponent(row.original.id)}`
                : ''
            return (
              <a
                href={`${drillThrough.orderListHref}${search}`}
                className="text-blue underline decoration-sand decoration-2 underline-offset-4 hover:text-navy"
              >
                {count}
              </a>
            )
          },
        })

  return helper.columns([
    labelColumn,
    countOrQuantity,
    helper.accessor(
      (row) => row.byCurrency.map((entry) => entry.totalAmount).join('|'),
      {
        id: 'total',
        header: 'Total',
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {moneyCell(row.original.byCurrency)}
          </span>
        ),
      },
    ),
  ])
}

function TotalsTable({
  caption,
  rows,
  tone,
}: {
  caption: string
  rows: readonly {
    currencyCode: string
    orderCount: number
    quantity: string | null
    totalAmount: string
  }[]
  tone: 'page' | 'overall'
}) {
  if (rows.length === 0) return null
  return (
    <table className="w-full text-sm" aria-label={caption}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="px-3 py-2 text-left font-semibold">Moeda</th>
          <th scope="col" className="px-3 py-2 text-right font-semibold">Pedidos</th>
          <th scope="col" className="px-3 py-2 text-right font-semibold">
            {tone === 'page' ? 'Subtotal da página' : 'Total do período'}
          </th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((row) => (
          <tr key={row.currencyCode}>
            <td className="px-3 py-2">{row.currencyCode}</td>
            <td className="px-3 py-2 text-right">{row.orderCount}</td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              {formatMoney(row.currencyCode, row.totalAmount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function SalesReportTabs({
  context,
  loadPage,
  drillThrough = { orderListHref: null },
}: SalesReportTabsProps) {
  const { state } = context
  const grouping = state.tab

  const request = useMemo(() => {
    if (!isSalesReportGrouping(grouping)) return null
    return toReportPageRequest(state)
  }, [grouping, state])

  const query = useQuery({
    queryKey: ['sales-report-page', request],
    queryFn: async () => {
      if (!request) throw new Error('Agrupamento de relatório inválido.')
      const result = await loadPage(request)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    enabled: request !== null,
    placeholderData: (previous) => previous,
  })

  const columns = useMemo(
    () =>
      isSalesReportGrouping(grouping)
        ? buildColumns(grouping, drillThrough)
        : [],
    [drillThrough, grouping],
  )

  if (!isSalesReportGrouping(grouping) || !request) {
    return null
  }

  const page = query.data ?? null
  const tableState = query.isPending
    ? 'loading'
    : query.isError
      ? 'error'
      : page && page.rows.length === 0
        ? 'empty'
        : 'ready'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{TAB_TITLES[grouping]}</CardTitle>
        <CardDescription>{TAB_DESCRIPTIONS[grouping]}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <DataTable
          ariaLabel={TAB_TITLES[grouping]}
          columns={columns}
          data={page ? [...page.rows] : []}
          rowCount={page?.rowCount ?? 0}
          getRowId={(row) => row.id}
          pagination={state.pagination}
          onPaginationChange={context.updatePagination}
          sorting={state.sorting}
          onSortingChange={context.updateSorting}
          columnFilters={[]}
          onColumnFiltersChange={() => undefined}
          columnVisibility={state.columnVisibility}
          onColumnVisibilityChange={context.updateColumnVisibility}
          rowSelection={{}}
          onRowSelectionChange={() => undefined}
          enableRowSelection={false}
          loading={tableState === 'loading'}
          error={
            tableState === 'error'
              ? 'Não foi possível carregar os dados.'
              : undefined
          }
          onRetry={tableState === 'error' ? () => void query.refetch() : undefined}
          emptyTitle="Nenhum resultado"
          emptyDescription="Ajuste o período ou os filtros para ampliar a consulta."
        />

        {page && page.rows.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-paper p-3">
              <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                Subtotais desta página
              </p>
              <TotalsTable
                caption={`Subtotais da página atual — ${TAB_TITLES[grouping]}`}
                rows={page.pageSubtotals}
                tone="page"
              />
            </div>
            <div className="rounded-xl border border-blue/25 bg-baltic/5 p-3">
              <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-navy uppercase">
                Totais do período (todos os resultados filtrados)
              </p>
              <TotalsTable
                caption={`Totais canônicos do período — ${TAB_TITLES[grouping]}`}
                rows={page.overallTotals}
                tone="overall"
              />
              {page.overallCommissionTotals ? (
                <p className="mt-2 text-xs text-muted tabular-nums">
                  Comissões do período:{' '}
                  {page.overallCommissionTotals
                    .map((entry) =>
                      formatMoney(entry.currencyCode, entry.commissionAmount),
                    )
                    .join(' · ')}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  Comissões não disponíveis para o seu perfil de acesso.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
