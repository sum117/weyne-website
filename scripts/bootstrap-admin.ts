/**
 * One-time administrator bootstrap.
 *
 * A freshly migrated database has no identity and public sign-up is disabled,
 * so this is the only way to obtain the first administrator. Run it once
 * after `bun run db:migrate`; running it again is a safe no-op.
 *
 * Operations only. It authorizes nothing — there is no identity to authorize
 * against yet — so it must never be exposed through an HTTP surface.
 *
 *   DATABASE_URL=... BETTER_AUTH_URL=... BETTER_AUTH_SECRET=... \
 *     WEYNE_BOOTSTRAP_ADMIN_NAME='Nome Sobrenome' \
 *     WEYNE_BOOTSTRAP_ADMIN_EMAIL='admin@empresa.com.br' \
 *     WEYNE_BOOTSTRAP_ADMIN_PASSWORD='...' \
 *     bun scripts/bootstrap-admin.ts
 *
 * Outside production the three values may also be passed as arguments for
 * convenience:
 *
 *   bun scripts/bootstrap-admin.ts <name> <email> <password>
 *
 * Production refuses an argv password: an argument is visible in the process
 * table and in the shell history of the machine it was typed on.
 */
import { closeDatabase, getDatabase } from '../src/lib/db/database.server'
import { createAuth } from '../src/lib/auth/auth.server'
import { parseAuthConfig } from '../src/lib/auth/config.server'
import { bootstrapAdministrator } from '../src/lib/auth/bootstrap.server'

const [argvName, argvEmail, argvPassword] = process.argv.slice(2)

const name = process.env.WEYNE_BOOTSTRAP_ADMIN_NAME ?? argvName ?? ''
const email = process.env.WEYNE_BOOTSTRAP_ADMIN_EMAIL ?? argvEmail ?? ''
const environmentPassword = process.env.WEYNE_BOOTSTRAP_ADMIN_PASSWORD
const password = environmentPassword ?? argvPassword ?? ''

if (!name || !email || !password) {
  console.error(
    'Usage: WEYNE_BOOTSTRAP_ADMIN_NAME=... WEYNE_BOOTSTRAP_ADMIN_EMAIL=... WEYNE_BOOTSTRAP_ADMIN_PASSWORD=... bun scripts/bootstrap-admin.ts',
  )
  process.exit(1)
}

try {
  const config = parseAuthConfig(process.env)
  const database = await getDatabase()
  const outcome = await bootstrapAdministrator(
    createAuth(database, config),
    database,
    { name, email, password },
    {
      isProduction: config.isProduction,
      passwordFromArgv: environmentPassword === undefined,
    },
  )

  if (outcome.status === 'already_bootstrapped') {
    // Not an error: a redeploy re-running the command must succeed.
    console.info(
      JSON.stringify({
        event: 'auth.bootstrap_skipped',
        reason: 'an administrator already exists',
        administratorCount: outcome.administratorCount,
      }),
    )
  } else {
    // Identifiers only; never the password or its hash.
    console.info(
      JSON.stringify({
        event: 'auth.bootstrap_succeeded',
        userId: outcome.userId,
        email: outcome.email,
      }),
    )
  }
} catch (error) {
  console.error(
    JSON.stringify({
      event: 'auth.bootstrap_failed',
      message: error instanceof Error ? error.message : 'unknown error',
    }),
  )
  process.exitCode = 1
} finally {
  await closeDatabase()
}
