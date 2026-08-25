import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

/**
 * Global TanStack Start configuration.
 *
 * Server functions are same-origin RPC endpoints: a cross-site page can POST
 * to one and the browser will attach the session cookie, because
 * `SameSite=Lax` does not block a cross-site POST issued from a sibling
 * subdomain. Better Auth performs its own origin validation for `/api/auth/*`
 * traffic, but a server function such as `signInWithPassword` calls
 * `auth.api.*` directly and therefore never passes through that check.
 *
 * The framework's own CSRF middleware closes that gap for every
 * server-function request: `Sec-Fetch-Site` must be `same-origin`, or, for
 * clients that omit it, `Origin` (falling back to `Referer`) must match the
 * request origin. A request with none of the three is rejected, because
 * `allowRequestsWithoutOriginCheck` stays at its safe default of `false`.
 *
 * The filter scopes the check to `serverFn` traffic. Ordinary document
 * requests are top-level navigations that must keep working from any entry
 * point, including a fresh tab with no `Referer`.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}))
