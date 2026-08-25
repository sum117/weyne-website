import {
  QueryClient,
  QueryClientProvider,
  type DefaultOptions,
  type QueryClientConfig,
} from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

/**
 * Shared server-state policy for authenticated application surfaces.
 *
 * Errors remain in Query/Mutation state for local empty and error states;
 * routes may opt into error boundaries with a per-query `throwOnError` override.
 */
export const APP_QUERY_DEFAULTS = {
  queries: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 2,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    throwOnError: false,
  },
  mutations: {
    retry: 0,
    throwOnError: false,
  },
} satisfies DefaultOptions<Error>

/**
 * Creates one QueryClient for one rendering request or browser application.
 * Nested query and mutation overrides are merged with the shared defaults.
 */
export function createAppQueryClient(
  config: QueryClientConfig = {},
): QueryClient {
  return new QueryClient({
    ...config,
    defaultOptions: {
      ...APP_QUERY_DEFAULTS,
      ...config.defaultOptions,
      queries: {
        ...APP_QUERY_DEFAULTS.queries,
        ...config.defaultOptions?.queries,
      },
      mutations: {
        ...APP_QUERY_DEFAULTS.mutations,
        ...config.defaultOptions?.mutations,
      },
    },
  })
}

export interface AppQueryProviderProps {
  children: ReactNode
  /** Inject a request-scoped or preconfigured client when hydration requires it. */
  client?: QueryClient
}

/**
 * Installs a stable QueryClient without sharing cache state across SSR requests.
 */
export function AppQueryProvider({
  children,
  client: injectedClient,
}: AppQueryProviderProps) {
  const [client] = useState(() => injectedClient ?? createAppQueryClient())

  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}
