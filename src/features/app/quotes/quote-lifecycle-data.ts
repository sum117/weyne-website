import type { QueryClient } from '@tanstack/react-query'

export interface QuoteLifecycleStatus {
  readonly code: string
  readonly label: string
}

export interface QuoteLifecycleSummary {
  readonly id: string
  readonly status: QuoteLifecycleStatus
  /** Opaque concurrency token returned by the server. */
  readonly version: string
}

export const quoteLifecycleKeys = {
  all: ['quotes'] as const,
  lists: () => [...quoteLifecycleKeys.all, 'list'] as const,
  list: (filters: Readonly<Record<string, unknown>>) =>
    [...quoteLifecycleKeys.lists(), filters] as const,
  details: () => [...quoteLifecycleKeys.all, 'detail'] as const,
  detail: (quoteId: string) =>
    [...quoteLifecycleKeys.details(), quoteId] as const,
}

/**
 * Reconciles the common list/detail projection immediately, then marks both
 * read models stale so server-derived fields and permissions are refreshed.
 */
export async function reconcileQuoteLifecycleCaches(
  queryClient: QueryClient,
  updated: QuoteLifecycleSummary,
): Promise<void> {
  queryClient.setQueryData<QuoteLifecycleSummary>(
    quoteLifecycleKeys.detail(updated.id),
    (current) => current ? { ...current, ...updated } : updated,
  )
  queryClient.setQueriesData<readonly QuoteLifecycleSummary[]>(
    { queryKey: quoteLifecycleKeys.lists() },
    (current) => current?.map((quote) =>
      quote.id === updated.id ? { ...quote, ...updated } : quote,
    ),
  )

  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: quoteLifecycleKeys.detail(updated.id),
      refetchType: 'none',
    }),
    queryClient.invalidateQueries({
      queryKey: quoteLifecycleKeys.lists(),
      refetchType: 'none',
    }),
  ])
}
