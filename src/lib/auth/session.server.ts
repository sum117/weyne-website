import '@tanstack/react-start/server-only'
import { getRequest } from '@tanstack/react-start/server'
import { getAuth } from './auth.server'
import type { AppSession, AppSessionRole, AppSessionUser } from './contract'

/**
 * Authoritative server-side session resolution.
 *
 * SERVER ONLY. Every protected surface — route `beforeLoad`, route loaders,
 * and every privileged server function — resolves the caller through this
 * module. It reads the request's own cookie header and asks Better Auth, so
 * the answer never depends on anything the client sent as data.
 *
 * Two rules hold everywhere below:
 *
 * 1. The session is read from the REQUEST, never from route context, a
 *    loader argument, or a server-function payload. A client-supplied user id
 *    or role is inert here.
 * 2. Only `AppSession` leaves this module. The session token, `authSubject`,
 *    and password material never cross the boundary.
 *
 * Failure is closed: a missing, malformed, expired, or revoked cookie
 * resolves to `null`, and an infrastructure failure resolves to `null` too
 * rather than letting a database outage read as "authenticated".
 */

const APP_ROLES: readonly AppSessionRole[] = ['admin', 'representative', 'read_only']

function toRole(value: unknown): AppSessionRole | null {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value)
    ? (value as AppSessionRole)
    : null
}

/**
 * Narrows Better Auth's session payload to the minimal public projection.
 *
 * An identity whose role is not one of the three canonical roles is treated
 * as unauthenticated: the application has no policy for it, and guessing one
 * would be a privilege decision made by accident.
 */
function toAppSession(payload: unknown): AppSession | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { user, session } = payload as {
    user?: Record<string, unknown>
    session?: Record<string, unknown>
  }
  if (!user || !session) return null

  const id = user.id
  const email = user.email
  const name = user.name
  const role = toRole(user.role)
  if (typeof id !== 'string' || typeof email !== 'string' || role === null) {
    return null
  }

  const expiresAt =
    session.expiresAt instanceof Date
      ? session.expiresAt
      : typeof session.expiresAt === 'string'
        ? new Date(session.expiresAt)
        : null
  if (expiresAt === null || Number.isNaN(expiresAt.getTime())) return null

  const projected: AppSessionUser = {
    id,
    name: typeof name === 'string' ? name : '',
    email,
    role,
  }

  return Object.freeze({
    user: Object.freeze(projected),
    expiresAt: expiresAt.toISOString(),
  })
}

/**
 * Resolves the caller's session from an explicit request.
 *
 * Better Auth verifies the signed cookie and looks the session row up in
 * PostgreSQL, so a revoked or expired session resolves to `null` even though
 * the browser still holds its cookie.
 */
export async function resolveSessionFromRequest(
  request: Request,
): Promise<AppSession | null> {
  try {
    const auth = await getAuth()
    const payload = await auth.api.getSession({ headers: request.headers })
    return toAppSession(payload)
  } catch {
    // Fail closed. The caller renders/behaves as anonymous; the failure is
    // surfaced by the request log, not by granting access.
    return null
  }
}

/**
 * Resolves the caller's session from the ambient request.
 *
 * Valid inside a route `beforeLoad`/`loader` during SSR and inside a server
 * function handler. It must NOT be called at module scope: there is no
 * request there, and the ambient lookup throws.
 */
export function getAppSession(): Promise<AppSession | null> {
  let request: Request
  try {
    request = getRequest()
  } catch {
    return Promise.resolve(null)
  }
  return resolveSessionFromRequest(request)
}

/** Error thrown by `requireAppSession` when no valid session backs the request. */
export class UnauthenticatedError extends Error {
  readonly code = 'UNAUTHENTICATED' as const
  readonly status = 401 as const

  constructor() {
    super('Authentication is required.')
    this.name = 'UnauthenticatedError'
  }
}

/**
 * Session or nothing. Use inside server functions that must not run for an
 * anonymous caller; the thrown error carries no detail an attacker could use
 * to tell "no session" apart from "revoked session".
 */
export async function requireAppSession(): Promise<AppSession> {
  const session = await getAppSession()
  if (!session) throw new UnauthenticatedError()
  return session
}
