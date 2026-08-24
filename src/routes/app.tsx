import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireAuthenticatedRoute } from '@/features/app/auth/route-guard'
import { AppShell } from '@/features/app/shell/app-shell'
import {
  AppRouteError,
  AppRouteNotFound,
  AppRoutePending,
} from '@/features/app/shell/app-route-states'

export const Route = createFileRoute('/app')({
  beforeLoad: ({ location }) => requireAuthenticatedRoute(location),
  head: () => ({
    meta: [
      { title: 'Área de gestão | Weyne Representações' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  pendingComponent: AppRoutePending,
  errorComponent: AppRouteError,
  notFoundComponent: AppRouteNotFound,
  component: AppLayout,
})

function AppLayout() {
  const { session } = Route.useRouteContext()

  return (
    <AppShell session={session}>
      <Outlet />
    </AppShell>
  )
}
