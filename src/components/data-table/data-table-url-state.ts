import { useCallback, useMemo } from 'react'
import type {
  ColumnFiltersState,
  OnChangeFn,
  PaginationState,
  SortingState,
  Updater,
} from '@tanstack/react-table'

export type DataTableSearchState = {
  pagination: PaginationState
  sorting: SortingState
  columnFilters: ColumnFiltersState
}

export type DataTableUrlOptions<
  TSortColumn extends string,
  TFilterColumn extends string,
> = {
  defaultPageSize: number
  pageSizes: readonly number[]
  sortableColumns: readonly TSortColumn[]
  filterColumns: readonly TFilterColumn[]
}

type SearchRecord = Record<string, unknown>

export type DataTableUrlNavigate = (options: {
  search: (current: SearchRecord) => SearchRecord
  replace: true
}) => unknown

function parsePositiveInteger(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseStringValues(value: unknown) {
  const values = Array.isArray(value) ? value : [value]
  return Array.from(
    new Set(
      values.filter(
        (candidate): candidate is string =>
          typeof candidate === 'string' && candidate.trim() !== '',
      ),
    ),
  )
}

export function parseDataTableSearch<
  TSortColumn extends string,
  TFilterColumn extends string,
>(
  search: SearchRecord,
  options: DataTableUrlOptions<TSortColumn, TFilterColumn>,
): DataTableSearchState {
  const page = parsePositiveInteger(search.page)
  const requestedPageSize = parsePositiveInteger(search.pageSize)
  const pageSize =
    requestedPageSize && options.pageSizes.includes(requestedPageSize)
      ? requestedPageSize
      : options.defaultPageSize

  const sorting: SortingState = []
  if (typeof search.sort === 'string') {
    const match = /^([^.]+)\.(asc|desc)$/.exec(search.sort)
    if (
      match &&
      options.sortableColumns.includes(match[1] as TSortColumn)
    ) {
      sorting.push({ id: match[1] as string, desc: match[2] === 'desc' })
    }
  }

  const columnFilters = options.filterColumns.flatMap((id) => {
    const values = parseStringValues(search[id])
    return values.length > 0 ? [{ id, value: values }] : []
  })

  return {
    pagination: { pageIndex: (page ?? 1) - 1, pageSize },
    sorting,
    columnFilters,
  }
}

export function serializeDataTableSearch<
  TSortColumn extends string,
  TFilterColumn extends string,
>(
  state: DataTableSearchState,
  options: DataTableUrlOptions<TSortColumn, TFilterColumn>,
  currentSearch: SearchRecord = {},
): SearchRecord {
  const nextSearch = { ...currentSearch }

  delete nextSearch.page
  delete nextSearch.pageSize
  delete nextSearch.sort
  for (const id of options.filterColumns) delete nextSearch[id]

  if (state.pagination.pageIndex > 0) {
    nextSearch.page = state.pagination.pageIndex + 1
  }
  if (state.pagination.pageSize !== options.defaultPageSize) {
    nextSearch.pageSize = state.pagination.pageSize
  }

  const firstSort = state.sorting[0]
  if (firstSort && options.sortableColumns.includes(firstSort.id as TSortColumn)) {
    nextSearch.sort = `${firstSort.id}.${firstSort.desc ? 'desc' : 'asc'}`
  }

  for (const filter of state.columnFilters) {
    if (!options.filterColumns.includes(filter.id as TFilterColumn)) continue
    const values = parseStringValues(filter.value)
    if (values.length > 0) nextSearch[filter.id] = values
  }

  return nextSearch
}

function resolveUpdater<T>(updater: Updater<T>, current: T) {
  return typeof updater === 'function'
    ? (updater as (value: T) => T)(current)
    : updater
}

function stableSearchValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSearchValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as SearchRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, stableSearchValue(nestedValue)]),
    )
  }
  return value
}

export function dataTableSearchEquals(
  left: SearchRecord,
  right: SearchRecord,
) {
  return JSON.stringify(stableSearchValue(left)) === JSON.stringify(stableSearchValue(right))
}

export function useDataTableUrlState<
  TSortColumn extends string,
  TFilterColumn extends string,
>(
  search: SearchRecord,
  navigate: DataTableUrlNavigate,
  options: DataTableUrlOptions<TSortColumn, TFilterColumn>,
) {
  const state = useMemo(
    () => parseDataTableSearch(search, options),
    [options, search],
  )

  const navigateWithState = useCallback(
    (update: (current: DataTableSearchState) => DataTableSearchState) => {
      const updateSearch = (currentSearch: SearchRecord) => {
        const currentState = parseDataTableSearch(currentSearch, options)
        const nextState = update(currentState)
        const nextSearch = serializeDataTableSearch(
          nextState,
          options,
          currentSearch,
        )
        return dataTableSearchEquals(nextSearch, currentSearch)
          ? currentSearch
          : nextSearch
      }

      if (updateSearch(search) === search) return
      void navigate({ search: updateSearch, replace: true })
    },
    [navigate, options, search],
  )

  const onPaginationChange: OnChangeFn<PaginationState> = useCallback(
    (updater) =>
      navigateWithState((current) => ({
        ...current,
        pagination: resolveUpdater(updater, current.pagination),
      })),
    [navigateWithState],
  )
  const onSortingChange: OnChangeFn<SortingState> = useCallback(
    (updater) =>
      navigateWithState((current) => ({
        ...current,
        pagination: { ...current.pagination, pageIndex: 0 },
        sorting: resolveUpdater(updater, current.sorting),
      })),
    [navigateWithState],
  )
  const onColumnFiltersChange: OnChangeFn<ColumnFiltersState> = useCallback(
    (updater) =>
      navigateWithState((current) => ({
        ...current,
        pagination: { ...current.pagination, pageIndex: 0 },
        columnFilters: resolveUpdater(updater, current.columnFilters),
      })),
    [navigateWithState],
  )

  return {
    ...state,
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
  }
}
