import '@tanstack/react-start/server-only'

import {
  authorize,
  recordScope,
  type Capability,
  type RecordScope,
  type ScopedResource,
} from './capabilities'
import {
  requireAppSession,
  UnauthenticatedError,
} from './session.server'
import type { AppSession } from './contract'

/**
 * Server-boundary authorization helpers on top of the Better Auth session
 * (`session.server.ts`) and the centralized matrix (`capabilities.ts`).
 *
 * SERVER ONLY. Every privileged server function and domain service entry
 * point calls these at its boundary, so a hidden button or a forged route
 * context buys an attacker nothing: the session is resolved from the request
 * cookie and every decision is re-derived here on each call.
 *
 * Denial semantics (matrix §2.1/§2.3):
 * - `UnauthenticatedError` (401): no valid session backs the request.
 *   Distinct from forbidden — an anonymous caller must not be able to tell
 *   whether a capability even exists.
 * - `ForbiddenError` (403): authenticated, role holds no such capability,
 *   and the record is legitimately within the actor's scope. The pt-BR
 *   message is fixed; it never names the missing capability, the caller's
 *   own role, or any record's existence.
 * - `UnsupportedCommandError` (404): the command does not exist in Phase 1
 *   for ANY role. `authorize()` is compile-time over `Capability`, so this
 *   is only reachable with an untyped string — exactly the callers who need
 *   the loud failure.
 */

/** Fixed pt-BR denial copy. Never interpolated; never names internals. */
export const DENIAL_MESSAGES = Object.freeze({
  FORBIDDEN: 'Você não tem permissão para executar esta operação.',
  UNSUPPORTED_COMMAND: 'Esta operação não está disponível.',
})

export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN' as const
  readonly status = 403 as const

  constructor() {
    super(DENIAL_MESSAGES.FORBIDDEN)
    this.name = 'ForbiddenError'
  }
}

export class UnsupportedCommandError extends Error {
  readonly code = 'UNSUPPORTED_COMMAND' as const
  readonly status = 404 as const

  constructor() {
    super(DENIAL_MESSAGES.UNSUPPORTED_COMMAND)
    this.name = 'UnsupportedCommandError'
  }
}

/**
 * Session or throw. Thin alias kept for call-site readability at boundaries
 * that only need authentication, not authorization; delegates to the
 * authoritative resolver in `session.server.ts`.
 */
export function requireSession(): Promise<AppSession> {
  return requireAppSession()
}

export { UnauthenticatedError }

/**
 * Resolve the current session AND prove the role holds the capability.
 *
 * Throws `UnauthenticatedError` when no valid session exists;
 * `ForbiddenError` when authenticated but the role is denied. Returns the
 * session narrowed to what downstream scope/projection code needs.
 */
export async function requireCapability(
  capability: Capability,
): Promise<AppSession> {
  const session = await requireAppSession()
  if (authorize(session.user.role, capability) !== 'allow') {
    throw new ForbiddenError()
  }
  return session
}

/**
 * Same as `requireCapability`, additionally returning the actor's record
 * scope for the resource being touched, so one call covers both halves of
 * the contract: WHO may act, and WHERE records may be located. Services use
 * the returned scope to build their queries — filters derived from
 * `recordScope` must be applied before any pagination, never after.
 */
export async function requireScopedCapability(
  resource: ScopedResource,
  capability: Capability,
): Promise<Readonly<{ session: AppSession; scope: RecordScope }>> {
  const session = await requireCapability(capability)
  return { session, scope: recordScope(session.user.role, resource) }
}
