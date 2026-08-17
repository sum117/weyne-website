/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ColumnFiltersState,
  ColumnVisibilityState,
  PaginationState,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table'
import {
  createDataTableColumnHelper,
  DataTable,
  type DataTableProps,
} from '@/components/data-table/data-table'
import {
  useDataTableUrlState,
  type DataTableUrlNavigate,
} from '@/components/data-table/data-table-url-state'

type Person = {
  id: string
  name: string
  status: 'active' | 'pending'
}

const people: Person[] = [
  { id: '1', name: 'Ana', status: 'active' },
  { id: '2', name: 'Bruno', status: 'pending' },
]

const columnHelper = createDataTableColumnHelper<Person>()
const columns = columnHelper.columns([
  columnHelper.accessor('name', { header: 'Nome' }),
  columnHelper.accessor('status', { header: 'Status' }),
])

afterEach(cleanup)

const urlOptions = {
  defaultPageSize: 20,
  pageSizes: [10, 20, 50],
  sortableColumns: ['name', 'status'],
  filterColumns: ['status'],
} as const

function ControlledTable(
  props: Partial<DataTableProps<Person>> & {
    onSelection?: (rows: Person[]) => void
  },
) {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] =
    useState<ColumnVisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  return (
    <DataTable
      ariaLabel="Pessoas"
      columns={columns}
      data={people}
      rowCount={2}
      getRowId={(row) => row.id}
      getRowLabel={(row) => row.name}
      pagination={pagination}
      onPaginationChange={setPagination}
      sorting={sorting}
      onSortingChange={setSorting}
      columnFilters={columnFilters}
      onColumnFiltersChange={setColumnFilters}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={setColumnVisibility}
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      onSelectedRowsChange={props.onSelection}
      {...props}
    />
  )
}

describe('DataTable', () => {
  it('renders accessible loading, empty, and error states', () => {
    const { rerender } = render(<ControlledTable loading data={[]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Carregando dados')
    expect(screen.getByRole('region', { name: 'Pessoas' })).toHaveAttribute(
      'aria-busy',
      'true',
    )

    rerender(<ControlledTable data={[]} rowCount={0} />)
    expect(screen.getByRole('status')).toHaveTextContent('Nenhum registro')

    const onRetry = vi.fn()
    rerender(
      <ControlledTable data={[]} error="Não foi possível carregar." onRetry={onRetry} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível carregar.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('updates controlled sorting and pagination for server requests', () => {
    render(<ControlledTable rowCount={30} />)

    const sortButton = screen.getByRole('button', { name: 'Ordenar por Nome' })
    expect(sortButton).toHaveAttribute('aria-pressed', 'false')
    sortButton.focus()
    fireEvent.click(sortButton)
    expect(sortButton).toHaveAttribute('aria-pressed', 'true')
    expect(sortButton).toHaveAccessibleName('Ordenar por Nome, crescente')

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }))
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument()
  })

  it('exposes selected row data to callers and bulk actions', () => {
    const onSelection = vi.fn()
    render(
      <ControlledTable
        onSelection={onSelection}
        renderBulkActions={({ selectedRows, clearSelection }) => (
          <button type="button" onClick={clearSelection}>
            Arquivar {selectedRows.length}
          </button>
        )}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Ana' }))

    expect(onSelection).toHaveBeenLastCalledWith([people[0]])
    expect(screen.getByRole('button', { name: 'Arquivar 1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar 1' }))
    expect(screen.queryByRole('button', { name: 'Arquivar 1' })).not.toBeInTheDocument()
  })

  it('supports faceted filters and column visibility with keyboard-operable controls', () => {
    render(
      <ControlledTable
        facets={[
          {
            columnId: 'status',
            label: 'Situação',
            options: [
              { label: 'Ativo', value: 'active' },
              { label: 'Pendente', value: 'pending' },
            ],
          },
        ]}
      />,
    )

    const facetTrigger = screen.getByRole('button', { name: 'Filtrar por Situação' })
    facetTrigger.focus()
    fireEvent.keyDown(facetTrigger, { key: 'Enter' })
    const menu = screen.getByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Ativo' }))
    expect(facetTrigger).toHaveTextContent('1')
    fireEvent.keyDown(menu, { key: 'Escape' })

    const columnsTrigger = screen.getByRole('button', { name: 'Colunas' })
    fireEvent.keyDown(columnsTrigger, { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Status' }))
    expect(screen.queryByRole('columnheader', { name: /Status/ })).not.toBeInTheDocument()
  })

  it('can disable row selection for read-only report tables', () => {
    render(<ControlledTable enableRowSelection={false} />)

    expect(screen.queryByRole('checkbox', { name: /Selecionar/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
  })

  it('applies rapid URL updates to current router search without losing unrelated state', () => {
    let currentSearch: Record<string, unknown> = { tab: 'overview' }
    const navigate = vi.fn<DataTableUrlNavigate>(({ search }) => {
      currentSearch = search(currentSearch)
    })

    function UrlHarness() {
      const state = useDataTableUrlState(currentSearch, navigate, urlOptions)
      return (
        <button
          type="button"
          onClick={() => {
            state.onPaginationChange((current) => ({
              ...current,
              pageIndex: current.pageIndex + 1,
            }))
            state.onPaginationChange((current) => ({
              ...current,
              pageIndex: current.pageIndex + 1,
            }))
          }}
        >
          Avançar duas páginas
        </button>
      )
    }

    render(<UrlHarness />)
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Avançar duas páginas' }),
      )
    })

    expect(currentSearch).toEqual({ tab: 'overview', page: 3 })
    expect(navigate).toHaveBeenCalledTimes(2)
  })
})
