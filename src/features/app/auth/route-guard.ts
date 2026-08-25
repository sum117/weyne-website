import { redirect } from '@tanstack/react-router'
import { fetchAppSession } from './session.functions'
import { DEFAULT_AUTHENTICATED_PATH, LOGIN_PATH, type AppSession } from '@/lib/auth/contract'
import { hasCapability, type Capability } from '@/lib/auth/capabilities'

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

/**
 * Route guard for capability-gated application routes (card `t_d3e33344`).
 *
 * Extends `requireAuthenticatedRoute` with one lookup against the centralized
 * matrix (`capabilities.ts`) — the same matrix every server function enforces.
 * UX ONLY: this decides what a route renders, never what the API accepts. A
 * caller who slips past it hits `requireCapability()` at the server-function
 * boundary and gains nothing.
 *
 * - No session → same login redirect as above.
 * - Session without the capability → redirect to `/app` with
 *   `?negado=<capability>` instead of a dead end, so the shell can explain
 *   the denial in pt-BR and the user keeps navigating. The capability name is
 *   already public vocabulary (`capabilities.ts` ships in the client bundle);
 *   no server decision is revealed by echoing it back.
 */
export async function requireCapableRoute(
  location: { href: string },
  capability: Capability,
): Promise<Readonly<{ session: AppSession }>> {
  const guarded = await requireAuthenticatedRoute(location)
  if (!hasCapability(guarded.session.user.role, capability)) {
    throw redirect({
      to: DEFAULT_AUTHENTICATED_PATH,
      search: { negado: capability },
      replace: true,
    })
  }
  return guarded
}
