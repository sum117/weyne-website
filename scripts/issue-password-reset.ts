/**
 * Issue a single-use password reset / invitation link for an existing
 * identity, and print it.
 *
 * This release has no mail transport, so delivery is manual: run the command,
 * then hand the link to the person through a channel you already trust. The
 * same command serves an invitation (a provisioned identity that has never
 * signed in) and a reset (a forgotten password) — both need exactly one
 * single-use proof that lets the owner choose a password.
 *
 * Operations only. It authorizes nothing, so it must never be exposed
 * through an HTTP surface.
 *
 *   DATABASE_URL=... BETTER_AUTH_URL=... BETTER_AUTH_SECRET=... \
 *     bun scripts/issue-password-reset.ts <email>
 *
 * The link is a bearer credential for that account until it is used or
 * expires: treat the terminal output as a secret, and prefer a channel that
 * is not archived.
 */
import { closeDatabase, getDatabase } from '../src/lib/db/database.server'
import { parseAuthConfig } from '../src/lib/auth/config.server'
import { issuePasswordResetLink } from '../src/lib/auth/password-reset.server'

const [email] = process.argv.slice(2)

if (!email) {
  console.error('Usage: bun scripts/issue-password-reset.ts <email>')
  process.exit(1)
}

try {
  const config = parseAuthConfig(process.env)
  const outcome = await issuePasswordResetLink(
    await getDatabase(),
    config,
    email,
  )

  if (outcome.status === 'unknown_identity') {
    // The operator needs the truth here; the HTTP surface still does not
    // distinguish a known address from an unknown one.
    console.error(
      JSON.stringify({
        event: 'auth.reset_link_not_issued',
        reason: 'no identity exists for this email address',
      }),
    )
    process.exitCode = 1
  } else {
    // The URL carries the token, so this is the one place a secret is
    // deliberately printed. It goes to stdout for the operator to copy and
    // never through the structured logger, which ships to disk.
    console.info(
      JSON.stringify({
        event: 'auth.reset_link_issued',
        expiresInSeconds: outcome.expiresInSeconds,
      }),
    )
    console.info(outcome.url)
  }
} catch (error) {
  console.error(
    JSON.stringify({
      event: 'auth.reset_link_failed',
      message: error instanceof Error ? error.message : 'unknown error',
    }),
  )
  process.exitCode = 1
} finally {
  await closeDatabase()
}
