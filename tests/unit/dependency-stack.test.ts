// @vitest-environment jsdom

import { act, createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DependencyStackExample,
  type SalesRow,
} from '../support/dependency-stack-example'

const rows: SalesRow[] = [
  { id: 'sale-1', customer: 'Mercado Sol', total: 1250 },
  { id: 'sale-2', customer: 'Hotel Mar', total: 980 },
]
const queryKey = ['architecture-spike', 'sales']

;(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}).IS_REACT_ACT_ENVIRONMENT = true

function tree(queryClient: QueryClient, loadRows: () => Promise<SalesRow[]>) {
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(DependencyStackExample, { loadRows }),
  )
}

describe('client dependency stack compatibility', () => {
  let root: Root | undefined

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
      root = undefined
    }
    delete document.documentElement.dataset.dependencyStackHydrated
    document.body.innerHTML = ''
  })

  it('SSR-renders and hydrates Query, Table v9, and a shadcn Recharts chart', async () => {
    const loadRows = vi.fn(async () => rows)
    const serverClient = new QueryClient()
    serverClient.setQueryData(queryKey, rows)
    const html = renderToString(tree(serverClient, loadRows))

    expect(html).toContain('Mercado Sol')
    expect(html).toContain('data-slot="chart"')
    expect(html).toContain('recharts-responsive-container')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.append(container)

    const browserClient = new QueryClient()
    browserClient.setQueryData(queryKey, rows)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      root = hydrateRoot(container, tree(browserClient, loadRows))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.documentElement.dataset.dependencyStackHydrated).toBe('true')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.querySelector('[aria-label="Sales chart"] svg')).not.toBeNull()
    expect(
      consoleError.mock.calls.filter(([message]) =>
        String(message).includes('hydration'),
      ),
    ).toHaveLength(0)

    consoleError.mockRestore()
  })
})
