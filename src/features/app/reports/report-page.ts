import {
  MAX_REPORT_PAGE_SIZE,
  type ReportPageRequest,
} from './report-state'
import type { ReportMetricSnapshot } from './report-metrics'

/**
 * Pure projection of a canonical {@link ReportMetricSnapshot} into one
 * server-paginated, server-sorted sales report page. Lives beside the canonical
 * contracts and never fetches: the caller supplies the snapshot loaded by
 * `report-metrics.server.ts`, so aggregation never happens over a full client
 * download and page windows stay bounded by `MAX_REPORT_PAGE_SIZE`.
 */

export const SALES_REPORT_GROUPINGS = [
  'clientes',
  'produtos',
  'industrias',
] as const

export type SalesReportGrouping = (typeof SALES_REPORT_GROUPINGS)[number]

export function isSalesReportGrouping(value: string): value is SalesReportGrouping {
  return (SALES_REPORT_GROUPINGS as readonly string[]).includes(value)
}

export type SalesReportRow = Readonly<{
  id: string
  label: string
  /** Null for groupings without an order-count semantic (produtos). */
  orderCount: number | null
  /** Null for groupings without a quantity semantic (clientes, industrias). */
  quantity: string | null
  byCurrency: readonly Readonly<{
    currencyCode: string
    totalAmount: string
  }>[]
}>

export type SalesReportTotal = Readonly<{
  currencyCode: string
  orderCount: number
  /** Present only on groupings that carry a quantity semantic. */
  quantity: string | null
  totalAmount: string
}>

export type SalesReportCommissionTotal = Readonly<{
  currencyCode: string
  commissionAmount: string
}>

export type SalesReportPage = Readonly<{
  grouping: SalesReportGrouping
  rows: readonly SalesReportRow[]
  rowCount: number
  /** Sums restricted to the rows returned on this page. */
  pageSubtotals: readonly SalesReportTotal[]
  /**
   * Canonical period totals for the active filters — the exact
   * `byCurrency` projection the dashboard uses, so the two surfaces
   * reconcile by construction.
   */
  overallTotals: readonly SalesReportTotal[]
  /**
   * Canonical commission totals; null when the actor's role redacts
   * commission figures (read_only).
   */
  overallCommissionTotals: readonly SalesReportCommissionTotal[] | null
}>

export type SalesReportPageRequest = Omit<ReportPageRequest, 'grouping'> & {
  readonly grouping: SalesReportGrouping
}

type SortKey = 'name' | 'orders' | 'quantity' | 'total'

const SORT_KEYS: Record<SalesReportGrouping, Record<string, SortKey>> = {
  clientes: { client: 'name', orders: 'orders', total: 'total' },
  produtos: { product: 'name', quantity: 'quantity', total: 'total' },
  industrias: { industry: 'name', orders: 'orders', total: 'total' },
}

const SCALE = 1_000_000

function numeric(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function scaledSum(values: readonly string[]): number {
  return values.reduce(
    (sum, value) => sum + Math.round(numeric(value) * SCALE),
    0,
  )
}

function formatScaled(scaled: number): string {
  return (scaled / SCALE).toFixed(6)
}

function rowTotal(row: SalesReportRow): number {
  return row.byCurrency.reduce(
    (sum, entry) => sum + numeric(entry.totalAmount),
    0,
  )
}

function sortValue(row: SalesReportRow, key: SortKey): string | number {
  switch (key) {
    case 'name':
      return row.label
    case 'orders':
      return row.orderCount ?? 0
    case 'quantity':
      return numeric(row.quantity ?? '0')
    default:
      return rowTotal(row)
  }
}

type ReportMetricSnapshotLike = Pick<
  ReportMetricSnapshot,
  'clients' | 'products' | 'industries' | 'byCurrency'
>

function normalizeRows(
  snapshot: ReportMetricSnapshotLike,
  grouping: SalesReportGrouping,
): SalesReportRow[] {
  if (grouping === 'clientes') {
    return snapshot.clients.map((client) => ({
      id: client.id,
      label: client.name,
      orderCount: client.orderCount,
      quantity: null,
      byCurrency: client.byCurrency.map(({ currencyCode, totalAmount }) => ({
        currencyCode,
        totalAmount,
      })),
    }))
  }
  if (grouping === 'produtos') {
    return snapshot.products.map((product) => ({
      id: product.id,
      label: product.name,
      orderCount: null,
      quantity: product.quantity,
      byCurrency: product.byCurrency.map(({ currencyCode, totalAmount }) => ({
        currencyCode,
        totalAmount,
      })),
    }))
  }
  return snapshot.industries.map((industry) => ({
    id: industry.id,
    label: industry.name,
    orderCount: industry.orderCount,
    quantity: null,
    byCurrency: industry.byCurrency.map(({ currencyCode, totalAmount }) => ({
      currencyCode,
      totalAmount,
    })),
  }))
}

function summarize(rows: readonly SalesReportRow[]): SalesReportTotal[] {
  const byCurrency = new Map<
    string,
    { orderCount: number; quantities: string[]; amounts: string[] }
  >()
  for (const row of rows) {
    for (const entry of row.byCurrency) {
      const bucket = byCurrency.get(entry.currencyCode) ?? {
        orderCount: 0,
        quantities: [],
        amounts: [],
      }
      bucket.orderCount += row.orderCount ?? 0
      bucket.amounts.push(entry.totalAmount)
      if (row.quantity !== null) bucket.quantities.push(row.quantity)
      byCurrency.set(entry.currencyCode, bucket)
    }
  }
  return [...byCurrency.keys()].sort().map((currencyCode) => {
    const bucket = byCurrency.get(currencyCode)!
    return {
      currencyCode,
      orderCount: bucket.orderCount,
      quantity:
        bucket.quantities.length === rows.length && bucket.quantities.length > 0
          ? formatScaled(scaledSum(bucket.quantities))
          : null,
      totalAmount: formatScaled(scaledSum(bucket.amounts)),
    }
  })
}

export function buildSalesReportPage(
  snapshot: ReportMetricSnapshotLike,
  request: SalesReportPageRequest,
): SalesReportPage {
  const rows = normalizeRows(snapshot, request.grouping)
  const sortKey: SortKey = request.sort
    ? (SORT_KEYS[request.grouping][request.sort.id] ?? 'name')
    : 'name'
  const direction = request.sort?.direction ?? 'asc'

  const sorted = rows.slice().sort((left, right) => {
    const leftValue = sortValue(left, sortKey)
    const rightValue = sortValue(right, sortKey)
    const compared =
      typeof leftValue === 'string' && typeof rightValue === 'string'
        ? leftValue.localeCompare(rightValue, 'pt-BR')
        : (leftValue as number) - (rightValue as number)
    return (compared || left.id.localeCompare(right.id)) *
      (direction === 'desc' ? -1 : 1)
  })

  const offset = Math.max(0, request.offset)
  const limit = Math.min(Math.max(1, request.limit), MAX_REPORT_PAGE_SIZE)
  const pageRows = sorted.slice(offset, offset + limit)

  const commissionRedacted = snapshot.byCurrency.every(
    (entry) => entry.commissionAmount === null,
  )

  return {
    grouping: request.grouping,
    rows: pageRows,
    rowCount: rows.length,
    pageSubtotals: summarize(pageRows),
    overallTotals: snapshot.byCurrency.map((entry) => ({
      currencyCode: entry.currencyCode,
      orderCount: entry.orderCount,
      quantity: null,
      totalAmount: entry.totalAmount,
    })),
    overallCommissionTotals: commissionRedacted
      ? null
      : snapshot.byCurrency.map((entry) => ({
          currencyCode: entry.currencyCode,
          commissionAmount: entry.commissionAmount ?? '0.000000',
        })),
  }
}
