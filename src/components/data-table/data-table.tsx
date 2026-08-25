import { useEffect, useMemo, type ReactNode } from 'react'
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table'
import {
  CaretDown,
  CaretUp,
  CaretUpDown,
  Columns,
  Funnel,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/cn'

export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
})

export type DataTableColumnDef<TData extends RowData> = ColumnDef<
  typeof dataTableFeatures,
  TData,
  unknown
>

export function createDataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<typeof dataTableFeatures, TData>()
}

export type DataTableFacet = {
  columnId: string
  label: string
  options: Array<{ label: string; value: string }>
}

export type DataTableBulkActionContext<TData> = {
  selectedRows: TData[]
  clearSelection: () => void
}

export type DataTableProps<TData extends RowData> = {
  ariaLabel: string
  columns: Array<DataTableColumnDef<TData>>
  data: TData[]
  rowCount: number
  getRowId: (row: TData) => string
  getRowLabel?: (row: TData) => string
  pagination: PaginationState
  onPaginationChange: OnChangeFn<PaginationState>
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>
  columnVisibility: ColumnVisibilityState
  onColumnVisibilityChange: OnChangeFn<ColumnVisibilityState>
  rowSelection: RowSelectionState
  onRowSelectionChange: OnChangeFn<RowSelectionState>
  onSelectedRowsChange?: (rows: TData[]) => void
  renderBulkActions?: (context: DataTableBulkActionContext<TData>) => ReactNode
  facets?: DataTableFacet[]
  pageSizes?: number[]
  enableRowSelection?: boolean
  loading?: boolean
  error?: ReactNode
  onRetry?: () => void
  emptyTitle?: string
  emptyDescription?: string
  className?: string
}

const controlledButtonClassName =
  'min-h-11 max-w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-ink shadow-none hover:translate-y-0 hover:bg-paper hover:shadow-none focus-visible:ring-blue'

export function DataTable<TData extends RowData>({
  ariaLabel,
  columns,
  data,
  rowCount,
  getRowId,
  getRowLabel,
  pagination,
  onPaginationChange,
  sorting,
  onSortingChange,
  columnFilters,
  onColumnFiltersChange,
  columnVisibility,
  onColumnVisibilityChange,
  rowSelection,
  onRowSelectionChange,
  onSelectedRowsChange,
  renderBulkActions,
  facets = [],
  pageSizes = [10, 20, 50],
  enableRowSelection = true,
  loading = false,
  error,
  onRetry,
  emptyTitle = 'Nenhum registro encontrado',
  emptyDescription = 'Não há dados para exibir com os critérios atuais.',
  className,
}: DataTableProps<TData>) {
  const selectionColumn = useMemo<DataTableColumnDef<TData>>(
    () => ({
      id: '__select',
      enableHiding: false,
      enableSorting: false,
      header: ({ table }) => {
        const allSelected = table.getIsAllPageRowsSelected()
        const someSelected = table.getIsSomePageRowsSelected()
        return (
          <Checkbox
            aria-label="Selecionar todas as linhas desta página"
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={(checked) =>
              table.toggleAllPageRowsSelected(Boolean(checked))
            }
          />
        )
      },
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Selecionar ${
            getRowLabel?.(row.original) ?? `linha ${row.index + 1}`
          }`}
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
        />
      ),
    }),
    [getRowLabel],
  )
  const tableColumns = useMemo(
    () => (enableRowSelection ? [selectionColumn, ...columns] : columns),
    [columns, enableRowSelection, selectionColumn],
  )

  const table = useTable({
    features: dataTableFeatures,
    columns: tableColumns,
    data,
    rowCount,
    getRowId,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    enableRowSelection,
    state: {
      pagination,
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
    onColumnVisibilityChange,
    onRowSelectionChange,
  })

  const selectedRows = useMemo(
    () => data.filter((row) => rowSelection[getRowId(row)]),
    [data, getRowId, rowSelection],
  )
  useEffect(() => {
    onSelectedRowsChange?.(selectedRows)
  }, [onSelectedRowsChange, selectedRows])

  const columnCount = table.getVisibleLeafColumns().length
  const pageCount = Math.max(table.getPageCount(), 1)
  const hasFilters = columnFilters.length > 0

  return (
    <section
      role="region"
      aria-label={ariaLabel}
      aria-busy={loading}
      className={cn('min-w-0 space-y-3', className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        {facets.map((facet) => {
          const filter = columnFilters.find(
            (candidate) => candidate.id === facet.columnId,
          )
          const selectedValues = new Set(
            Array.isArray(filter?.value) ? filter.value : [],
          )
          return (
            <DropdownMenu key={facet.columnId}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  className={controlledButtonClassName}
                  aria-label={`Filtrar por ${facet.label}`}
                >
                  <Funnel className="size-4" />
                  {facet.label}
                  {selectedValues.size > 0 ? (
                    <span className="rounded-full bg-blue px-1.5 text-xs text-white">
                      {selectedValues.size}
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>{facet.label}</DropdownMenuLabel>
                {facet.options.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={selectedValues.has(option.value)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => {
                      const nextValues = new Set(selectedValues)
                      if (checked) nextValues.add(option.value)
                      else nextValues.delete(option.value)
                      onColumnFiltersChange((current) => {
                        const withoutFacet = current.filter(
                          (candidate) => candidate.id !== facet.columnId,
                        )
                        return nextValues.size > 0
                          ? [
                              ...withoutFacet,
                              {
                                id: facet.columnId,
                                value: Array.from(nextValues),
                              },
                            ]
                          : withoutFacet
                      })
                    }}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}

        {hasFilters ? (
          <Button
            type="button"
            className={controlledButtonClassName}
            onClick={() => {
              onColumnFiltersChange([])
            }}
          >
            Limpar filtros
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              className={cn(controlledButtonClassName, 'ml-auto')}
              aria-label="Colunas"
            >
              <Columns className="size-4" />
              Colunas
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
            {table
              .getAllLeafColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    column.toggleVisibility(Boolean(checked))
                  }
                >
                  {typeof column.columnDef.header === 'string'
                    ? column.columnDef.header
                    : column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {selectedRows.length > 0 && renderBulkActions ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue/20 bg-baltic/10 p-3 text-sm text-ink"
        >
          <span>
            {selectedRows.length}{' '}
            {selectedRows.length === 1 ? 'linha selecionada' : 'linhas selecionadas'}
          </span>
          <div>
            {renderBulkActions({
              selectedRows,
              clearSelection: () => onRowSelectionChange({}),
            })}
          </div>
        </div>
      ) : null}

      <div className="max-w-full overflow-hidden rounded-xl border border-border bg-white">
        <Table aria-label={`${ariaLabel} — tabela`}>
          <TableHeader className="bg-paper">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted()
                  const label =
                    typeof header.column.columnDef.header === 'string'
                      ? header.column.columnDef.header
                      : header.column.id
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2"
                          aria-pressed={Boolean(sorted)}
                          aria-label={`Ordenar por ${label}${
                            sorted === 'asc'
                              ? ', crescente'
                              : sorted === 'desc'
                                ? ', decrescente'
                                : ''
                          }`}
                          onClick={() => header.column.toggleSorting()}
                        >
                          <table.FlexRender header={header} />
                          {sorted === 'asc' ? (
                            <CaretUp className="size-4" />
                          ) : sorted === 'desc' ? (
                            <CaretDown className="size-4" />
                          ) : (
                            <CaretUpDown className="size-4" />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <div
                    role="status"
                    aria-label="Carregando dados…"
                    aria-live="polite"
                    className="py-10 text-center text-muted"
                  >
                    Carregando dados…
                  </div>
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <div role="alert" className="space-y-3 py-10 text-center text-destructive">
                    <p>{error}</p>
                    {onRetry ? (
                      <Button type="button" onClick={onRetry}>
                        Tentar novamente
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <div role="status" aria-live="polite" className="space-y-1 py-10 text-center">
                    <p className="font-semibold text-ink">
                      {hasFilters ? 'Nenhum registro corresponde aos filtros' : emptyTitle}
                    </p>
                    <p className="text-sm text-muted">{emptyDescription}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <label className="flex items-center gap-2">
          Linhas por página
          <Select
            value={String(pagination.pageSize)}
            onValueChange={(value) =>
              onPaginationChange({ pageIndex: 0, pageSize: Number(value) })
            }
          >
            <SelectTrigger aria-label="Linhas por página" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <span aria-live="polite">
          Página {pagination.pageIndex + 1} de {pageCount}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            className={controlledButtonClassName}
            disabled={loading || !table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Página anterior
          </Button>
          <Button
            type="button"
            className={controlledButtonClassName}
            aria-label="Próxima página"
            disabled={loading || !table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Próxima página
          </Button>
        </div>
      </div>
    </section>
  )
}
