import { createAuth } from '../src/lib/auth/auth.server'
import { parseAuthConfig } from '../src/lib/auth/config.server'
import { provisionCredentialUser } from '../src/lib/auth/provisioning.server'
import { closeDatabase, getDatabase } from '../src/lib/db/database.server'
import { migrateDatabase } from '../src/lib/db/migrate.server'
import { AUTHENTICATED_SHELL_USERS } from '../tests/e2e/authenticated-shell.fixture'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for authenticated-shell e2e preparation')
}

try {
  await migrateDatabase()
  const auth = createAuth(await getDatabase(), parseAuthConfig(process.env))

  for (const user of Object.values(AUTHENTICATED_SHELL_USERS)) {
    await provisionCredentialUser(auth, user)
  }
} finally {
  await closeDatabase()
}
