import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  QueryClient,
  useQueryClient,
  type DefaultOptions,
} from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import {
  APP_QUERY_DEFAULTS,
  AppQueryProvider,
  createAppQueryClient,
} from '@/lib/query/app-query-provider'

function QueryClientProbe() {
  const client = useQueryClient()

  return createElement(
    'span',
    null,
    String(client.getDefaultOptions().queries?.staleTime),
  )
}

describe('shared TanStack Query configuration', () => {
  it('creates isolated clients with the documented defaults', () => {
    const firstClient = createAppQueryClient()
    const secondClient = createAppQueryClient()

    expect(firstClient).not.toBe(secondClient)
    expect(firstClient.getDefaultOptions()).toEqual(APP_QUERY_DEFAULTS)
    expect(firstClient.getDefaultOptions()).toEqual({
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
    } satisfies DefaultOptions<Error>)
  })

  it('merges query and mutation overrides without dropping other defaults', () => {
    const client = createAppQueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000,
          retry: false,
        },
        mutations: {
          retry: 1,
        },
      },
    })

    expect(client.getDefaultOptions()).toMatchObject({
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        throwOnError: false,
      },
      mutations: {
        retry: 1,
        throwOnError: false,
      },
    })
  })

  it('installs an injected client at a rendering boundary', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 1234 } },
    })

    const markup = renderToStaticMarkup(
      createElement(AppQueryProvider, {
        client,
        children: createElement(QueryClientProbe),
      }),
    )

    expect(markup).toBe('<span>1234</span>')
  })
})
