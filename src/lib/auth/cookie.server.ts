import '@tanstack/react-start/server-only'
import type { AuthConfig } from './config.server'

/**
 * Expiring `Set-Cookie` headers for the Better Auth session cookies.
 *
 * SERVER ONLY, and used on exactly one path: clearing the browser's session
 * cookie when revocation could not be confirmed. The happy path never needs
 * it — a successful `auth.api.signOut` already returns expired `Set-Cookie`
 * headers, which the logout handler forwards verbatim.
 *
 * Nothing here mints, signs, or parses a cookie value; every header below has
 * an empty value and `Max-Age=0`. The names mirror Better Auth's own
 * `getCookies()` derivation (default `better-auth` prefix, plus the
 * `__Secure-` prefix when secure cookies are on) and the attributes mirror
 * `advanced.defaultCookieAttributes` in `auth.server.ts`. A browser discards
 * a cookie only when name, path, and domain all match, so the two must stay
 * aligned.
 */

const COOKIE_PREFIX = 'better-auth'
const SECURE_COOKIE_PREFIX = '__Secure-'

/** Cookie base names Better Auth may set for a credential session. */
const SESSION_COOKIE_BASE_NAMES = [
  `${COOKIE_PREFIX}.session_token`,
  `${COOKIE_PREFIX}.session_data`,
  `${COOKIE_PREFIX}.dont_remember`,
] as const

export function sessionCookieNames(config: AuthConfig): readonly string[] {
  const prefix = config.useSecureCookies ? SECURE_COOKIE_PREFIX : ''
  return SESSION_COOKIE_BASE_NAMES.map((name) => `${prefix}${name}`)
}

export function expiredSessionCookieHeaders(
  config: AuthConfig,
): readonly string[] {
  const attributes = ['Max-Age=0', 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (config.useSecureCookies) attributes.push('Secure')
  return sessionCookieNames(config).map(
    (name) => `${name}=; ${attributes.join('; ')}`,
  )
}
