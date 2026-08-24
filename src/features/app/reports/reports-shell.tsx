import { useMemo, type ChangeEvent, type ReactNode } from 'react'
import type {
  ColumnFiltersState,
  ColumnVisibilityState,
  OnChangeFn,
  PaginationState,
  SortingState,
  Updater,
} from '@tanstack/react-table'
import {
  createDataTableColumnHelper,
  DataTable,
  type DataTableColumnDef,
} from '@/components/data-table/data-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  parseReportSearch,
  serializeReportSearch,
  switchReportTab,
  type ReportSearchRecord,
  type ReportSearchState,
  type ReportStateConfig,
  type ReportTab,
} from './report-state'

export const REPORT_STATUS_OPTIONS = [
  { value: 'open', label: 'Aberto' },
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'invoiced', label: 'Faturado' },
  { value: 'completed', label: 'Concluído' },
  { value: 'cancelled', label: 'Cancelado' },
] as const

const TAB_LABELS: Record<ReportTab, string> = {
  clientes: 'Vendas por cliente',
  produtos: 'Vendas por produto',
  industrias: 'Vendas por indústria',
  comissoes: 'Comissões',
}

const TAB_CONFIG = {
  clientes: {
    sortableColumns: ['client', 'orders', 'total'],
    columns: ['client', 'orders', 'total'],
  },
  produtos: {
    sortableColumns: ['product', 'quantity', 'total'],
    columns: ['product', 'quantity', 'total'],
  },
  industrias: {
    sortableColumns: ['industry', 'orders', 'total'],
    columns: ['industry', 'orders', 'total'],
  },
  comissoes: {
    sortableColumns: ['representative', 'sales', 'commission'],
    columns: ['representative', 'sales', 'commission'],
  },
} as const

export type ReportCapabilities = {
  availableTabs: readonly ReportTab[]
  canFilterRepresentatives: boolean
}

export type ReportRepresentativeOption = {
  id: string
  label: string
}

export type ReportNavigate = (options: {
  search: (current: ReportSearchRecord) => ReportSearchRecord
  replace: false
}) => unknown

export type ReportShellContext = {
  state: ReportSearchState
  config: ReportStateConfig
  updatePagination: OnChangeFn<PaginationState>
  updateSorting: OnChangeFn<SortingState>
  updateColumnVisibility: OnChangeFn<ColumnVisibilityState>
}

export type ReportsShellProps = {
  search: ReportSearchRecord
  navigate: ReportNavigate
  today: string
  capabilities: ReportCapabilities
  representatives: readonly ReportRepresentativeOption[]
  tableState?: 'loading' | 'empty' | 'error'
  onRetry?: () => void
  renderReport?: (context: ReportShellContext) => ReactNode
}

type PlaceholderRow = {
  id: string
  client: string
  product: string
  industry: string
  representative: string
  orders: number
  quantity: number
  sales: string
  total: string
  commission: string
}

const columnHelper = createDataTableColumnHelper<PlaceholderRow>()
const placeholderColumns: Record<
  ReportTab,
  Array<DataTableColumnDef<PlaceholderRow>>
> = {
  clientes: columnHelper.columns([
    columnHelper.accessor('client', { header: 'Cliente' }),
    columnHelper.accessor('orders', { header: 'Pedidos' }),
    columnHelper.accessor('total', { header: 'Total' }),
  ]),
  produtos: columnHelper.columns([
    columnHelper.accessor('product', { header: 'Produto' }),
    columnHelper.accessor('quantity', { header: 'Quantidade' }),
    columnHelper.accessor('total', { header: 'Total' }),
  ]),
  industrias: columnHelper.columns([
    columnHelper.accessor('industry', { header: 'Indústria' }),
    columnHelper.accessor('orders', { header: 'Pedidos' }),
    columnHelper.accessor('total', { header: 'Total' }),
  ]),
  comissoes: columnHelper.columns([
    columnHelper.accessor('representative', { header: 'Representante' }),
    columnHelper.accessor('sales', { header: 'Vendas' }),
    columnHelper.accessor('commission', { header: 'Comissão' }),
  ]),
}

function resolveUpdater<T>(updater: Updater<T>, current: T) {
  return typeof updater === 'function'
    ? (updater as (value: T) => T)(current)
    : updater
}

function selectedValues(event: ChangeEvent<HTMLSelectElement>) {
  return Array.from(event.currentTarget.selectedOptions, (option) => option.value)
}

export function ReportsShell({
  search,
  navigate,
  today,
  capabilities,
  representatives,
  tableState = 'empty',
  onRetry,
  renderReport,
}: ReportsShellProps) {
  const config = useMemo<ReportStateConfig>(() => {
    const availableTabs = capabilities.availableTabs.length
      ? capabilities.availableTabs
      : (['clientes'] as const)
    return {
      defaultTab: availableTabs[0]!,
      availableTabs,
      defaultPageSize: 20,
      pageSizes: [10, 20, 50],
      maxPage: 10_000,
      maxDateRangeDays: 366,
      statuses: REPORT_STATUS_OPTIONS.map((option) => option.value),
      representativeIds: capabilities.canFilterRepresentatives
        ? representatives.map((representative) => representative.id)
        : [],
      tabs: TAB_CONFIG,
    }
  }, [
    capabilities.availableTabs,
    capabilities.canFilterRepresentatives,
    representatives,
  ])
  const state = useMemo(
    () => parseReportSearch(search, config, today),
    [config, search, today],
  )

  const navigateToState = (nextState: ReportSearchState) => {
    const nextSearch = serializeReportSearch(nextState, config, search)
    void navigate({ search: () => nextSearch, replace: false })
  }
  const resetPage = (nextState: ReportSearchState): ReportSearchState => ({
    ...nextState,
    pagination: { ...nextState.pagination, pageIndex: 0 },
  })
  const updatePagination: OnChangeFn<PaginationState> = (updater) => {
    navigateToState({
      ...state,
      pagination: resolveUpdater(updater, state.pagination),
    })
  }
  const updateSorting: OnChangeFn<SortingState> = (updater) => {
    navigateToState(
      resetPage({ ...state, sorting: resolveUpdater(updater, state.sorting) }),
    )
  }
  const updateColumnVisibility: OnChangeFn<ColumnVisibilityState> = (updater) => {
    navigateToState({
      ...state,
      columnVisibility: resolveUpdater(updater, state.columnVisibility),
    })
  }
  const updateFilters = (filters: ReportSearchState['filters']) => {
    const normalized = parseReportSearch(
      serializeReportSearch(
        resetPage({ ...state, filters }),
        config,
      ),
      config,
      today,
    )
    navigateToState(normalized)
  }

  const shellContext = {
    state,
    config,
    updatePagination,
    updateSorting,
    updateColumnVisibility,
  }

  return (
    <div className="min-h-0 bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1440px] space-y-6">
        <header className="space-y-2">
          <p className="text-sm font-semibold tracking-[0.14em] text-blue uppercase">
            Área de gestão
          </p>
          <h1 className="font-display text-3xl text-navy sm:text-4xl">Relatórios</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted sm:text-base">
            Consulte vendas e comissões com filtros compartilhados. Os resultados são
            paginados e ordenados no servidor.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
            <CardDescription>
              Períodos são limitados a 366 dias. Alterações ficam registradas na URL.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1.5 text-sm font-medium text-ink">
                Data inicial
                <Input
                  aria-label="Data inicial"
                  type="date"
                  max={today}
                  value={state.filters.from}
                  onChange={(event) =>
                    updateFilters({ ...state.filters, from: event.currentTarget.value })
                  }
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-ink">
                Data final
                <Input
                  aria-label="Data final"
                  type="date"
                  max={today}
                  value={state.filters.to}
                  onChange={(event) =>
                    updateFilters({ ...state.filters, to: event.currentTarget.value })
                  }
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-ink">
                Status
                <select
                  aria-label="Status"
                  multiple
                  value={state.filters.statuses}
                  onChange={(event) =>
                    updateFilters({
                      ...state.filters,
                      statuses: selectedValues(event),
                    })
                  }
                  className="min-h-12 w-full rounded-xl border border-input bg-white px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-baltic focus-visible:ring-4 focus-visible:ring-baltic/15"
                >
                  {REPORT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {capabilities.canFilterRepresentatives ? (
                <label className="space-y-1.5 text-sm font-medium text-ink">
                  Representantes
                  <select
                    aria-label="Representantes"
                    multiple
                    value={state.filters.representativeIds}
                    onChange={(event) =>
                      updateFilters({
                        ...state.filters,
                        representativeIds: selectedValues(event),
                      })
                    }
                    className="min-h-12 w-full rounded-xl border border-input bg-white px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-baltic focus-visible:ring-4 focus-visible:ring-baltic/15"
                  >
                    {representatives.map((representative) => (
                      <option key={representative.id} value={representative.id}>
                        {representative.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Tabs value={state.tab}>
          <TabsList aria-label="Tipos de relatório" className="w-full justify-start">
            {capabilities.availableTabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                onClick={() => navigateToState(switchReportTab(state, tab, config))}
              >
                {TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
          {capabilities.availableTabs.map((tab) => (
            <TabsContent key={tab} value={tab}>
              {tab === state.tab
                ? renderReport?.(shellContext) ?? (
                    <PlaceholderReportTable
                      context={shellContext}
                      tableState={tableState}
                      onRetry={onRetry}
                    />
                  )
                : null}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  )
}

function PlaceholderReportTable({
  context,
  tableState,
  onRetry,
}: {
  context: ReportShellContext
  tableState: 'loading' | 'empty' | 'error'
  onRetry?: () => void
}) {
  const { state } = context
  const columns = placeholderColumns[state.tab]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{TAB_LABELS[state.tab]}</CardTitle>
        <CardDescription>
          A tabela recebe somente a página solicitada; totais e linhas serão fornecidos
          pelas consultas canônicas do relatório.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          ariaLabel={TAB_LABELS[state.tab]}
          columns={columns}
          data={[]}
          rowCount={0}
          getRowId={(row) => row.id}
          pagination={state.pagination}
          onPaginationChange={context.updatePagination}
          sorting={state.sorting}
          onSortingChange={context.updateSorting}
          columnFilters={[] satisfies ColumnFiltersState}
          onColumnFiltersChange={() => undefined}
          columnVisibility={state.columnVisibility}
          onColumnVisibilityChange={context.updateColumnVisibility}
          rowSelection={{}}
          onRowSelectionChange={() => undefined}
          pageSizes={[10, 20, 50]}
          enableRowSelection={false}
          loading={tableState === 'loading'}
          error={tableState === 'error' ? 'Não foi possível carregar os dados.' : undefined}
          onRetry={onRetry}
          emptyTitle="Nenhum resultado"
          emptyDescription="Ajuste o período ou os filtros para ampliar a consulta."
        />
      </CardContent>
    </Card>
  )
}
