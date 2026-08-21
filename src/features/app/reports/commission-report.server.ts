import { sql, type SQL } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import {
  buildCommissionPage,
  commissionSortTerm,
  resolveCommissionAccess,
  scopeRepresentativeFilter,
  type CommissionPage,
  type CommissionPageRequest,
  type CommissionRow,
} from './commission-report'

/**
 * PostgreSQL aggregation for the commissions report tab.
 *
 * Canonical contract (see `commission-report.ts`): one grouped row per
 * earning representative (`quotes.owner_user_id` over
 * `orders.source_quote_id`), non-cancelled orders inside the shared date
 * range. All aggregation happens in SQL — the page never loads source rows to
 * aggregate in JS, and each request issues exactly two bounded queries
 * (totals + page rows), so there is no N+1 and no full-data fetch.
 *
 * Commission facts are read from the immutable order snapshot columns
 * (`commission_amount`, `commission_basis_amount`), which the conversion-time
 * adapter verifies against the pure calculator; nothing is recomputed here.
 */

type Database = PostgresJsDatabase<Record<string, unknown>>

type CommissionGroupRow = Readonly<{
  representativeId: string
  representativeName: string
  orderCount: string | number
  salesAmount: string
  commissionAmount: string
  currencyCode: string
  sourceOrderIds: readonly string[] | null
}>

type CommissionTotalsRow = Readonly<{
  orderCount: string | number
  salesAmount: string
  commissionAmount: string
}>

async function queryRows<T>(
  database: { execute(query: SQL): PromiseLike<unknown> },
  query: SQL,
): Promise<T[]> {
  return (await database.execute(query)) as unknown as T[]
}

/** Same owner predicate as the canonical metric loader — single RBAC meaning. */
function ownerPredicate(request: CommissionPageRequest, alias: 'q' | 'latest_quote'): SQL {
  const column = sql.raw(`${alias}.owner_user_id`)
  if (request.role === 'admin') return sql`TRUE`
  if (request.role === 'representative') {
    return sql`${column} = ${request.actorRepresentativeId}`
  }
  if (request.explicitlyAssignedRepresentativeIds.length === 0) return sql`FALSE`
  return sql`${column} IN (${sql.join(
    request.explicitlyAssignedRepresentativeIds.map((id) => sql`${id}`),
    sql`, `,
  )})`
}

function statusPredicate(request: CommissionPageRequest): SQL {
  // Cancelled orders never contribute commissions regardless of filters.
  const base = sql`o.status <> 'cancelled'`
  if (request.statuses.length === 0) return base
  return sql`(${base} AND o.status IN (${sql.join(
    request.statuses.map((status) => sql`${status}`),
    sql`, `,
  )}))`
}

function representativePredicate(
  scopedIds: readonly string[] | null,
): SQL {
  if (scopedIds === null) return sql`TRUE`
  if (scopedIds.length === 0) return sql`FALSE`
  return sql`q.owner_user_id IN (${sql.join(
    scopedIds.map((id) => sql`${id}`),
    sql`, `,
  )})`
}

const SORT_TERMS = {
  representative: sql`representative_name`,
  orders: sql`order_count`,
  sales: sql`sales_amount`,
  commission: sql`commission_amount`,
} as const

export async function loadCommissionPage(
  database: Database,
  request: CommissionPageRequest,
): Promise<CommissionPage> {
  const access = resolveCommissionAccess(request)
  const scopedRepresentatives = scopeRepresentativeFilter(request)

  // Date bounds resolve in the business timezone exactly like the canonical
  // metrics loader: [from 00:00, to+1d 00:00) local instants.
  const bounds = await queryRows<{ fromInclusive: string; toExclusive: string }>(
    database,
    sql`
      SELECT
        (${request.from}::date AT TIME ZONE ${request.timeZone})::text AS "fromInclusive",
        ((${request.to}::date + INTERVAL '1 day') AT TIME ZONE ${request.timeZone})::text AS "toExclusive"
    `,
  )
  const fromInclusive = bounds[0]?.fromInclusive
  const toExclusive = bounds[0]?.toExclusive
  if (!fromInclusive || !toExclusive) {
    throw new RangeError('Unable to resolve report date bounds')
  }

  const scopeSql = sql`
    FROM orders o
    JOIN quotes q ON q.id = o.source_quote_id
    WHERE ${ownerPredicate(request, 'q')}
      AND ${statusPredicate(request)}
      AND o.created_at >= ${fromInclusive}::timestamptz
      AND o.created_at < ${toExclusive}::timestamptz
      AND ${representativePredicate(scopedRepresentatives)}
  `

  const totalsResult = await queryRows<CommissionTotalsRow>(database, sql`
    SELECT
      COUNT(*) AS "orderCount",
      COALESCE(SUM(o.grand_total_amount), 0)::text AS "salesAmount",
      ${access.canViewCommissions
        ? sql`COALESCE(SUM(o.commission_amount), 0)::text`
        : sql`'0.000000'`} AS "commissionAmount"
    ${scopeSql}
  `)

  const totals = totalsResult[0]
  if (!totals) throw new RangeError('Commission totals query returned no row')

  const sortTerm = SORT_TERMS[commissionSortTerm(request.sort)]
  const sortDirection = request.sort?.direction ?? 'desc'
  const pageSize = Math.max(1, Math.min(request.limit, 50))
  const offset = Math.max(0, request.offset)

  const groupRows = await queryRows<CommissionGroupRow>(database, sql`
    WITH scoped AS (
      SELECT
        q.owner_user_id AS "representativeId",
        q.owner_user_id AS "representativeName",
        o.id AS "orderId",
        o.grand_total_amount AS "salesAmount",
        ${access.canViewCommissions
          ? sql`o.commission_amount`
          : sql`NULL::numeric`} AS "commissionAmount",
        o.currency_code AS "currencyCode",
        ROW_NUMBER() OVER (
          PARTITION BY q.owner_user_id
          ORDER BY o.created_at DESC, o.id DESC
        ) AS "orderRecency"
      ${scopeSql}
    ),
    grouped AS (
      SELECT
        "representativeId",
        "representativeName",
        COUNT(*) AS "orderCount",
        SUM("salesAmount")::text AS "salesAmount",
        SUM("commissionAmount")::text AS "commissionAmount",
        MIN("currencyCode") AS "currencyCode",
        (
          SELECT array_agg("orderId" ORDER BY "orderRecency")
          FROM (
            SELECT "orderId", "orderRecency" FROM scoped s2
            WHERE s2."representativeId" = s1."representativeId"
            ORDER BY "orderRecency"
            LIMIT 5
          ) recent
        ) AS "sourceOrderIds"
      FROM scoped s1
      GROUP BY "representativeId", "representativeName"
    )
    SELECT * FROM grouped
    ORDER BY ${sortTerm} ${sql.raw(sortDirection === 'asc' ? 'ASC' : 'DESC')},
      "representativeId"
    OFFSET ${offset}
    LIMIT ${pageSize}
  `)

  const rows: CommissionRow[] = groupRows.map((row) => ({
    representativeId: row.representativeId,
    representativeName: row.representativeName,
    orderCount: Number(row.orderCount),
    salesAmount: row.salesAmount,
    commissionAmount: access.canViewCommissions ? (row.commissionAmount ?? '0.000000') : '0.000000',
    currencyCode: row.currencyCode,
    sourceOrderIds: access.canDrillThrough ? (row.sourceOrderIds ?? []) : null,
  }))

  return buildCommissionPage({
    rows,
    overallTotals: {
      orderCount: Number(totals.orderCount),
      salesAmount: totals.salesAmount,
      commissionAmount: totals.commissionAmount,
    },
    totalRows: Number(totals.orderCount),
    offset,
    limit: pageSize,
    currencyCode: rows[0]?.currencyCode ?? 'BRL',
    canViewCommissions: access.canViewCommissions,
    canDrillThrough: access.canDrillThrough,
  })
}
