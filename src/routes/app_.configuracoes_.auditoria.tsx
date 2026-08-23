import { createFileRoute } from '@tanstack/react-router'
import { AuditActivityViewer } from '@/features/app/audit/audit-activity-viewer'
import { AppQueryProvider } from '@/lib/query/app-query-provider'
import { requireCapableRoute } from '@/features/app/auth/route-guard'

/**
 * Admin-only audit activity viewer (`/app/configuracoes/auditoria`).
 *
 * The page itself is a thin adapter: it owns the URL search object and hands
 * TanStack Router's `navigate` to the viewer. The route guard checks the
 * `audit.view` capability from the centralized matrix (UX layer, card
 * `t_d3e33344`); the server function still re-authenticates and requires the
 * same capability on every call, and the viewer renders the explicit
 * unauthorized state from the server's `FORBIDDEN` result. There are no edit
 * or delete actions anywhere on this surface.
 */
export const Route = createFileRoute('/app_/configuracoes_/auditoria')({
  validateSearch: (search) => search as Record<string, unknown>,
  beforeLoad: ({ location }) =>
    requireCapableRoute(location, 'audit.view'),
  head: () => ({
    meta: [
      { title: 'Auditoria de atividades | Weyne Representações' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: AuditoriaPage,
})

function AuditoriaPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <AppQueryProvider>
      <AuditActivityViewer
        search={search}
        navigate={(options) =>
          navigate({ search: options.search, replace: options.replace })
        }
      />
    </AppQueryProvider>
  )
}
