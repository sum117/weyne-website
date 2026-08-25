import { z } from 'zod'
import {
  BUSINESS_TIME_ZONE,
  type CivilDate,
  resolveAsOfExclusive,
  resolveInactivityFloor,
} from './metric-contracts'
import { boundedPageSchema } from './bounds'

/**
 * Canonical contracts for the two Phase-2 insight surfaces:
 *
 * - **Price history** ("Histórico de preços", PDF p.4 §11 / p.5 §16) —
 *   effective catalog prices over time and the four required price-list
 *   comparisons.
 * - **Inactive clients** ("Clientes sem compra", PDF p.3 §10 / p.4 §11).
 *
 * These contracts extend — never redefine — the vocabulary in
 * `./metric-contracts.ts` (sales date, statuses, cancellation, timezone,
 * half-open boundaries, active/inactive client). Any semantics not stated
 * here are inherited verbatim from that module and from
 * `docs/domain/reporting-metric-contract.md`.
 *
 * ## Effective price (normative)
 *
 * A product's **effective price** for a price list at an instant is the
 * `amount` of the single `product_prices` row whose validity interval
 * `[valid_from, valid_to)` contains the instant. The append-only interval
 * table IS the history (`docs/domain/canonical-glossary-er-model.md` §192):
 * there is no separate `price_history` source. Half-open intervals mean an
 * instant that is exactly a prior row's `valid_to` resolves to the next row,
 * never to both or neither.
 *
 * **No price** — if no interval covers the instant, the product/list pair has
 * no effective price: it is absent from results, never rendered as zero,
 * null-amount row, or inherited neighbor value.
 *
 * **Realized price visibility** — historical *effective* prices follow the
 * catalog projection of `docs/domain/role-permission-matrix.md` §3/§4:
 * `admin` sees them for ALL; `representative` sees current prices needed to
 * quote (ACTIVE_CATALOG) and realized line snapshots only inside OWN_ASSIGNED
 * documents; `read_only` receives no amounts (O-class fields only). The
 * change-audit fields `reason`, `createdByUserId`, and `endedByUserId` on
 * price rows are admin-only (W/F2-adjacent), matching the matrix rule that
 * audit justifications stay with `audit.view`.
 *
 * ## The four price-list comparisons (normative)
 *
 * `price_lists` admits exactly four lists (`PRICE_1..PRICE_4`). The canonical
 * comparison set is fixed, not combinatorial (6 unordered pairs would invite
 * dashboard sprawl without a business question behind it):
 *
 * | id            | meaning                                   |
 * |---------------|-------------------------------------------|
 * | `p1_vs_p2`    | adjacent gap between lists 1 and 2        |
 * | `p2_vs_p3`    | adjacent gap between lists 2 and 3        |
 * | `p3_vs_p4`    | adjacent gap between lists 3 and 4        |
 * | `spread_1_4`  | full-range spread between lists 1 and 4   |
 *
 * A comparison is computed only when BOTH sides have an effective price at
 * the same instant; otherwise that product contributes no comparison row.
 * Gap sign convention: `higherListAmount − lowerListAmount`; list order is
 * by `position`, so "higher" means the greater `position`. No ranking,
 * score, churn, or predictive field exists anywhere in these contracts.
 */

// ---------------------------------------------------------------------------
// Inactive-client threshold
// ---------------------------------------------------------------------------

/** Minimum allowed inactivity window in days (inclusive). */
export const MIN_INACTIVE_DAYS = 1

/** Maximum allowed inactivity window in days (inclusive). */
export const MAX_INACTIVE_DAYS = 365

/**
 * Default inactivity window in civil days. Mirrors the fixture in
 * `docs/domain/reporting-metric-contract.md` (`inactiveDays = 90`).
 */
export const DEFAULT_INACTIVE_DAYS = 90

/**
 * Parses and validates the inactivity threshold supplied by URL filter /
 * query input. Boundary behavior per the metric contract: a client whose
 * latest non-cancelled order falls exactly ON the floor instant stays ACTIVE
 * (the floor is an inclusive lower edge; inactivity requires strictly older
 * activity). Out-of-range values are validation errors — never silently
 * clamped — because clamping would misreport the business question being
 * asked.
 */
export const inactiveDaysSchema = z.coerce
  .number()
  .int()
  .min(MIN_INACTIVE_DAYS)
  .max(MAX_INACTIVE_DAYS)
  .default(DEFAULT_INACTIVE_DAYS)

export type InactiveDays = z.output<typeof inactiveDaysSchema>

/**
 * Compiles validated threshold + as-of into the canonical boundary instants.
 * `floorInclusive` is the last instant that still counts as active;
 * `asOfExclusive` excludes anything at or after the end of the as-of day.
 * Enforces the same allowed range as {@link inactiveDaysSchema} so callers
 * that bypass URL parsing cannot smuggle an unvalidated threshold through.
 */
export function resolveInactiveWindow(
  asOf: CivilDate,
  inactiveDays: number,
  timeZone: string = BUSINESS_TIME_ZONE,
): Readonly<{ floorInclusive: Date; asOfExclusive: Date }> {
  const parsed = inactiveDaysSchema.safeParse(inactiveDays)
  if (!parsed.success) {
    throw new RangeError(
      `inactiveDays must be an integer between ${MIN_INACTIVE_DAYS} and ${MAX_INACTIVE_DAYS}`,
    )
  }
  return Object.freeze({
    floorInclusive: resolveInactivityFloor(asOf, parsed.data, timeZone),
    asOfExclusive: resolveAsOfExclusive(asOf, timeZone),
  })
}

// ---------------------------------------------------------------------------
// Insight filters (URL contract)
// ---------------------------------------------------------------------------

const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function civilDateSchema() {
  return z.string().regex(CIVIL_DATE_PATTERN, 'must be an ISO civil date')
}

/**
 * Shared filter shape for both insight surfaces. All parameters are
 * allowlisted and coerced here — raw search params never reach SQL.
 * Unknown keys are ignored by the caller's parser; known-but-invalid values
 * surface validation errors instead of silent defaults where the value
 * changes the business answer (dates, threshold), while enum-ish filters
 * fall back to their documented default.
 */
export const insightFiltersSchema = z.object({
  /** Inclusive as-of civil date (business time zone interpretation). */
  asOf: civilDateSchema(),
  timeZone: z.string().default(BUSINESS_TIME_ZONE),
  limit: boundedPageSchema.shape.limit,
})

export type InsightFilters = z.output<typeof insightFiltersSchema>

/** Price-history-specific filters, layered over the shared shape. */
export const priceHistoryFiltersSchema = insightFiltersSchema.extend({
  /** Restrict to one industry; absent means all industries. */
  industryId: z.string().uuid().optional(),
  /** Restrict to one product; absent means all products. */
  productId: z.string().uuid().optional(),
  /**
   * Which of the four canonical comparisons to include. Empty/absent means
   * ALL four — never "none", so an empty URL can't render a silently
   * empty comparison panel.
   */
  comparisons: z
    .array(
      z.enum(['p1_vs_p2', 'p2_vs_p3', 'p3_vs_p4', 'spread_1_4'] as const),
    )
    .max(4)
    .default([]),
})

export type PriceHistoryFilters = z.output<typeof priceHistoryFiltersSchema>

/** Inactive-client-specific filters, layered over the shared shape. */
export const inactiveClientsFiltersSchema = insightFiltersSchema.extend({
  inactiveDays: inactiveDaysSchema,
  /** Restrict to one representative's book; admin-only parameter. */
  representativeId: z.string().uuid().optional(),
  /**
   * Include clients that have NEVER purchased. Default true per the
   * reporting contract (directory-driven inactive report).
   */
  includeNeverPurchased: z.coerce.boolean().default(true),
})

export type InactiveClientsFilters = z.output<typeof inactiveClientsFiltersSchema>

// ---------------------------------------------------------------------------
// Drill-through identifiers
// ---------------------------------------------------------------------------

/**
 * Stable drill-through targets. Every insight row carries enough identity to
 * deep-link into an existing accessible surface WITHOUT widening scope:
 * drill-through re-evaluates authorization on the destination page — an
 * insight link never grants access by itself.
 */
export type DrillThroughTarget =
  | Readonly<{ kind: 'product'; productId: string }>
  | Readonly<{
      kind: 'price-change';
      productId: string
      priceListId: string
      /** Identity of the ended interval row (drill key, not exposed data). */
      priceRowId: string
    }>
  | Readonly<{ kind: 'client'; clientId: string }>
  | Readonly<{
      kind: 'client-orders';
      clientId: string
      /** Echoed so the destination can restore the report context. */
      asOf: CivilDate
      inactiveDays: number
    }>

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** Exact decimal money string (six scale), per the reporting contract. */
export type MoneyString = string

/** One effective-price observation for a product/list at a point in time. */
export type EffectivePricePoint = Readonly<{
  productId: string
  priceListId: string
  amount: MoneyString
  currencyCode: 'BRL'
  validFrom: Date
  /** `null` = still-current interval (open-ended `[valid_from, ∞)`). */
  validTo: Date | null
}>

/** One row of the four-comparison grid. */
export type PriceComparisonRow = Readonly<{
  comparison: 'p1_vs_p2' | 'p2_vs_p3' | 'p3_vs_p4' | 'spread_1_4'
  productId: string
  lowerPositionListId: string
  higherPositionListId: string
  lowerAmount: MoneyString
  higherAmount: MoneyString
  /** Higher − lower, exact decimal; sign carries direction. */
  gapAmount: MoneyString
  currencyCode: 'BRL'
}>

/** One row of the inactive-client insight. */
export type InactiveClientRow = Readonly<{
  clientId: string
  /** Display name resolved from the CURRENT directory (may be archived). */
  displayName: string
  /**
   * `null` for never-purchased clients; otherwise the sales date (instant)
   * of the most recent non-cancelled order inside the actor's visibility.
   */
  lastPurchaseAt: Date | null
  /** Whole days of inactivity relative to `asOf`; 0 when never purchased. */
  daysInactive: number
  /** True when the client has no non-cancelled order before `asOf`. */
  neverPurchased: boolean
}>

// ---------------------------------------------------------------------------
// Sorting + pagination contracts
// ---------------------------------------------------------------------------

/** Allowlisted sort keys; anything else is rejected before SQL sees it. */
export const priceHistorySortKeys = [
  'productId',
  'comparison',
  'gapAmount',
] as const
export const priceHistorySortSchema = z.object({
  key: z.enum(priceHistorySortKeys),
  direction: z.enum(['asc', 'desc']),
})
export type PriceHistorySort = z.output<typeof priceHistorySortSchema>

export const inactiveClientsSortKeys = [
  'daysInactive',
  'displayName',
] as const
export const inactiveClientsSortSchema = z.object({
  key: z.enum(inactiveClientsSortKeys),
  direction: z.enum(['asc', 'desc']),
})
export type InactiveClientsSort = z.output<typeof inactiveClientsSortSchema>

/**
 * Deterministic tie-breaking appended after every user-chosen sort key:
 * business keys first, then the driving row's unique id ascending — the
 * exact rule declared by `describeDeterministicOrdering()` in `./bounds.ts`.
 */
export const PRICE_HISTORY_TIEBREAK = ['product_id asc', 'id asc'] as const
export const INACTIVE_CLIENTS_TIEBREAK = ['client_id asc'] as const

// ---------------------------------------------------------------------------
// Role/field visibility rules (projection contract)
// ---------------------------------------------------------------------------

export type InsightRole = 'admin' | 'representative' | 'read_only'

/**
 * Field-level projection for insight payloads, derived from the F1/W rules
 * of `docs/domain/role-permission-matrix.md` §4. Applied server-side AFTER
 * row scoping (`analyticsVisibilityPredicate`); the UI may hide further but
 * never reveal more.
 */
export type InsightProjection = Readonly<{
  /** Effective/current catalog amounts. */
  amounts: boolean
  /** Comparison gaps (derived from amounts; hidden whenever amounts are). */
  comparisons: boolean
  /** Change reasons + creator/ender identities (audit-grade, admin-only). */
  changeAuditFields: boolean
  /** Client contact fields beyond name (never exposed on insight rows). */
  clientContactFields: boolean
}>

const PROJECTIONS: Record<InsightRole, InsightProjection> = Object.freeze({
  admin: Object.freeze({
    amounts: true,
    comparisons: true,
    changeAuditFields: true,
    clientContactFields: false,
  }),
  representative: Object.freeze({
    amounts: true,
    comparisons: true,
    changeAuditFields: false,
    clientContactFields: false,
  }),
  read_only: Object.freeze({
    amounts: false,
    comparisons: false,
    changeAuditFields: false,
    clientContactFields: false,
  }),
})

/** Returns the field projection for a role; fails closed on unknown roles. */
export function insightProjection(role: InsightRole): InsightProjection {
  return PROJECTIONS[role]
}

// ---------------------------------------------------------------------------
// Empty-result language (pt-BR presentation contract)
// ---------------------------------------------------------------------------

/**
 * Canonical pt-BR empty-state copy. Reports must use these strings verbatim
 * rather than improvising, so every surface says the same thing when a
 * filter legitimately selects nothing (which is a valid state, distinct
 * from validation errors, which remain errors).
 */
export type InsightEmptyMessageKey =
  | 'priceHistory'
  | 'priceComparisons'
  | 'inactiveClients'

export const INSIGHT_EMPTY_MESSAGES = {
  priceHistory: 'Nenhuma variação de preço encontrada para os filtros selecionados.',
  priceComparisons: 'Sem preços efetivos suficientes para comparar neste período.',
  inactiveClients: 'Nenhum cliente inativo encontrado para os filtros selecionados.',
} as const satisfies Record<InsightEmptyMessageKey, string>

/**
 * Resolves the canonical empty-state message for a surface. Validation
 * failures never route through this function — they throw before any query.
 */
export function resolveInsightEmptyMessage(
  key: InsightEmptyMessageKey,
): string {
  return INSIGHT_EMPTY_MESSAGES[key]
}
