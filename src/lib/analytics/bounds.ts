/**
 * Bounded-list contracts shared by every analytics list/top-N surface.
 *
 * Acceptance rule: the analytics layer exposes no unbounded list operation.
 * Every bounded result declares a maximum page size, always fetches one row
 * beyond the page to detect continuation, and orders by a deterministic key
 * ending in a unique tie-breaker so pagination is stable under concurrent
 * inserts.
 */

import { z } from 'zod'

/** Hard ceiling for any analytics page or top-N result. */
export const MAX_ANALYTICS_PAGE_SIZE = 100

/** Default page size when a caller does not choose one. */
export const DEFAULT_ANALYTICS_PAGE_SIZE = 25

/**
 * Shared bounded pagination shape. `limit` is coerced and clamped at the
 * validation boundary; repositories fetch `limit + 1` and return at most
 * `limit` items plus an opaque `nextCursor`.
 */
export const boundedPageSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_ANALYTICS_PAGE_SIZE)
    .default(DEFAULT_ANALYTICS_PAGE_SIZE),
})

export type BoundedPage = z.output<typeof boundedPageSchema>

export type BoundedListOutput<Item> = Readonly<{
  items: readonly Item[]
  /** Opaque continuation token; `null` marks the final page. */
  nextCursor: string | null
}>

/**
 * Validates that a sort direction is allowlisted before any SQL sees it.
 * Direction tokens never travel from client input into a query string.
 */
export const sortDirectionSchema = z.enum(['asc', 'desc'])
export type SortDirection = z.output<typeof sortDirectionSchema>

export function assertBoundedLimit(limit: number, surface: string): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ANALYTICS_PAGE_SIZE) {
    throw new RangeError(
      `${surface} page size must be an integer between 1 and ${MAX_ANALYTICS_PAGE_SIZE}`,
    )
  }
}

/**
 * Deterministic ordering contract for bounded analytics results. Every list
 * orders by a declared business key first and by the row's unique `id` last,
 * so equal keys never shuffle between pages and keyset predicates are total.
 * `id` must be the primary-key column of the driving table (uuid); it is the
 * tie-breaker, never a client-visible ranking criterion.
 */
export type TieBreakDirection = 'asc' | 'desc'

export function describeDeterministicOrdering(
  keys: readonly string[],
  direction: TieBreakDirection = 'desc',
): readonly { key: string; direction: TieBreakDirection }[] {
  if (keys.length === 0) {
    throw new TypeError('Deterministic ordering requires at least one key')
  }
  return Object.freeze([
    ...keys.map((key) => Object.freeze({ key, direction })),
    Object.freeze({ key: 'id', direction: 'asc' as const }),
  ])
}
