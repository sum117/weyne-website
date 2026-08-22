import { z } from 'zod'

/**
 * Server-only Better Auth configuration (ADR 0003).
 *
 * `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are runtime configuration and
 * MUST NOT carry the `VITE_` prefix — every `VITE_*` value is browser-visible.
 * This module is imported only from `.server` modules and from the dynamic
 * import inside the auth route handler, so it never enters a client chunk.
 *
 * Development stays usable with no environment file at all; production fails
 * closed on anything missing, weak, or insecure.
 */

/** Mount point of the Better Auth protocol route. Matches `src/routes/api.auth.$.ts`. */
export const AUTH_BASE_PATH = '/api/auth'

/** Minimum secret length Better Auth considers adequate. */
export const MINIMUM_SECRET_LENGTH = 32

/**
 * Local-development stand-in used only when `NODE_ENV` is not `production`.
 * It is deliberately a recognizable, non-random marker: it must never be
 * mistaken for a real credential, and production rejects it explicitly.
 */
export const DEVELOPMENT_FALLBACK_KEY =
  'weyne-local-development-key-not-for-production-use'

const DEVELOPMENT_FALLBACK_URL = 'http://localhost:3000'

const authEnvironmentSchema = z.object({
  BETTER_AUTH_SECRET: z.string().trim().min(1).optional(),
  BETTER_AUTH_URL: z.string().trim().min(1).optional(),
  NODE_ENV: z.string().trim().min(1).optional(),
})

export type AuthConfig = Readonly<{
  /** Signing key handed to Better Auth. Never logged, never serialized. */
  secret: string
  /** Absolute origin + basePath Better Auth builds action URLs from. */
  baseURL: string
  basePath: string
  /** Forces the `Secure` cookie attribute; true whenever the origin is HTTPS. */
  useSecureCookies: boolean
  isProduction: boolean
}>

function parseAbsoluteHttpUrl(value: string, variable: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${variable} must be an absolute http(s) URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${variable} must be an absolute http(s) URL`)
  }
  return parsed
}

/**
 * Validates the authentication environment.
 *
 * Error messages name the offending variable and never echo its value, so a
 * misconfiguration cannot leak a secret through logs or a crash report.
 */
export function parseAuthConfig(
  environment: Readonly<Record<string, string | undefined>>,
): AuthConfig {
  const result = authEnvironmentSchema.safeParse(environment)
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid authentication configuration: ${details}`)
  }

  const isProduction = result.data.NODE_ENV === 'production'
  const configuredSecret = result.data.BETTER_AUTH_SECRET
  const configuredUrl = result.data.BETTER_AUTH_URL

  if (isProduction) {
    if (!configuredSecret) {
      throw new Error('BETTER_AUTH_SECRET is required in production')
    }
    if (configuredSecret === DEVELOPMENT_FALLBACK_KEY) {
      throw new Error(
        'BETTER_AUTH_SECRET is the development fallback; generate a unique production value',
      )
    }
    if (configuredSecret.length < MINIMUM_SECRET_LENGTH) {
      throw new Error(
        `BETTER_AUTH_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters`,
      )
    }
    if (!configuredUrl) {
      throw new Error('BETTER_AUTH_URL is required in production')
    }
  }

  const secret = configuredSecret ?? DEVELOPMENT_FALLBACK_KEY
  if (secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters`,
    )
  }

  const url = parseAbsoluteHttpUrl(
    configuredUrl ?? DEVELOPMENT_FALLBACK_URL,
    'BETTER_AUTH_URL',
  )

  // Production terminates TLS at Cloudflare and proxies through Caddy, so the
  // public origin is always HTTPS. An HTTP production origin would silently
  // drop the `Secure` cookie attribute; refuse it instead.
  if (isProduction && url.protocol !== 'https:') {
    throw new Error('BETTER_AUTH_URL must use https in production')
  }

  return Object.freeze({
    secret,
    baseURL: `${url.origin}${AUTH_BASE_PATH}`,
    basePath: AUTH_BASE_PATH,
    useSecureCookies: url.protocol === 'https:',
    isProduction,
  })
}
