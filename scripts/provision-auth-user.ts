/**
 * One-off operator utility: provision a credential identity directly against
 * the configured database. Development/operations only — it authorizes
 * nothing, so it must never be exposed through an HTTP surface.
 *
 *   DATABASE_URL=... BETTER_AUTH_URL=... \
 *     bun scripts/provision-auth-user.ts <name> <email> <password> <role>
 */
import { closeDatabase, getDatabase } from '../src/lib/db/database.server'
import { createAuth } from '../src/lib/auth/auth.server'
import { parseAuthConfig } from '../src/lib/auth/config.server'
import {
  provisionCredentialUser,
  type UserRole,
} from '../src/lib/auth/provisioning.server'

const [name, email, password, role = 'read_only'] = process.argv.slice(2)

if (!name || !email || !password) {
  console.error(
    'Usage: bun scripts/provision-auth-user.ts <name> <email> <password> [role]',
  )
  process.exit(1)
}

if (role !== 'admin' && role !== 'representative' && role !== 'read_only') {
  console.error(`Unknown role ${JSON.stringify(role)}`)
  process.exit(1)
}

try {
  const auth = createAuth(await getDatabase(), parseAuthConfig(process.env))
  const user = await provisionCredentialUser(auth, {
    name,
    email,
    password,
    role: role as UserRole,
  })
  // Identifiers and role only; never the password or its hash.
  console.info(JSON.stringify({ event: 'auth.user_provisioned', ...user }))
} catch (error) {
  console.error(
    JSON.stringify({
      event: 'auth.user_provision_failed',
      message: error instanceof Error ? error.message : 'unknown error',
    }),
  )
  process.exitCode = 1
} finally {
  await closeDatabase()
}
