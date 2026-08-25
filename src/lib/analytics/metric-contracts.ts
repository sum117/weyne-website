import type { OrderStatus } from '@/lib/db/schema'

/**
 * Canonical analytics metric definitions for accepted orders.
 *
 * This module is the single authoritative vocabulary for every dashboard,
 * report, export, and commission consumer. One concept, one meaning, defined
 * once here and reused through the typed contracts below — never recomputed
 * ad hoc at each call site. The PostgreSQL-facing predicate builders live in
 * `predicates.server.ts` / `visibility.server.ts`; the bounded-list rules
 * live in `bounds.ts`.
 *
 * ## Metric definitions (normative)
 *
 * **Sales date** — `orders.created_at`, the instant the accepted order was
 * committed. Civil-date filters denote whole days in the business time zone
 * (`BUSINESS_TIME_ZONE`, `America/Fortaleza`) and compile to half-open
 * instant intervals `[midnight(from), midnight(to + 1 day))`. The upper
 * boundary instant is excluded, so a day filter never double-counts across
 * adjacent periods regardless of the database session time zone.
 *
 * **Included order statuses** — `open`, `confirmed`, `invoiced`,
 * `completed` (`INCLUDED_ORDER_STATUSES`). These are the only statuses that
 * contribute to counts and monetary aggregates.
 *
 * **Cancellation** — `cancelled` orders (`EXCLUDED_ORDER_STATUSES`) never
 * contribute to any aggregate. They remain in the source tables with their
 * stored projection untouched (the projection columns are immutable), and may
 * appear in audit/history surfaces, but every metric in this contract drops
 * them. Repeated cancellation requests have one effect and cannot duplicate
 * or resurrect an amount.
 *
 * **Monetary amount** — exact decimal strings, never IEEE-754 numbers.
 * Sales total is `orders.grand_total_amount`; commission basis is
 * `orders.commission_basis_amount` (net merchandise after discounts,
 * excluding freight and taxes); commission value is the projected
 * `orders.commission_amount` snapshotted at conversion from
 * `order_lines.commission_*_snapshot` values. Amounts are never summed
 * across currencies; every grouped result carries a `currencyCode` bucket
 * (persistence constrains orders to a single currency, `BRL`).
 *
 * **Refunds/discounts** — discounts are already inside the persisted totals
 * (line discounts plus the allocated general discount); there is no separate
 * refund flow in Phase 1, so no metric adjusts amounts post hoc. A cancelled
 * order is the only event that removes an amount from view, per the
 * cancellation rule above.
 *
 * **Null handling** — nullable monetary columns (`commissionRateSnapshot`,
 * `commissionValueAmountSnapshot` at line level) mean "not eligible", not
 * zero: lines whose commission source is `none` contribute nothing and are
 * not averaged as zero. Nullable filters (`carrierId`) match only when the
 * caller passes an explicit value; passing `null` never silently means
 * "all".
 *
 * **Commission eligibility** — a non-cancelled order is commission-eligible
 * when at least one line has `commissionSourceSnapshot <> 'none'`; its
 * eligible amount is the sum of line `commissionValueAmountSnapshot`
 * values, surfaced header-side as the projected `commission_amount`.
 * This is a *projected* figure: it asserts nothing about acquisition,
 * approval, receivables, beneficiary, payment, or reversal — those remain
 * undefined business decisions (docs/domain/project-pdf-requirements-inventory.md
 * §cancellation-reversal). Consumers must label the metric "projected
 * commission" until the business defines acquisition.
 *
 * **Quote state** — the source-of-truth lifecycle state is
 * `quotes.status` (`draft/sent/approved/rejected/expired/converted/
 * cancelled`). An accepted order implies its quote is `converted`;
 * analytics attributes every order to the originating quote's
 * `owner_user_id` (the representative), matching the reporting contract.
 *
 * **Open order state** — `status = 'open'`: created and not yet confirmed.
 * Open orders count toward sales volume; they are operational, not fiscal.
 *
 * **Active client** — a client with at least one non-cancelled order whose
 * sales date is before `asOf` (exclusive upper edge: end of the `asOf`
 * civil day). A client is *inactive* when their latest such order is
 * strictly older than `inactiveDays` before `asOf`, or when they have none.
 * Cancelled orders never reactivate a client.
 */

/** Business time zone for every civil-date interpretation. */
export const BUSINESS_TIME_ZONE = 'America/Fortaleza'

/** Statuses that contribute to analytics aggregates. */
export const INCLUDED_ORDER_STATUSES = [
  'open',
  'confirmed',
  'invoiced',
  'completed',
] as const satisfies readonly Exclude<OrderStatus, 'cancelled'>[]

/** Statuses preserved in source but excluded from every aggregate. */
export const EXCLUDED_ORDER_STATUSES = ['cancelled'] as const satisfies readonly 'cancelled'[]

export type IncludedOrderStatus = (typeof INCLUDED_ORDER_STATUSES)[number]

export type AnalyticsOrderStatus = OrderStatus

/** ISO civil date (`YYYY-MM-DD`). */
export type CivilDate = string

/** IANA time zone identifier (e.g. `America/Fortaleza`). */
export type IanaTimeZone = string

export type CivilDateRangeInput = Readonly<{
  /** First civil day, inclusive. */
  from: CivilDate
  /** Last civil day, inclusive. */
  to: CivilDate
  timeZone: IanaTimeZone
}>

export type InstantInterval = Readonly<{
  /** Half-open lower bound, inclusive. */
  fromInclusive: Date
  /** Half-open upper bound, exclusive. */
  toExclusive: Date
  timeZone: IanaTimeZone
}>

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function parseIsoDate(value: string, field: string): readonly [number, number, number] {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new TypeError(`${field} must be an ISO civil date (YYYY-MM-DD)`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const candidate = new Date(Date.UTC(year!, month! - 1, day!))
  if (candidate.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${field} must be a valid calendar date`)
  }
  return [year!, month!, day!]
}

function shiftIsoDate(value: string, days: number): string {
  const [year, month, day] = parseIsoDate(value, 'value')
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function assertIANATimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone })
  } catch {
    throw new TypeError(`timeZone must be a valid IANA time zone`)
  }
}

function zoneOffsetMillis(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const observedAsUtc = Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour),
    Number(value.minute),
    Number(value.second),
  )
  return observedAsUtc - instant.valueOf()
}

/** Local midnight of a civil day in a time zone, as a UTC instant. */
export function localMidnight(civilDate: CivilDate, timeZone: IanaTimeZone): Date {
  parseIsoDate(civilDate, 'civilDate')
  assertIANATimeZone(timeZone)
  const [year, month, day] = civilDate.split('-').map(Number)
  let instant = new Date(Date.UTC(year!, month! - 1, day!))
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instant = new Date(instant.valueOf() + Date.UTC(year!, month! - 1, day!) -
      (instant.valueOf() + zoneOffsetMillis(instant, timeZone)))
  }
  return instant
}

/**
 * Compiles an inclusive civil-date window into the canonical half-open
 * instant interval used by every analytics query. `from === to` selects
 * exactly that single civil day. Inverted ranges and invalid dates or zones
 * are validation errors — never silently swapped or clamped.
 */
export function resolveCivilDateRange(input: CivilDateRangeInput): InstantInterval {
  parseIsoDate(input.from, 'from')
  parseIsoDate(input.to, 'to')
  assertIANATimeZone(input.timeZone)
  if (input.from > input.to) {
    throw new RangeError('from must not be after to')
  }
  return Object.freeze({
    fromInclusive: localMidnight(input.from, input.timeZone),
    toExclusive: localMidnight(shiftIsoDate(input.to, 1), input.timeZone),
    timeZone: input.timeZone,
  })
}

/**
 * Exclusive upper edge for "as of" boundaries (active-client checks,
 * point-in-time snapshots): the end of the `asOf` civil day in the business
 * time zone. An order placed at any moment of the `asOf` day counts; an
 * order at the next day's midnight does not.
 */
export function resolveAsOfExclusive(asOf: CivilDate, timeZone: IanaTimeZone): Date {
  parseIsoDate(asOf, 'asOf')
  assertIANATimeZone(timeZone)
  return localMidnight(shiftIsoDate(asOf, 1), timeZone)
}

/**
 * Inclusive lower edge for inactivity windows: `asOf - inactiveDays` civil
 * days, at local midnight. A client whose latest non-cancelled order is
 * strictly before this instant is inactive per the metric contract.
 */
export function resolveInactivityFloor(
  asOf: CivilDate,
  inactiveDays: number,
  timeZone: IanaTimeZone,
): Date {
  if (!Number.isInteger(inactiveDays) || inactiveDays < 0) {
    throw new RangeError('inactiveDays must be a non-negative integer')
  }
  parseIsoDate(asOf, 'asOf')
  assertIANATimeZone(timeZone)
  return localMidnight(shiftIsoDate(asOf, -inactiveDays), timeZone)
}
