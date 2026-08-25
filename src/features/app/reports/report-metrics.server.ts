import { sql, type SQL } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import {
  buildReportMetrics,
  MAX_METRIC_SOURCE_ORDERS,
  type MetricClient,
  type MetricOrder,
  type MetricOrderStatus,
  type MetricRequest,
  type ReportMetricSnapshot,
} from './report-metrics'


type ReportOrderRow = Readonly<{
  id: string
  clientId: string
  representativeId: string
  occurredAt: Date | string
  status: string
  currencyCode: string
  totalAmount: string
  commissionAmount: string
}>

type ReportLineRow = Readonly<{
  orderId: string
  productId: string
  productName: string
  industryId: string
  industryName: string
  quantity: string
  totalAmount: string
}>

export type PostgresReportMetricInput = Readonly<{
  clients: readonly MetricClient[]
  request: MetricRequest
}>

async function rows<T>(
  database: { execute(query: SQL): PromiseLike<unknown> },
  query: SQL,
): Promise<T[]> {
  return (await database.execute(query)) as unknown as T[]
}

function ownerPredicate(request: MetricRequest): SQL {
  if (request.role === 'admin') return sql`TRUE`
  if (request.role === 'representative') {
    if (!request.actorRepresentativeId) {
      throw new TypeError('actorRepresentativeId is required for representative metrics')
    }
    return sql`q.owner_user_id = ${request.actorRepresentativeId}`
  }
  if (request.explicitlyAssignedRepresentativeIds.length === 0) return sql`FALSE`
  return sql`q.owner_user_id IN (${sql.join(
    request.explicitlyAssignedRepresentativeIds.map((id) => sql`${id}`),
    sql`, `,
  )})`
}

export async function loadPostgresReportMetrics<
  TSchema extends Record<string, unknown>,
>(
  database: PostgresJsDatabase<TSchema>,
  input: PostgresReportMetricInput,
): Promise<ReportMetricSnapshot> {
  const emptySnapshot = buildReportMetrics({
    clients: input.clients,
    orders: [],
    request: input.request,
  })
  const fromInclusive = emptySnapshot.period.fromInclusive
  const toExclusive = emptySnapshot.period.toExclusive
  const asOfSnapshot = buildReportMetrics({
    clients: [],
    orders: [],
    request: { ...input.request, from: input.request.asOf, to: input.request.asOf },
  })
  const asOfExclusive = asOfSnapshot.period.toExclusive
  const owner = ownerPredicate(input.request)

  const orderRows = await rows<ReportOrderRow>(database, sql`
    WITH scoped_orders AS (
      SELECT o.id
      FROM orders o
      JOIN quotes q ON q.id = o.source_quote_id
      WHERE ${owner}
        AND (
          (o.created_at >= ${fromInclusive}::timestamptz AND o.created_at < ${toExclusive}::timestamptz)
          OR o.id IN (
            SELECT DISTINCT ON (latest.client_id) latest.id
            FROM orders latest
            WHERE ${input.request.role === 'admin'
              ? sql`TRUE`
              : input.request.role === 'representative'
                ? sql`EXISTS (
                    SELECT 1 FROM quotes latest_quote
                    WHERE latest_quote.id = latest.source_quote_id
                      AND latest_quote.owner_user_id = ${input.request.actorRepresentativeId})`
                : input.request.explicitlyAssignedRepresentativeIds.length === 0
                  ? sql`FALSE`
                  : sql`EXISTS (
                    SELECT 1 FROM quotes latest_quote
                    WHERE latest_quote.id = latest.source_quote_id
                      AND latest_quote.owner_user_id IN (${sql.join(
                        input.request.explicitlyAssignedRepresentativeIds.map((id) => sql`${id}`),
                        sql`, `,
                      )}))`}
              AND latest.status <> 'cancelled'
              AND latest.created_at < ${asOfExclusive}::timestamptz
            ORDER BY latest.client_id, latest.created_at DESC, latest.id DESC
          )
        )
      LIMIT ${MAX_METRIC_SOURCE_ORDERS + 1}
    )
    SELECT
      o.id,
      o.client_id AS "clientId",
      q.owner_user_id AS "representativeId",
      o.created_at AS "occurredAt",
      o.status,
      o.currency_code AS "currencyCode",
      o.grand_total_amount AS "totalAmount",
      o.commission_amount AS "commissionAmount"
    FROM scoped_orders scoped
    JOIN orders o ON o.id = scoped.id
    JOIN quotes q ON q.id = o.source_quote_id
    ORDER BY o.created_at, o.id
  `)

  if (orderRows.length > MAX_METRIC_SOURCE_ORDERS) {
    throw new RangeError(
      `Metric source is limited to ${MAX_METRIC_SOURCE_ORDERS.toLocaleString('en-US')} orders`,
    )
  }

  const orderIds = orderRows.map((order) => order.id)
  const lineRows = orderIds.length === 0
    ? []
    : await rows<ReportLineRow>(database, sql`
        SELECT
          ol.order_id AS "orderId",
          ol.product_id AS "productId",
          ol.product_description AS "productName",
          ol.product_industry_id AS "industryId",
          ol.product_industry_name AS "industryName",
          ol.quantity,
          ol.line_total_amount AS "totalAmount"
        FROM order_lines ol
        WHERE ol.order_id IN (${sql.join(orderIds.map((id) => sql`${id}`), sql`, `)})
        ORDER BY ol.order_id, ol.line_number, ol.id
      `)

  const linesByOrder = new Map<string, ReportLineRow[]>()
  for (const line of lineRows) {
    const lines = linesByOrder.get(line.orderId) ?? []
    lines.push(line)
    linesByOrder.set(line.orderId, lines)
  }

  const orders: MetricOrder[] = orderRows.map((order) => ({
    id: order.id,
    clientId: order.clientId,
    representativeId: order.representativeId,
    occurredAt:
      order.occurredAt instanceof Date
        ? order.occurredAt.toISOString()
        : new Date(order.occurredAt).toISOString(),
    status: order.status as MetricOrderStatus,
    currencyCode: order.currencyCode,
    totalAmount: order.totalAmount,
    commissionAmount: order.commissionAmount,
    lines: (linesByOrder.get(order.id) ?? []).map((line) => ({
      productId: line.productId,
      productName: line.productName,
      industryId: line.industryId,
      industryName: line.industryName,
      quantity: line.quantity,
      totalAmount: line.totalAmount,
      currencyCode: order.currencyCode,
    })),
  }))

  return buildReportMetrics({ clients: input.clients, orders, request: input.request })
}
