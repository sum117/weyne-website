# Shared TanStack Query provider

Use `AppQueryProvider` at the authenticated application boundary. It creates one stable `QueryClient` per mounted boundary, so server renders do not share cached data across requests and the browser client remains stable across rerenders.

```tsx
import type { ReactNode } from 'react'
import { AppQueryProvider } from '@/lib/query/app-query-provider'

export function AppBoundary({ children }: { children: ReactNode }) {
  return <AppQueryProvider>{children}</AppQueryProvider>
}
```

The shared defaults are explicit in `APP_QUERY_DEFAULTS`:

- Queries remain fresh for 30 seconds and unused cache entries are collected after 5 minutes.
- Queries retry twice, refetch after reconnecting, and do not refetch merely because the window regained focus.
- Mutations do not retry automatically because writes may not be idempotent.
- Query and mutation errors remain in their local state (`throwOnError: false`). A route may opt into an error boundary per operation, while global reporting can be installed with TanStack Query's typed `QueryCache` or `MutationCache` configuration.

Use `createAppQueryClient` when a boundary needs a supported TanStack Query override or hydration-owned client. The factory merges nested query and mutation options instead of discarding unrelated defaults:

```tsx
import { useState, type ReactNode } from 'react'
import {
  AppQueryProvider,
  createAppQueryClient,
} from '@/lib/query/app-query-provider'

export function AppBoundary({ children }: { children: ReactNode }) {
  const [client] = useState(() =>
    createAppQueryClient({
      defaultOptions: {
        queries: { staleTime: 60_000 },
      },
    }),
  )

  return <AppQueryProvider client={client}>{children}</AppQueryProvider>
}
```

Do not create a module-level `QueryClient` in server-rendered code: that would share cache state between requests. When server-prefetched data is introduced, create the client in the request boundary, dehydrate it there, and inject the matching browser client through the same `client` prop.
