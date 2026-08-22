import { createServerFn } from '@tanstack/react-start'

/**
 * SSR liveness probe for `/app`.
 *
 * The route guard already redirected an anonymous visitor, but this handler
 * re-verifies the caller anyway: a server function is an RPC endpoint that a
 * client can POST to directly, without ever loading the route that normally
 * calls it. Route context is UX; the endpoint decides for itself.
 */
export const getRuntimeStatus = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { requireAppSession } = await import('@/lib/auth/session.server')
    await requireAppSession()

    return {
      message: 'Servidor TanStack Start ativo',
      renderedAt: new Date().toISOString(),
    }
  },
)
