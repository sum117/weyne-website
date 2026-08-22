/**
 * Isomorphic authentication contract.
 *
 * SAFE IN THE BROWSER. This module holds only the shape of what the client is
 * allowed to know: the auth mount point, the login path, and the minimal
 * session projection. It imports nothing server-only, so the login form and
 * the route guards can share it with the server without dragging
 * `config.server.ts` (which reads `BETTER_AUTH_SECRET`) into a client chunk.
 */

/** Mount point of the Better Auth protocol route. Matches `src/routes/api.auth.$.ts`. */
export const AUTH_BASE_PATH = '/api/auth'

/** Public path of the credential login page. */
export const LOGIN_PATH = '/entrar'

/** Where a signed-in visitor lands when no explicit target was requested. */
export const DEFAULT_AUTHENTICATED_PATH = '/app'

export type AppSessionRole = 'admin' | 'representative' | 'read_only'

/**
 * Everything client code may see about the signed-in identity.
 *
 * Deliberately minimal: no session token, no `authSubject`, no password
 * material, no timestamps beyond the expiry the UI needs. `role` is present
 * for presentation only — every server function re-reads it from the database
 * and never trusts a value that arrived from the client.
 */
export type AppSessionUser = Readonly<{
  id: string
  name: string
  email: string
  role: AppSessionRole
}>

export type AppSession = Readonly<{
  user: AppSessionUser
  /** ISO-8601 instant at which the server-side session stops being valid. */
  expiresAt: string
}>

/**
 * Reduces an untrusted `redirect` search value to a same-origin path.
 *
 * Anything that is not a plain absolute path is discarded, which closes the
 * open-redirect hole: `//evil.example`, `https://evil.example`, and
 * `/\evil.example` are all protocol-relative or absolute targets that a
 * browser would follow off-site.
 */
export function sanitizeRedirectPath(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_AUTHENTICATED_PATH
  if (!value.startsWith('/')) return DEFAULT_AUTHENTICATED_PATH
  if (value.startsWith('//') || value.startsWith('/\\')) {
    return DEFAULT_AUTHENTICATED_PATH
  }
  // A logged-out visitor bounced off the login page must not be sent back to
  // it after signing in.
  if (value === LOGIN_PATH || value.startsWith(`${LOGIN_PATH}?`)) {
    return DEFAULT_AUTHENTICATED_PATH
  }
  return value
}
