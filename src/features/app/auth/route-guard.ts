import { redirect } from '@tanstack/react-router'
import { fetchAppSession } from './session.functions'
import { LOGIN_PATH, type AppSession } from '@/lib/auth/contract'

/**
 * Route guard for every authenticated application route.
 *
 * Called from `beforeLoad`, which runs BEFORE the route's loader and before
 * any component renders. On a direct request it runs during SSR, so an
 * anonymous visitor is redirected on the server and no protected markup or
 * loader data is ever produced. On an in-app navigation it runs on the
 * client and issues the same redirect.
 *
 * The session it returns is placed in route context for presentation only.
 * It is NOT an authorization decision: every server function re-resolves the
 * caller from the request cookie through `requireAppSession()` and re-reads
 * the role from the database. A client that forges route context gains
 * nothing, because no server code reads it.
 */
export async function requireAuthenticatedRoute(location: {
  href: string
}): Promise<Readonly<{ session: AppSession }>> {
  const session = await fetchAppSession()
  if (!session) {
    throw redirect({
      to: LOGIN_PATH,
      search: { redirect: location.href },
      // Replace the protected URL in history so the browser Back button does
      // not bounce the visitor between the guard and the login page.
      replace: true,
    })
  }
  return { session }
}
