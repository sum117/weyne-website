import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source-level guards for the account-lifecycle security decisions.
 *
 * These assertions are deliberately made against the SOURCE rather than a
 * constructed Better Auth instance. Each one pins a decision whose failure
 * mode is silent: the application keeps working, the tests keep passing, and
 * a protection is simply gone. A behavioral test can only catch such a
 * regression if someone remembers to write one for the specific bypass; a
 * source guard fails the build the moment the decision is reverted.
 *
 * The behavior itself is covered against real PostgreSQL in
 * `tests/integration/auth-account-lifecycle.test.ts` and
 * `tests/integration/auth-rate-limit-surface.test.ts`.
 */

const root = resolve(import.meta.dirname, '../..')

async function projectFile(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8')
}

/**
 * Strips comments so a guard asserts on CODE, not on the prose explaining it.
 *
 * These modules document the traps they avoid by name, so a naive substring
 * check for `auth.api.signInEmail` matches the comment that warns against
 * calling it. Removing comments first is what makes the assertion mean what
 * it says.
 */
function code(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '')
}

describe('rate limiting is configured and reachable', () => {
  it('enables the limiter in every environment, not just production', async () => {
    const source = await projectFile('src/lib/auth/auth.server.ts')

    expect(source).toMatch(/rateLimit:\s*\{/)
    expect(source).toMatch(/enabled:\s*true/)
  })

  it('stores counters in the database so a restart cannot reset a window', async () => {
    const source = await projectFile('src/lib/auth/auth.server.ts')

    expect(source).toMatch(/storage:\s*'database'/)
    // The adapter must be able to reach the table, which means the model has
    // to be in the alias map alongside user/session/account/verification.
    expect(source).toMatch(/rateLimit:\s*rateLimits/)
  })

  it('limits every credential-bearing endpoint', async () => {
    const source = await projectFile('src/lib/auth/auth.server.ts')

    for (const path of [
      '/sign-in/email',
      '/request-password-reset',
      '/reset-password',
      '/change-password',
    ]) {
      expect(source).toContain(`'${path}'`)
    }
  })

  it('routes the login server function through auth.handler, not auth.api', async () => {
    const source = code(await projectFile('src/features/app/auth/login.functions.ts'))

    // Better Auth's limiter lives in the router's onRequest hook. `auth.api`
    // sits below that router, so calling `auth.api.signInEmail` here would
    // leave the login form's own endpoint with unlimited attempts while
    // /api/auth/sign-in/email was throttled.
    expect(source).toContain('auth.handler(')
    expect(source).not.toContain('auth.api.signInEmail')
    // And the throttled response must be distinguishable, or the form would
    // tell a locked-out user their password was wrong.
    expect(source).toContain('429')
    expect(source).toContain('RATE_LIMITED')
  })

  it('keeps the rate-limit table out of the audited business domain', async () => {
    const schema = await projectFile('src/lib/db/schema/canonical.ts')
    const table = schema.slice(schema.indexOf("pgTable(\n  'rate_limits'"))

    // Transient library state: no authorship, no archive, no audit trigger.
    // Adding those would imply the rows are business records that must be
    // retained, when the library prunes them on its own schedule.
    const declaration = table.slice(0, table.indexOf('\n)\n'))
    expect(declaration).not.toContain('createdByUserId')
    expect(declaration).not.toContain('archivedAt')
  })
})

describe('origin trust is pinned', () => {
  it('allowlists exactly the configured application origin for /api/auth/*', async () => {
    const source = code(await projectFile('src/lib/auth/auth.server.ts'))

    // The allowlist must be explicit and derived from the single configured
    // origin — never a literal second host, never a wildcard, never absent.
    expect(source).toMatch(/trustedOrigins:\s*\[\s*new URL\(config\.baseURL\)\.origin\s*,?\s*\]/)
  })

  it('keeps CSRF and origin checks enabled in every environment', async () => {
    const source = code(await projectFile('src/lib/auth/auth.server.ts'))

    // Better Auth disables both under NODE_ENV=test by default; the source
    // must keep them explicitly false so tests exercise the same posture as
    // production.
    expect(source).toMatch(/disableCSRFCheck:\s*false/)
    expect(source).toMatch(/disableOriginCheck:\s*false/)
  })
})

describe('password reset works without email delivery', () => {
  it('supplies a reset sender so Better Auth will mint tokens at all', async () => {
    const source = await projectFile('src/lib/auth/auth.server.ts')

    // Better Auth refuses /request-password-reset outright when
    // `sendResetPassword` is absent, so the flow cannot exist without it even
    // though this release has no mail transport.
    expect(source).toContain('sendResetPassword')
    expect(source).toContain('resetPasswordTokenExpiresIn')
  })

  it('never writes the reset token to the log', async () => {
    const source = code(await projectFile('src/lib/auth/auth.server.ts'))
    // Slice the default sender: from the option assignment to the next option.
    const sender = source.slice(
      source.indexOf('sendResetPassword:'),
      source.indexOf('resetPasswordTokenExpiresIn'),
    )

    // Logging the token would turn the log file into a credential store: it
    // is a bearer proof for that account until used or expired. The override
    // parameter is named here, so the assertion targets what is LOGGED.
    expect(sender).toContain('logStructuredEvent')
    expect(sender).toContain('userId')
    expect(sender).not.toMatch(/token:/)
    expect(sender).not.toMatch(/\burl\b/)
  })

  it('revokes existing sessions when a password is reset', async () => {
    const source = await projectFile('src/lib/auth/auth.server.ts')

    // If the password was reset because it was compromised, the attacker's
    // live session must not outlive the reset.
    expect(source).toMatch(/revokeSessionsOnPasswordReset:\s*true/)
  })

  it('builds the reset link from a private auth instance', async () => {
    const source = await projectFile('src/lib/auth/password-reset.server.ts')

    // Capturing the token by mutating the shared instance's options would
    // race with concurrent requests and could hand one caller's reset token
    // to another.
    expect(source).toContain('createAuth(')
    expect(source).not.toMatch(/getAuth\(\)/)
  })
})

describe('administrator bootstrap fails closed', () => {
  it('is exposed only as an operator script, never over HTTP', async () => {
    const bootstrap = await projectFile('src/lib/auth/bootstrap.server.ts')
    expect(bootstrap).toContain("import '@tanstack/react-start/server-only'")

    // A route or server function importing it would make the first-admin
    // path reachable by an anonymous request.
    const routes = await projectFile('src/routes/api.auth.$.ts')
    expect(routes).not.toContain('bootstrap')
  })

  it('checks safety before it writes anything', async () => {
    const source = await projectFile('src/lib/auth/bootstrap.server.ts')
    const body = source.slice(source.indexOf('export async function bootstrapAdministrator'))

    const guardAt = body.indexOf('assertSafeBootstrapCredential')
    const writeAt = body.indexOf('provisionCredentialUser')
    expect(guardAt).toBeGreaterThan(-1)
    expect(writeAt).toBeGreaterThan(guardAt)
  })

  it('never resets an existing administrator password', async () => {
    const source = await projectFile('src/lib/auth/bootstrap.server.ts')

    // An idempotent command that silently rewrote a credential would be a
    // backdoor, not a bootstrap: anyone able to run the deploy script could
    // take over the existing administrator account.
    expect(source).not.toContain('updatePassword')
    expect(source).toContain('already_bootstrapped')
  })
})
