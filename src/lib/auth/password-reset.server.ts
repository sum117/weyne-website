import '@tanstack/react-start/server-only'
import { createAuth } from './auth.server'
import type { AuthConfig } from './config.server'
import type { Database } from '@/lib/db/database.server'
import { AUTH_BASE_PATH } from './contract'

/**
 * Operator-issued password reset and invitation, without email delivery.
 *
 * SERVER ONLY. This release has no mail transport, so the delivery step is
 * performed by a human: an administrator runs the command, receives a
 * single-use link, and hands it to the person out of band. When mail is
 * added, the same Better Auth token flow drives it and this module becomes
 * the fallback rather than the only path.
 *
 * The token is minted, stored, and consumed entirely by Better Auth's
 * `/request-password-reset` and `/reset-password` endpoints. Nothing here
 * generates a token, hashes a password, or writes a verification row.
 *
 * Invitation and reset are the same mechanism on purpose. A provisioned
 * identity that has never signed in and an identity whose owner forgot the
 * password both need exactly one thing: a single-use proof that lets them
 * set a password they choose. Modelling them separately would mean two token
 * lifetimes, two revocation rules, and two chances to get one of them wrong.
 *
 * It performs NO authorization of its own. Callers are responsible for
 * proving the actor may reset another identity's credential before invoking
 * it — an unauthenticated caller reaching this would be an account takeover.
 */

export type ResetLinkOutcome =
  | Readonly<{ status: 'issued'; url: string; expiresInSeconds: number }>
  /**
   * The address has no identity. Reported rather than thrown so the caller
   * can decide how loudly to fail; the HTTP surface must keep treating an
   * unknown address as indistinguishable from a known one.
   */
  | Readonly<{ status: 'unknown_identity' }>

/**
 * Path Better Auth mounts its reset-token redemption route on, relative to
 * the auth base path.
 */
const RESET_PASSWORD_PATH = '/reset-password'

/** Absolute path of the reset redemption route, for documentation and tests. */
export const RESET_PASSWORD_ROUTE = `${AUTH_BASE_PATH}${RESET_PASSWORD_PATH}`

/**
 * Requests a password reset token for `email` and returns the link that
 * redeems it.
 *
 * A DEDICATED Better Auth instance is built for the call rather than reusing
 * the process-wide one. The token is only ever exposed through the
 * `sendResetPassword` callback, and that callback lives on the instance's
 * options; swapping it on the shared instance would race with any concurrent
 * request and could hand one caller's reset token to another. A private
 * instance keeps the capture confined to this invocation. It costs one extra
 * object on an operator-only path that runs a handful of times a year.
 *
 * Better Auth answers `/request-password-reset` identically whether or not
 * the address exists, which is correct for the public endpoint but useless to
 * an operator who needs to know the command worked. The existence check below
 * therefore runs against the internal adapter, and it is safe precisely
 * because this path is not reachable over HTTP.
 */
export async function issuePasswordResetLink(
  database: Database,
  config: AuthConfig,
  email: string,
): Promise<ResetLinkOutcome> {
  const normalizedEmail = email.trim().toLowerCase()

  // Mutable holder rather than a bare `let`: TypeScript does not narrow a
  // variable assigned inside a callback, and a holder keeps the capture
  // explicit at the call site.
  const captured: { token: string | null } = { token: null }

  const auth = createAuth(database, config, {
    sendResetPassword: async ({ token }) => {
      captured.token = token
    },
  })

  const context = await auth.$context
  const user = await context.internalAdapter.findUserByEmail(normalizedEmail)
  if (!user) return Object.freeze({ status: 'unknown_identity' })

  await auth.api.requestPasswordReset({ body: { email: normalizedEmail } })

  if (captured.token === null) {
    throw new Error('Better Auth did not issue a password reset token')
  }

  const expiresInSeconds =
    context.options.emailAndPassword?.resetPasswordTokenExpiresIn ?? 3600

  return Object.freeze({
    status: 'issued',
    url: `${context.baseURL}${RESET_PASSWORD_PATH}/${captured.token}`,
    expiresInSeconds,
  })
}
