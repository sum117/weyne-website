import { useMemo, useState } from 'react'
import type {
  ColumnVisibilityState,
  RowSelectionState,
} from '@tanstack/react-table'
import {
  createDataTableColumnHelper,
  DataTable,
} from '@/components/data-table/data-table'
import {
  useDataTableUrlState,
  type DataTableUrlNavigate,
} from '@/components/data-table/data-table-url-state'
import { Button } from '@/components/ui/button'

type ExampleAccount = {
  id: string
  name: string
  status: 'active' | 'pending'
  region: 'northeast' | 'southeast'
}

const rows: ExampleAccount[] = [
  { id: 'account-1', name: 'Mercado Aurora', status: 'active', region: 'northeast' },
  { id: 'account-2', name: 'Hotel Horizonte', status: 'pending', region: 'southeast' },
]

const columnHelper = createDataTableColumnHelper<ExampleAccount>()
const columns = columnHelper.columns([
  columnHelper.accessor('name', { header: 'Conta' }),
  columnHelper.accessor('status', { header: 'Status' }),
  columnHelper.accessor('region', { header: 'Região' }),
])

const urlOptions = {
  defaultPageSize: 20,
  pageSizes: [10, 20, 50],
  sortableColumns: ['name', 'status'],
  filterColumns: ['status', 'region'],
} as const

export type DataTableExampleProps = {
  /** Pass the route's validated search object (for example, Route.useSearch()). */
  search: Record<string, unknown>
  /** Pass a small adapter around TanStack Router's navigate function. */
  navigate: DataTableUrlNavigate
  state?: 'ready' | 'loading' | 'empty' | 'error'
}

/**
 * Copyable integration example. The shared table owns no request or business
 * rules: the URL state below is the complete input a Query/API layer would use.
 */
export function DataTableExample({
  search,
  navigate,
  state = 'ready',
}: DataTableExampleProps) {
  const tableUrl = useDataTableUrlState(search, navigate, urlOptions)
  const [columnVisibility, setColumnVisibility] =
    useState<ColumnVisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const requestInput = useMemo(
    () => ({
      page: tableUrl.pagination.pageIndex + 1,
      pageSize: tableUrl.pagination.pageSize,
      sort: tableUrl.sorting,
      filters: tableUrl.columnFilters,
    }),
    [tableUrl.columnFilters, tableUrl.pagination, tableUrl.sorting],
  )

  return (
    <div className="space-y-4 rounded-xl bg-paper p-4">
      <output className="sr-only" aria-live="polite">
        Consulta atual: {JSON.stringify(requestInput)}
      </output>
      <DataTable
        ariaLabel="Exemplo de contas"
        columns={columns}
        data={state === 'ready' ? rows : []}
        rowCount={state === 'ready' ? 42 : 0}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        pagination={tableUrl.pagination}
        onPaginationChange={tableUrl.onPaginationChange}
        sorting={tableUrl.sorting}
        onSortingChange={tableUrl.onSortingChange}
        columnFilters={tableUrl.columnFilters}
        onColumnFiltersChange={tableUrl.onColumnFiltersChange}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        loading={state === 'loading'}
        error={state === 'error' ? 'Falha simulada ao carregar as contas.' : undefined}
        onRetry={() => undefined}
        facets={[
          {
            columnId: 'status',
            label: 'Status',
            options: [
              { label: 'Ativo', value: 'active' },
              { label: 'Pendente', value: 'pending' },
            ],
          },
          {
            columnId: 'region',
            label: 'Região',
            options: [
              { label: 'Nordeste', value: 'northeast' },
              { label: 'Sudeste', value: 'southeast' },
            ],
          },
        ]}
        renderBulkActions={({ selectedRows, clearSelection }) => (
          <Button
            type="button"
            className="rounded-lg bg-blue px-3 py-2 text-sm font-semibold text-white outline-hidden focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2"
            onClick={clearSelection}
          >
            Processar {selectedRows.length} selecionada(s)
          </Button>
        )}
      />
    </div>
  )
}
