import type {
  ColumnVisibilityState,
  PaginationState,
  SortingState,
} from '@tanstack/react-table'

export const REPORT_TABS = [
  'clientes',
  'produtos',
  'industrias',
  'comissoes',
] as const

export const MAX_REPORT_PAGE_SIZE = 50
export const MAX_REPORT_PAGE = 10_000

export type ReportTab = (typeof REPORT_TABS)[number]
export type ReportSearchRecord = Record<string, unknown>

type ReportTabConfig = {
  readonly sortableColumns: readonly string[]
  readonly columns: readonly string[]
}

export type ReportStateConfig = {
  readonly defaultTab: ReportTab
  readonly availableTabs?: readonly ReportTab[]
  readonly defaultPageSize: number
  readonly pageSizes: readonly number[]
  readonly maxPage: number
  readonly maxDateRangeDays: number
  readonly statuses: readonly string[]
  readonly representativeIds: readonly string[]
  readonly tabs: Record<ReportTab, ReportTabConfig>
}

export type ReportFilters = {
  from: string
  to: string
  statuses: string[]
  representativeIds: string[]
}

export type ReportSearchState = {
  tab: ReportTab
  filters: ReportFilters
  pagination: PaginationState
  sorting: SortingState
  columnVisibility: ColumnVisibilityState
}

export type ReportPageRequest = {
  grouping: ReportTab
  offset: number
  limit: number
  sort: { id: string; direction: 'asc' | 'desc' } | null
  filters: ReportFilters
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseIsoDate(value: unknown) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return undefined
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : value
}

function shiftUtcDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function parsePositiveInteger(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseAllowedValues(value: unknown, allowed: readonly string[]) {
  const candidates = Array.isArray(value) ? value : [value]
  return Array.from(
    new Set(
      candidates.filter(
        (candidate): candidate is string =>
          typeof candidate === 'string' && allowed.includes(candidate),
      ),
    ),
  )
}

function normalizeDateRange(
  rawFrom: unknown,
  rawTo: unknown,
  today: string,
  maxDateRangeDays: number,
) {
  const fallbackFrom = shiftUtcDays(today, -(maxDateRangeDays - 1))
  let from = parseIsoDate(rawFrom) ?? fallbackFrom
  let to = parseIsoDate(rawTo) ?? today

  if (from > to) [from, to] = [to, from]
  if (to > today) to = today
  if (from > today) from = today

  const earliestAllowed = shiftUtcDays(to, -(maxDateRangeDays - 1))
  if (from < earliestAllowed) from = earliestAllowed

  return { from, to }
}

export function parseReportSearch(
  search: ReportSearchRecord,
  config: ReportStateConfig,
  today: string,
): ReportSearchState {
  const availableTabs = config.availableTabs ?? REPORT_TABS
  const tab = availableTabs.includes(search.tab as ReportTab)
    ? (search.tab as ReportTab)
    : config.defaultTab
  const tabConfig = config.tabs[tab]
  const requestedPage = parsePositiveInteger(search.page) ?? 1
  const requestedPageSize = parsePositiveInteger(search.pageSize)
  const pageSize =
    requestedPageSize && config.pageSizes.includes(requestedPageSize)
      ? requestedPageSize
      : config.defaultPageSize
  const dateRange = normalizeDateRange(
    search.from,
    search.to,
    today,
    config.maxDateRangeDays,
  )

  const sorting: SortingState = []
  if (typeof search.sort === 'string') {
    const match = /^([^.]+)\.(asc|desc)$/.exec(search.sort)
    if (match?.[1] && tabConfig.sortableColumns.includes(match[1])) {
      sorting.push({ id: match[1], desc: match[2] === 'desc' })
    }
  }

  const visibleColumns = parseAllowedValues(search.columns, tabConfig.columns)
  const columnVisibility =
    visibleColumns.length === 0
      ? {}
      : Object.fromEntries(
          tabConfig.columns.map((column) => [column, visibleColumns.includes(column)]),
        )

  return {
    tab,
    filters: {
      ...dateRange,
      statuses: parseAllowedValues(search.status, config.statuses),
      representativeIds: parseAllowedValues(
        search.representative,
        config.representativeIds,
      ),
    },
    pagination: {
      pageIndex: Math.min(requestedPage, config.maxPage) - 1,
      pageSize,
    },
    sorting,
    columnVisibility,
  }
}

export function serializeReportSearch(
  state: ReportSearchState,
  config: ReportStateConfig,
  currentSearch: ReportSearchRecord = {},
): ReportSearchRecord {
  const next = { ...currentSearch }
  for (const key of [
    'tab',
    'from',
    'to',
    'status',
    'representative',
    'page',
    'pageSize',
    'sort',
    'columns',
  ]) {
    delete next[key]
  }

  if (state.tab !== config.defaultTab) next.tab = state.tab
  next.from = state.filters.from
  next.to = state.filters.to
  if (state.filters.statuses.length > 0) next.status = state.filters.statuses
  if (state.filters.representativeIds.length > 0) {
    next.representative = state.filters.representativeIds
  }
  if (state.pagination.pageIndex > 0) next.page = state.pagination.pageIndex + 1
  if (state.pagination.pageSize !== config.defaultPageSize) {
    next.pageSize = state.pagination.pageSize
  }
  const sort = state.sorting[0]
  if (sort && config.tabs[state.tab].sortableColumns.includes(sort.id)) {
    next.sort = `${sort.id}.${sort.desc ? 'desc' : 'asc'}`
  }

  const visibilityEntries = Object.entries(state.columnVisibility)
  if (visibilityEntries.length > 0) {
    const visibleColumns = config.tabs[state.tab].columns.filter(
      (column) => state.columnVisibility[column] !== false,
    )
    if (visibleColumns.length > 0) next.columns = visibleColumns
  }

  return next
}

export function switchReportTab(
  state: ReportSearchState,
  tab: ReportTab,
  config: ReportStateConfig,
): ReportSearchState {
  if (!REPORT_TABS.includes(tab) || !config.tabs[tab]) return state
  return {
    ...state,
    tab,
    pagination: { pageIndex: 0, pageSize: state.pagination.pageSize },
    sorting: [],
    columnVisibility: {},
  }
}

export function toReportPageRequest(state: ReportSearchState): ReportPageRequest {
  const sort = state.sorting[0]
  const limit = Math.max(1, Math.min(state.pagination.pageSize, MAX_REPORT_PAGE_SIZE))
  const pageIndex = Math.max(
    0,
    Math.min(state.pagination.pageIndex, MAX_REPORT_PAGE - 1),
  )
  return {
    grouping: state.tab,
    offset: pageIndex * limit,
    limit,
    sort: sort
      ? { id: sort.id, direction: sort.desc ? 'desc' : 'asc' }
      : null,
    filters: state.filters,
  }
}
