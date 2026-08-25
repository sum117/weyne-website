import '@tanstack/react-start/server-only'
import { eq, sql } from 'drizzle-orm'
import type { Auth } from './auth.server'
import type { Database } from '@/lib/db/database.server'
import { users } from '@/lib/db/schema/canonical'
import { provisionCredentialUser } from './provisioning.server'

/**
 * One-time administrator bootstrap.
 *
 * SERVER ONLY. A freshly migrated database has no identity, and public
 * sign-up is disabled, so without this there is no way in. It is the seam
 * that turns an empty `users` table into exactly one administrator, and it
 * must never be reachable over HTTP: it authorizes nothing, by design, since
 * there is no one to authorize against yet.
 *
 * Two properties make it safe to run from a deploy script:
 *
 * 1. IDEMPOTENT. It creates an administrator only when the database has none.
 *    A second run is a no-op that reports `already_bootstrapped` and exits
 *    successfully, so a redeploy or a retried job cannot mint a second
 *    administrator or overwrite the first one's password. It deliberately
 *    does NOT reset an existing password: an idempotent command that silently
 *    rewrote a credential would be a backdoor, not a bootstrap.
 * 2. FAILS CLOSED ON WEAK INPUT. Production refuses a placeholder password,
 *    a short password, and a password supplied on the command line, because
 *    an argv value is visible in the process table and the shell history of
 *    the machine it was typed on.
 *
 * Every cryptographic step belongs to Better Auth via `provisionCredentialUser`.
 */

/** Minimum bootstrap password length. Deliberately above the 12 Better Auth enforces. */
export const MINIMUM_BOOTSTRAP_PASSWORD_LENGTH = 16

/**
 * Values that must never protect an administrator account.
 *
 * Compared case-insensitively against the whole password, and also used as a
 * substring probe so `admin1234!` and `weyne-changeme-2026` are both refused.
 * This is not an attempt at a strength meter — it is a guard against the
 * specific failure of an example value from the documentation reaching
 * production untouched.
 */
const FORBIDDEN_PASSWORD_FRAGMENTS: readonly string[] = [
  'changeme',
  'change-me',
  'password',
  'senha',
  'admin',
  'weyne',
  'placeholder',
  'example',
  'trocar',
  'secret',
  '12345678',
  'qwerty',
]

export type BootstrapOutcome =
  | Readonly<{ status: 'created'; userId: string; email: string }>
  | Readonly<{ status: 'already_bootstrapped'; administratorCount: number }>

export type BootstrapAdminInput = Readonly<{
  name: string
  email: string
  password: string
}>

export type BootstrapEnvironment = Readonly<{
  isProduction: boolean
  /** True when the password arrived as a command-line argument. */
  passwordFromArgv: boolean
}>

/**
 * Validates the requested administrator credential.
 *
 * Throws on anything unsafe. The message names the rule that was broken and
 * never echoes the password itself, so a failed bootstrap cannot leak the
 * value through a log or a crash report.
 */
export function assertSafeBootstrapCredential(
  input: BootstrapAdminInput,
  environment: BootstrapEnvironment,
): void {
  if (input.name.trim().length === 0) {
    throw new Error('Administrator name is required')
  }
  const email = input.email.trim()
  // Deliberately minimal: an address with a local part, an `@`, and a dotted
  // domain. The bootstrap does not send mail, so a stricter grammar would
  // only reject valid addresses for no gain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Administrator email must be a valid address')
  }

  if (input.password.length < MINIMUM_BOOTSTRAP_PASSWORD_LENGTH) {
    throw new Error(
      `Administrator password must be at least ${MINIMUM_BOOTSTRAP_PASSWORD_LENGTH} characters`,
    )
  }

  const normalized = input.password.toLowerCase()
  const matched = FORBIDDEN_PASSWORD_FRAGMENTS.find((fragment) =>
    normalized.includes(fragment),
  )
  if (matched) {
    throw new Error(
      'Administrator password contains a well-known placeholder value; choose a unique secret',
    )
  }

  if (environment.isProduction && environment.passwordFromArgv) {
    throw new Error(
      'Refusing to read the administrator password from a command-line argument in production; pass WEYNE_BOOTSTRAP_ADMIN_PASSWORD instead',
    )
  }
}

/**
 * Creates the first administrator, or reports that one already exists.
 *
 * The existence check counts administrators rather than users: a database
 * seeded with read-only identities still has no way in, and must still be
 * bootstrappable.
 */
export async function bootstrapAdministrator(
  auth: Auth,
  database: Database,
  input: BootstrapAdminInput,
  environment: BootstrapEnvironment,
): Promise<BootstrapOutcome> {
  assertSafeBootstrapCredential(input, environment)

  const existing = await countAdministrators(database)
  if (existing > 0) {
    return Object.freeze({
      status: 'already_bootstrapped',
      administratorCount: existing,
    })
  }

  const user = await provisionCredentialUser(auth, {
    name: input.name,
    email: input.email,
    password: input.password,
    role: 'admin',
  })

  // Re-check after the write. Two bootstraps racing on a fresh database would
  // both observe zero administrators and both insert; the loser is removed
  // here so the invariant "the bootstrap creates exactly one administrator"
  // survives concurrency. The unique index on `lower(email)` already stops
  // the narrower case of the same address twice.
  const total = await countAdministrators(database)
  if (total > 1) {
    const survivor = await oldestAdministratorId(database)
    if (survivor !== null && survivor !== user.id) {
      await database.delete(users).where(eq(users.id, user.id))
      return Object.freeze({
        status: 'already_bootstrapped',
        administratorCount: total - 1,
      })
    }
  }

  return Object.freeze({
    status: 'created',
    userId: user.id,
    email: user.email,
  })
}

async function countAdministrators(database: Database): Promise<number> {
  const [row] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.role, 'admin'))
  return row?.total ?? 0
}

async function oldestAdministratorId(database: Database): Promise<string | null> {
  const [row] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .orderBy(users.createdAt, users.id)
    .limit(1)
  return row?.id ?? null
}
