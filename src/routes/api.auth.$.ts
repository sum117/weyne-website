import { createFileRoute } from '@tanstack/react-router'

/**
 * Better Auth protocol route (ADR 0003): the single routine exception to the
 * server-function API rule. Every `/api/auth/*` request is delegated verbatim
 * to `auth.handler(request)`, which owns password hashing, session tokens,
 * cookie signing, origin validation, and CSRF checks.
 *
 * The auth module is imported DYNAMICALLY from inside the handler. The client
 * build strips the `server` option from route files, and the dynamic import
 * keeps the secret-bearing module out of the client module graph entirely
 * rather than relying on tree-shaking to drop an unused static import.
 */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      POST: ({ request }) => handleAuthRequest(request),
    },
  },
})

async function handleAuthRequest(request: Request): Promise<Response> {
  const { getAuth } = await import('@/lib/auth/auth.server')
  const auth = await getAuth()
  return auth.handler(request)
}
