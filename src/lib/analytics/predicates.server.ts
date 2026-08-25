import { and, gte, inArray, lt, ne, sql, type SQL } from 'drizzle-orm'
import {
  EXCLUDED_ORDER_STATUSES,
  INCLUDED_ORDER_STATUSES,
  type CivilDateRangeInput,
  type InstantInterval,
  resolveCivilDateRange,
} from './metric-contracts'
import type { AnalyticsOrderStatus } from './metric-contracts'
import { orderLines, orders } from '@/lib/db/schema'

/**
 * Reusable PostgreSQL/Drizzle predicates for analytics queries over accepted
 * orders. Every function returns a parameterized Drizzle `SQL` fragment —
 * values travel as bound parameters, never as interpolated strings — and is
 * safe to combine with `and(...)` inside any repository query.
 *
 * Metric meanings (sales date, statuses, amounts, cancellation) are defined
 * once in `./metric-contracts.ts`; these builders are their executable form.
 */

export type DateRangeInput = CivilDateRangeInput | InstantInterval

function isInstantInterval(value: DateRangeInput): value is InstantInterval {
  return 'fromInclusive' in value
}

/** Accepts either a civil-date window or a pre-resolved instant interval. */
export function resolveDateRange(range: DateRangeInput): InstantInterval {
  if (isInstantInterval(range)) {
    if (
      Number.isNaN(range.fromInclusive.valueOf()) ||
      Number.isNaN(range.toExclusive.valueOf()) ||
      range.fromInclusive >= range.toExclusive
    ) {
      throw new RangeError('Instant interval must be ordered and valid')
    }
    return Object.freeze({ ...range })
  }
  return resolveCivilDateRange(range)
}

/**
 * Half-open sales-date window over `orders.created_at`
 * `[fromInclusive, toExclusive)`. The exclusive upper edge is what makes a
 * civil-day filter disjoint across adjacent periods.
 */
export function salesDatePredicate(range: DateRangeInput): SQL {
  const resolved = resolveDateRange(range)
  return and(
    gte(orders.createdAt, resolved.fromInclusive),
    lt(orders.createdAt, resolved.toExclusive),
  )!
}

/**
 * Status filter restricted to the reportable vocabulary. An empty selection
 * means "all included (non-cancelled) statuses" per the metric contract;
 * passing `cancelled` explicitly is a validation error because cancelled
 * orders never enter an aggregate.
 */
export function orderStatusPredicate(
  statuses: readonly AnalyticsOrderStatus[] = [],
): SQL {
  if (statuses.length === 0) {
    return inArray(orders.status, [...INCLUDED_ORDER_STATUSES])
  }
  const unique = [...new Set(statuses)]
  for (const status of unique) {
    if ((EXCLUDED_ORDER_STATUSES as readonly string[]).includes(status)) {
      throw new TypeError(
        'Cancelled orders are excluded from analytics; do not select them',
      )
    }
  }
  if (!unique.every((status) => (INCLUDED_ORDER_STATUSES as readonly string[]).includes(status))) {
    throw new TypeError('Status must be a reportable order status')
  }
  return inArray(orders.status, unique)
}

/**
 * Representative attribution. The live order schema has no representative
 * column; attribution flows through the originating quote's `owner_user_id`,
 * matching the reporting contract (`docs/domain/reporting-metric-contract.md`).
 * The predicate is emitted against `quotes.owner_user_id`, so the caller must
 * join `quotes q ON q.id = orders.source_quote_id` before applying it.
 */
export function representativePredicate(representativeIds: readonly string[]): SQL {
  const unique = [...new Set(representativeIds)]
  if (unique.length === 0) return sql`false`
  if (unique.some((id) => id.trim() === '')) {
    throw new TypeError('Representative IDs must be non-empty')
  }
  return inArray(sql`q.owner_user_id`, unique)
}

/** Client filter; empty selection means "no restriction". */
export function clientPredicate(clientIds: readonly string[]): SQL {
  const unique = [...new Set(clientIds)]
  if (unique.length === 0) return sql`true`
  if (unique.some((id) => id.trim() === '')) {
    throw new TypeError('Client IDs must be non-empty')
  }
  return inArray(orders.clientId, unique)
}

/**
 * Product / industry filters operate on line snapshots
 * (`order_lines.product_id`, `order_lines.product_industry_id`) so historical
 * rows never drift with the current catalog. They require joining `orderLines`
 * and are emitted against that table's columns.
 */
export function productPredicate(productIds: readonly string[]): SQL {
  const unique = [...new Set(productIds)]
  if (unique.length === 0) return sql`true`
  if (unique.some((id) => id.trim() === '')) {
    throw new TypeError('Product IDs must be non-empty')
  }
  return inArray(orderLines.productId, unique)
}

export function industryPredicate(industryIds: readonly string[]): SQL {
  const unique = [...new Set(industryIds)]
  if (unique.length === 0) return sql`true`
  if (unique.some((id) => id.trim() === '')) {
    throw new TypeError('Industry IDs must be non-empty')
  }
  return inArray(orderLines.productIndustryId, unique)
}

/**
 * Commission eligibility at header level: the order carries a projected
 * commission amount greater than zero from at least one eligible line.
 * Lines with source `none` contribute nothing (null semantics: "not
 * eligible", not zero), and cancelled orders are excluded by construction —
 * but callers must still apply `orderStatusPredicate()` so the rest of the
 * aggregate shares one status vocabulary.
 *
 * The comparison is numeric (`commission_amount <> 0`), not string equality,
 * because the column is `numeric(19,6)` and Drizzle binds strings for it.
 */
export function commissionEligiblePredicate(): SQL {
  return and(
    ne(orders.commissionAmount, sql`${0}`),
    ne(orders.status, 'cancelled'),
  )!
}
