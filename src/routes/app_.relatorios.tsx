import { createFileRoute } from '@tanstack/react-router'
import {
  ReportsShell,
  type ReportNavigate,
} from '@/features/app/reports/reports-shell'

function todayInBusinessTimezone() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export const Route = createFileRoute('/app_/relatorios')({
  validateSearch: (search) => search as Record<string, unknown>,
  head: () => ({
    meta: [
      { title: 'Relatórios | Weyne Representações' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: ReportsPage,
})

function ReportsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const reportNavigate: ReportNavigate = (options) =>
    navigate({ search: options.search, replace: options.replace })

  return (
    <ReportsShell
      search={search}
      navigate={reportNavigate}
      today={todayInBusinessTimezone()}
      capabilities={{
        availableTabs: ['clientes', 'produtos', 'industrias', 'comissoes'],
        canFilterRepresentatives: true,
      }}
      representatives={[]}
    />
  )
}
