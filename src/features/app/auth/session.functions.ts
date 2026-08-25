import { createServerFn } from '@tanstack/react-start'
import type { AppSession } from '@/lib/auth/contract'

/**
 * Session access for route guards and client code.
 *
 * `fetchAppSession` is the ONLY way a browser learns who it is. It resolves
 * the session from the request's own cookie on every call — during SSR
 * in-process, and over RPC on a client-side navigation. Nothing is cached in
 * the client, so a session revoked in another tab (or by an administrator)
 * stops working on the next navigation instead of lingering in memory.
 *
 * The return value is the minimal `AppSession` projection: no session token,
 * no `authSubject`, no password material. Presentation may read `role` from
 * it; authorization may not. Every privileged server function calls
 * `requireAppSession()` itself and re-reads the role from the database.
 */
export const fetchAppSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AppSession | null> => {
    // Imported inside the handler: the TanStack Start compiler strips the
    // handler body from the client bundle, so the secret-bearing auth module
    // never enters the browser module graph.
    const { getAppSession } = await import('@/lib/auth/session.server')
    return getAppSession()
  },
)
