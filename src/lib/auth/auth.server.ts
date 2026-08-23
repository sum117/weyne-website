import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { accounts, rateLimits, sessions, users, verifications } from '@/lib/db/schema/canonical'
import { getDatabase, type Database } from '@/lib/db/database.server'
import { logStructuredEvent } from '@/lib/server/log-redaction'
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
  rateLimit: rateLimits,
} as const

/**
 * Roles are a canonical business concern, not an authentication one. Any
 * identity created through Better Auth starts at the least-privileged role;
 * promotion happens through the admin user-management path.
 */
const DEFAULT_USER_ROLE = 'read_only'

export type Auth = ReturnType<typeof createAuth>

/**
 * Narrow, security-reviewed overrides for a private instance.
 *
 * Only the reset-delivery callback is overridable, and only so the
 * operator-facing reset command can capture the token Better Auth mints
 * without mutating the shared instance's options (which would race with
 * concurrent requests). Nothing here can weaken a protection: secrets,
 * cookie attributes, CSRF/origin checks, and rate limits are not reachable.
 */
export type AuthOverrides = Readonly<{
  sendResetPassword?: NonNullable<
    NonNullable<BetterAuthOptions['emailAndPassword']>['sendResetPassword']
  >
}>

export function createAuth(
  database: Database,
  config: AuthConfig,
  overrides: AuthOverrides = {},
) {
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
      // Password reset without email delivery (this release has no mail
      // transport). `sendResetPassword` is required for Better Auth to mint a
      // reset token at all, so it is supplied and deliberately delivers
      // nothing: the operator hands the link over out of band. The token
      // itself is NEVER logged — logging it would turn the log file into a
      // credential store.
      sendResetPassword:
        overrides.sendResetPassword ??
        (async ({ user }) => {
          logStructuredEvent({
            kind: 'auth',
            event: 'auth.password_reset_requested',
            userId: user.id,
          })
        }),
      // One hour. Long enough for an operator to relay the link by hand,
      // short enough that a leaked link expires before it circulates.
      resetPasswordTokenExpiresIn: 60 * 60,
      // A completed reset invalidates every existing session for that
      // identity. If the password was reset because it was compromised, the
      // attacker's live session must not outlive the reset.
      revokeSessionsOnPasswordReset: true,
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
    /**
     * Explicit allowlist of origins that may call the auth protocol routes.
     * Better Auth already derives this from `baseURL`, but pinning it here
     * makes the trust decision visible and auditable: exactly one origin —
     * the configured application origin — may ever POST to `/api/auth/*`,
     * in every environment. A future multi-origin need must widen THIS
     * list deliberately; it can never appear by accident.
     */
    trustedOrigins: [new URL(config.baseURL).origin],
    session: {
      // Database-backed and revocable (ADR 0003): no stateless cookie cache.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    /**
     * Deactivated identities must not be able to start a NEW session.
     * Deactivation (admin user management) deletes every live session row,
     * which kills existing cookies; this hook closes the other half of the
     * contract by refusing the session INSERT itself, so a disabled user who
     * still knows a valid password gets the ordinary credential rejection —
     * indistinguishable from a wrong password, so the sign-in form cannot be
     * used to probe account status.
     *
     * The lookup is a plain query against the same canonical `users` table
     * the admin surface writes to, so the two halves can never disagree about
     * who is deactivated.
     */
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            // The SAME drizzle instance createAuth was constructed with —
            // never the process-wide connection manager, which resolves from
            // ambient DATABASE_URL and would diverge wherever a caller
            // injects an isolated database (tests, scripts, multi-tenant
            // tooling).
            const [user] = await database
              .select({ disabledAt: users.disabledAt })
              .from(users)
              .where(eq(users.id, session.userId))
              .limit(1)
            if (user && user.disabledAt !== null) {
              logStructuredEvent({
                kind: 'auth',
                event: 'auth.sign_in_blocked_deactivated',
                userId: session.userId,
              })
              return false
            }
          },
        },
      },
    },
    rateLimit: {
      // Explicitly ON in every environment. Better Auth enables rate limiting
      // only in production by default, which would mean the protection was
      // never exercised by a single test or local run — the configuration
      // most likely to be wrong is the one nothing executes.
      enabled: true,
      // PostgreSQL, not the default in-process Map. The container is replaced
      // on every release and the deployment may run more than one replica; an
      // in-memory counter forgets an in-flight brute-force window at both
      // boundaries. The database adapter performs a guarded atomic UPDATE, so
      // concurrent requests cannot each pass a stale read.
      storage: 'database',
      modelName: 'rateLimit',
      // Baseline for auth traffic that has no more specific rule.
      window: 60,
      max: 60,
      customRules: {
        // Credential verification. Better Auth's own default for this path is
        // 3 attempts per 10s, which resets fast enough to allow roughly 1000
        // guesses an hour. Ten per minute is still comfortable for a human
        // who mistyped a password and materially slower for a script.
        '/sign-in/email': { window: 60, max: 10 },
        // Reset request: mints a token and, in a future release, sends mail.
        '/request-password-reset': { window: 60 * 15, max: 5 },
        // Token redemption is the step that actually changes a credential, so
        // it is limited independently of the request that issued the token.
        '/reset-password': { window: 60 * 15, max: 5 },
        '/reset-password/*': { window: 60 * 15, max: 5 },
        // Changing a password while signed in still proves knowledge of the
        // current one, so it is a credential-guessing surface too.
        '/change-password': { window: 60 * 15, max: 10 },
      },
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
