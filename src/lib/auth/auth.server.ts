import '@tanstack/react-start/server-only'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { accounts, sessions, users, verifications } from '@/lib/db/schema/canonical'
import { getDatabase, type Database } from '@/lib/db/database.server'
import { parseAuthConfig, type AuthConfig } from './config.server'

/**
 * Better Auth instance for the authenticated application (ADR 0003).
 *
 * SERVER ONLY. This module reads `BETTER_AUTH_SECRET` and opens the
 * PostgreSQL pool, so it must never appear in a client chunk. The
 * `@tanstack/react-start/server-only` marker above makes the boundary
 * enforceable at build time, and the route that mounts the handler imports it
 * dynamically from inside a server handler.
 *
 * Password hashing, session tokens, cookie signing, and CSRF/origin checks
 * are all Better Auth's own; this repository implements none of them.
 */

/**
 * Maps Better Auth's singular model names onto the canonical Drizzle tables.
 * The canonical schema is plural (`users`, `sessions`, ...), so the adapter is
 * given an explicit alias object rather than the whole schema — no column is
 * renamed and no auth-only table is introduced.
 */
const authSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
} as const

/**
 * Roles are a canonical business concern, not an authentication one. Any
 * identity created through Better Auth starts at the least-privileged role;
 * promotion happens through the admin user-management path.
 */
const DEFAULT_USER_ROLE = 'read_only'

export type Auth = ReturnType<typeof createAuth>

export function createAuth(database: Database, config: AuthConfig) {
  return betterAuth({
    appName: 'Weyne Representações',
    baseURL: config.baseURL,
    basePath: config.basePath,
    secret: config.secret,
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema: authSchema,
      // Multi-statement auth operations (user + credential account) run in one
      // PostgreSQL transaction instead of a best-effort sequence.
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      // Internal business application: identities are provisioned by an
      // administrator, never self-registered from the public internet.
      disableSignUp: true,
      minPasswordLength: 12,
    },
    user: {
      additionalFields: {
        // NOT NULL in the canonical schema with no database default. Declared
        // here so the adapter supplies it on insert, and `input: false` so no
        // API caller can grant itself a role.
        role: {
          type: 'string',
          required: true,
          input: false,
          defaultValue: DEFAULT_USER_ROLE,
        },
        // External identity key, NOT NULL and unique. Better Auth is the
        // identity provider here, so the subject is minted per user. Never
        // returned to any caller: the user-management projection tests treat
        // it as sensitive.
        authSubject: {
          type: 'string',
          required: true,
          input: false,
          returned: false,
          fieldName: 'authSubject',
          defaultValue: () => `better-auth:${crypto.randomUUID()}`,
        },
      },
    },
    advanced: {
      database: {
        // The canonical primary keys are `uuid DEFAULT gen_random_uuid()`.
        // Better Auth's default id generator emits a non-UUID string, which
        // PostgreSQL would reject; `uuid` on pg defers to the column default.
        generateId: 'uuid',
      },
      // HTTPS in production (Cloudflare terminates TLS in front of Caddy), so
      // every auth cookie carries `Secure` there. Plain http://localhost keeps
      // working in development.
      useSecureCookies: config.useSecureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        // `lax` (not `strict`) so a top-level navigation back from an action
        // URL still carries the session; cross-site POSTs remain blocked by
        // the origin and Fetch Metadata checks below.
        sameSite: 'lax',
        path: '/',
      },
      // Explicitly ON. Better Auth disables the origin check under
      // `NODE_ENV=test`; pinning it false keeps the protection identical in
      // tests, development, and production.
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    session: {
      // Database-backed and revocable (ADR 0003): no stateless cookie cache.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    telemetry: { enabled: false },
  })
}

let instance: Promise<Auth> | undefined

/**
 * Process-wide Better Auth instance, created lazily on first request so an
 * invalid environment fails the request rather than module evaluation.
 */
export function getAuth(): Promise<Auth> {
  instance ??= (async () => {
    const config = parseAuthConfig(process.env)
    return createAuth(await getDatabase(), config)
  })().catch((error: unknown) => {
    // Never cache a failed initialization: a corrected environment must be
    // able to succeed without a process restart.
    instance = undefined
    throw error
  })
  return instance
}

/** Resets the memoized instance. Used by tests and scripts, never by request paths. */
export function resetAuth(): void {
  instance = undefined
}
