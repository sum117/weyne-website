import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { AppSession } from '@/lib/auth/contract'

/**
 * Credential login and logout for the authenticated application.
 *
 * Both endpoints delegate the security-critical work to Better Auth's own
 * server API (`auth.api.signInEmail` / `auth.api.signOut`): it hashes and
 * compares the password, mints and revokes the database-backed session row,
 * and serializes the signed cookie. This module writes no cryptography and
 * builds no cookie by hand — it only forwards Better Auth's `Set-Cookie`
 * headers onto the server-function response.
 *
 * Cross-site protection comes from the framework: `src/start.ts` installs
 * TanStack Start's CSRF request middleware over every server-function call,
 * so a cross-origin POST is rejected with 403 before this handler runs. That
 * check is required here because a direct `auth.api.*` call bypasses the
 * origin validation `auth.handler` performs for `/api/auth/*` traffic.
 */

const credentialsSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(512),
})

export type LoginPublicError = Readonly<{
  code: 'INVALID_CREDENTIALS' | 'VALIDATION_FAILED' | 'INTERNAL_ERROR'
  message: string
}>

export type LoginResult =
  | Readonly<{ ok: true; session: AppSession }>
  | Readonly<{ ok: false; error: LoginPublicError }>

/**
 * One message for every rejected login.
 *
 * A wrong password, an unknown address, and a disabled identity are
 * indistinguishable to the caller, so the form cannot be used to enumerate
 * who has an account.
 */
const INVALID_CREDENTIALS: LoginPublicError = Object.freeze({
  code: 'INVALID_CREDENTIALS',
  message: 'E-mail ou senha inválidos.',
})

const acceptUnknownInput = (input: unknown) => input

export const signInWithPassword = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }): Promise<LoginResult> => {
    const parsed = credentialsSchema.safeParse(data)
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Informe o e-mail e a senha.',
        },
      }
    }

    // Server-only modules are imported inside the handler so the compiler can
    // strip them from the client bundle.
    const { getRequest, setResponseHeader } = await import(
      '@tanstack/react-start/server'
    )
    const { getAuth } = await import('@/lib/auth/auth.server')
    const { resolveSessionFromRequest } = await import(
      '@/lib/auth/session.server'
    )
    const { logUnexpectedError } = await import('@/lib/server/log-redaction')

    const request = getRequest()

    try {
      const auth = await getAuth()
      const response = await auth.api.signInEmail({
        body: { email: parsed.data.email, password: parsed.data.password },
        headers: request.headers,
        asResponse: true,
      })

      if (!response.ok) return { ok: false, error: INVALID_CREDENTIALS }

      const cookies = response.headers.getSetCookie()
      if (cookies.length === 0) return { ok: false, error: INVALID_CREDENTIALS }
      // Better Auth built these; forwarding them verbatim keeps HttpOnly,
      // SameSite, Secure, Max-Age, and the signature exactly as issued.
      setResponseHeader('set-cookie', cookies)

      // Re-read the session through the authoritative resolver rather than
      // trusting the sign-in body, so the projection the client receives is
      // the same one every guard will compute on the next request.
      const session = await resolveSessionFromRequest(
        new Request(request.url, {
          headers: new Headers({
            cookie: cookies.map((value) => value.split(';')[0]).join('; '),
          }),
        }),
      )
      if (!session) return { ok: false, error: INVALID_CREDENTIALS }

      return { ok: true, session }
    } catch (cause) {
      // Better Auth throws a typed APIError for a rejected credential; that is
      // an expected outcome, not a fault, and must not be logged as one.
      const status = (cause as { status?: unknown } | null)?.status
      if (status === 401 || status === 403 || status === 'UNAUTHORIZED') {
        return { ok: false, error: INVALID_CREDENTIALS }
      }
      logUnexpectedError('auth.sign-in', cause)
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Não foi possível concluir a operação. Tente novamente.',
        },
      }
    }
  })

export type SignOutResult = Readonly<{ ok: true }>

/**
 * Revokes the caller's session server-side and clears the browser cookie.
 *
 * Always reports success. The session row is deleted by Better Auth, and the
 * expired cookie it returns is forwarded verbatim; a caller who was already
 * signed out gets the same answer, which leaks nothing about session state.
 */
export const signOutCurrentSession = createServerFn({ method: 'POST' }).handler(
  async (): Promise<SignOutResult> => {
    const { getRequest, setResponseHeader } = await import(
      '@tanstack/react-start/server'
    )
    const { getAuth } = await import('@/lib/auth/auth.server')
    const { logUnexpectedError } = await import('@/lib/server/log-redaction')

    const request = getRequest()

    try {
      const auth = await getAuth()
      const response = await auth.api.signOut({
        headers: request.headers,
        asResponse: true,
      })
      const cookies = response.headers.getSetCookie()
      if (cookies.length > 0) setResponseHeader('set-cookie', cookies)
    } catch (cause) {
      logUnexpectedError('auth.sign-out', cause)
      // Fall through to an expired-cookie clear: the browser must lose its
      // cookie even when the revocation call itself failed.
      const { expiredSessionCookieHeaders } = await import(
        '@/lib/auth/cookie.server'
      )
      const { parseAuthConfig } = await import('@/lib/auth/config.server')
      setResponseHeader(
        'set-cookie',
        [...expiredSessionCookieHeaders(parseAuthConfig(process.env))],
      )
    }

    return { ok: true }
  },
)
