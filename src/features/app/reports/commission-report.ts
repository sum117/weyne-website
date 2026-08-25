/**
 * Pure contract for the commissions report tab (`/app/relatorios?tab=comissoes`).
 *
 * One canonical meaning of a commission row, reused by the SQL aggregation
 * layer (`commission-report.server.ts`), the UI tab, and the tests:
 *
 * - Scope: orders joined to their owning quote (`orders.source_quote_id` →
 *   `quotes.owner_user_id` is the earning representative), status not
 *   `cancelled`, `orders.created_at` inside the shared report date range
 *   (business timezone bounds resolved by `report-metrics`).
 * - Amounts: `orders.commission_amount` (immutable conversion-time snapshot,
 *   verified by the commission-facts adapter) and
 *   `orders.commission_basis_amount`; both DECIMAL(19,6) strings. No
 *   recomputation happens here — aggregation only sums stored facts.
 * - Visibility: identical to the canonical metric owner predicate in
 *   `report-metrics.server.ts` (admin = all, representative = own quotes,
 *   read_only = explicitly assigned representatives only).
 *
 * Everything in this module is deterministic and DOM-free so the page math
 * (subtotals, page counts, authorization projection) is unit-testable without
 * a database.
 */

export const COMMISSION_SORTABLE_COLUMNS = [
  'representative',
  'orders',
  'sales',
  'commission',
] as const

export type CommissionSortColumn = (typeof COMMISSION_SORTABLE_COLUMNS)[number]

export type CommissionSortDirection = 'asc' | 'desc'

export const MAX_COMMISSION_PAGE_SIZE = 50

export type CommissionRole = 'admin' | 'representative' | 'read_only'

export type CommissionPageRequest = Readonly<{
  offset: number
  limit: number
  sort: { id: CommissionSortColumn; direction: CommissionSortDirection } | null
  from: string
  to: string
  timeZone: string
  statuses: readonly string[]
  representativeIds: readonly string[]
  role: CommissionRole
  actorRepresentativeId: string | null
  explicitlyAssignedRepresentativeIds: readonly string[]
}>

/** One grouped row: the earning representative within the filtered period. */
export type CommissionRow = Readonly<{
  representativeId: string
  representativeName: string
  orderCount: number
  salesAmount: string
  commissionAmount: string
  currencyCode: string
  /** Present only for roles permitted drill-through to source orders. */
  sourceOrderIds: readonly string[] | null
}>

export type CommissionTotals = Readonly<{
  orderCount: number
  salesAmount: string
  commissionAmount: string
}>

export type CommissionPage = Readonly<{
  rows: readonly CommissionRow[]
  /** Subtotal across exactly the rows on this page. */
  pageSubtotal: CommissionTotals
  /** Canonical overall totals for the full filtered scope (all pages). */
  overallTotals: CommissionTotals
  totalRows: number
  offset: number
  limit: number
  currencyCode: string
  /** Server-evaluated: commission columns may be rendered. */
  canViewCommissions: boolean
  /** Server-evaluated: drill-through links may be rendered. */
  canDrillThrough: boolean
}>

export type CommissionAccessDecision = Readonly<{
  /**
   * Whether the actor may see commission values at all. Mirrors the canonical
   * metric rule: read_only roles never see commission figures.
   */
  canViewCommissions: boolean
  /**
   * Whether the actor may open drill-through links to source orders.
   * Representatives drill into their own orders only; read_only users with
   * assignments may open assigned orders; admins may open anything.
   */
  canDrillThrough: boolean
  /** Representative ids the actor is allowed to filter by; null = unrestricted. */
  filterableRepresentativeIds: readonly string[] | null
}>

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export class CommissionRequestError extends TypeError {}

function requireIsoDate(value: string, field: string): string {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new CommissionRequestError(`${field} must be an ISO date`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new CommissionRequestError(`${field} must be a valid ISO date`)
  }
  return value
}

/**
 * The time zone is interpolated into `AT TIME ZONE ${...}` in the SQL layer
 * (parameterized, but still an identifier-like value), so only genuine IANA
 * zone names may pass — the same rule `report-metrics` enforces for the
 * sales reports.
 */
function requireIanaTimeZone(value: string): string {
  const candidate = typeof value === 'string' ? value.trim() : ''
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate })
  } catch {
    throw new CommissionRequestError('timeZone must be a valid IANA time zone')
  }
  return candidate
}

/**
 * Validates and bounds a raw page request coming from the URL state.
 * Mirrors the shared shell caps (`MAX_REPORT_PAGE_SIZE`, 10,000 pages).
 */
export function normalizeCommissionRequest(
  input: Readonly<{
    offset: number
    limit: number
    sort: { id: string; direction: string } | null
    from: string
    to: string
    timeZone: string
    statuses: readonly string[]
    representativeIds: readonly string[]
    role: string
    actorRepresentativeId: string | null
    explicitlyAssignedRepresentativeIds: readonly string[]
  }>,
): CommissionPageRequest {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit), MAX_COMMISSION_PAGE_SIZE))
  const maxOffsetPages = 10_000
  const offset = Math.max(0, Math.min(Math.trunc(input.offset), maxOffsetPages * limit))

  const from = requireIsoDate(input.from, 'from')
  const to = requireIsoDate(input.to, 'to')
  if (from > to) {
    throw new CommissionRequestError('from must not be after to')
  }

  const sort =
    input.sort &&
    (COMMISSION_SORTABLE_COLUMNS as readonly string[]).includes(input.sort.id) &&
    (input.sort.direction === 'asc' || input.sort.direction === 'desc')
      ? {
          id: input.sort.id as CommissionSortColumn,
          direction: input.sort.direction as CommissionSortDirection,
        }
      : null

  if (input.role !== 'admin' && input.role !== 'representative' && input.role !== 'read_only') {
    throw new CommissionRequestError('role is invalid')
  }

  const actorRepresentativeId = input.actorRepresentativeId?.trim() || null
  if (input.role === 'representative' && !actorRepresentativeId) {
    throw new CommissionRequestError(
      'actorRepresentativeId is required for representative commission reports',
    )
  }

  return {
    offset,
    limit,
    sort,
    from,
    to,
    timeZone: requireIanaTimeZone(input.timeZone),
    statuses: [...new Set(input.statuses)],
    representativeIds: [...new Set(input.representativeIds)],
    role: input.role,
    actorRepresentativeId,
    explicitlyAssignedRepresentativeIds: [...input.explicitlyAssignedRepresentativeIds],
  }
}

/**
 * Server-evaluated capability projection. The UI receives this and never
 * decides authorization itself; read-only users can view the report but get
 * commission values withheld and no mutation controls anywhere.
 */
export function resolveCommissionAccess(
  request: CommissionPageRequest,
): CommissionAccessDecision {
  if (request.role === 'admin') {
    return {
      canViewCommissions: true,
      canDrillThrough: true,
      filterableRepresentativeIds: null,
    }
  }
  if (request.role === 'representative') {
    return {
      canViewCommissions: true,
      canDrillThrough: true,
      filterableRepresentativeIds: [request.actorRepresentativeId!],
    }
  }
  return {
    canViewCommissions: false,
    canDrillThrough: request.explicitlyAssignedRepresentativeIds.length > 0,
    filterableRepresentativeIds: [...request.explicitlyAssignedRepresentativeIds],
  }
}

/**
 * Restricts requested representative filters to the actor's authorized scope.
 * Denied values are dropped (never leaked), matching the shell's behavior of
 * rejecting denied representative URL values.
 */
export function scopeRepresentativeFilter(
  request: CommissionPageRequest,
): readonly string[] | null {
  const access = resolveCommissionAccess(request)
  if (access.filterableRepresentativeIds === null) {
    return request.representativeIds.length > 0 ? request.representativeIds : null
  }
  const allowed = new Set(access.filterableRepresentativeIds)
  const scoped = request.representativeIds.filter((id) => allowed.has(id))
  return scoped.length > 0 ? scoped : access.filterableRepresentativeIds
}

function addAmounts(left: string, right: string): string {
  // Exact decimal addition on 6-decimal strings; avoids float drift between
  // page subtotal and overall totals rendered from the same source values.
  const scale = 6
  const toUnits = (value: string) => {
    const negative = value.startsWith('-')
    const [whole = '0', fraction = ''] = value.replace('-', '').split('.')
    const padded = fraction.padEnd(scale, '0').slice(0, scale)
    const units = BigInt(whole) * 10n ** BigInt(scale) + BigInt(padded || '0')
    return negative ? -units : units
  }
  const sum = toUnits(left) + toUnits(right)
  const negative = sum < 0n
  const absolute = negative ? -sum : sum
  const whole = absolute / 10n ** BigInt(scale)
  const fraction = (absolute % 10n ** BigInt(scale)).toString().padStart(scale, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

/** Sums a money column across rows (page subtotal calculation). */
export function sumCommissionColumn(
  rows: readonly CommissionRow[],
  column: 'salesAmount' | 'commissionAmount',
): string {
  return rows.reduce((total, row) => addAmounts(total, row[column]), '0.000000')
}

export function sumCommissionOrders(rows: readonly CommissionRow[]): number {
  return rows.reduce((total, row) => total + row.orderCount, 0)
}

/**
 * Builds the final page projection from server rows. Commission values are
 * withheld for roles without `canViewCommissions` — the rows still render
 * (read-only users can see who sold and how much), but commission columns
 * resolve to null and must not be rendered by the UI.
 */
export function buildCommissionPage(input: Readonly<{
  rows: readonly CommissionRow[]
  overallTotals: CommissionTotals
  totalRows: number
  offset: number
  limit: number
  currencyCode: string
  canViewCommissions: boolean
  canDrillThrough: boolean
}>): CommissionPage {
  const rows = input.rows.map((row) => ({
    ...row,
    commissionAmount: input.canViewCommissions ? row.commissionAmount : '0.000000',
    sourceOrderIds: input.canDrillThrough ? row.sourceOrderIds : null,
  }))

  const pageSubtotal: CommissionTotals = {
    orderCount: sumCommissionOrders(rows),
    salesAmount: sumCommissionColumn(rows, 'salesAmount'),
    commissionAmount: input.canViewCommissions
      ? sumCommissionColumn(rows, 'commissionAmount')
      : '0.000000',
  }

  return {
    rows,
    pageSubtotal,
    overallTotals: input.overallTotals,
    totalRows: input.totalRows,
    offset: input.offset,
    limit: input.limit,
    currencyCode: input.currencyCode,
    canViewCommissions: input.canViewCommissions,
    canDrillThrough: input.canDrillThrough,
  }
}

/** Stable SQL ORDER BY term for a sort request; deterministic tiebreaker included. */
export function commissionSortTerm(
  sort: CommissionPageRequest['sort'],
): 'representative' | 'orders' | 'sales' | 'commission' {
  return sort?.id ?? 'commission'
}
