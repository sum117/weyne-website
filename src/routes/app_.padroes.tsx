import { useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { DataTableUrlNavigate } from '@/components/data-table/data-table-url-state'
import { SharedPatternsExample } from '@/components/patterns/examples/shared-patterns-example'

type PatternSearch = Record<string, unknown>

export const Route = createFileRoute('/app_/padroes')({
  validateSearch: (search): PatternSearch => search,
  head: () => ({
    meta: [
      { title: 'Padrões compartilhados | Weyne Representações' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: SharedPatternsPage,
})

function SharedPatternsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const navigateTable = useCallback<DataTableUrlNavigate>(
    ({ search: updateSearch, replace }) =>
      navigate({ search: updateSearch, replace }),
    [navigate],
  )

  return (
    <SharedPatternsExample
      search={search}
      navigate={navigateTable}
      onSubmit={() => undefined}
    />
  )
}