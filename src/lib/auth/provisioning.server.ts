import '@tanstack/react-start/server-only'
import type { Auth } from './auth.server'
import type { userRoleEnum } from '@/lib/db/schema/canonical'

/**
 * Server-only credential provisioning.
 *
 * Public sign-up is disabled (`disableSignUp: true`), so identities enter the
 * system through an administrator. This module is the single seam that turns
 * an authorized administrative decision into a Better Auth credential
 * identity; the invite and password-reset delivery flows build on top of it.
 *
 * Every cryptographic step is Better Auth's: the password is hashed by
 * `context.password.hash` (scrypt by default) and the row is written by
 * `context.internalAdapter`. This module implements no hashing, no tokens,
 * and no cookie handling.
 *
 * It performs NO authorization of its own. Callers are responsible for
 * proving the actor may create users before invoking it.
 */

export type UserRole = (typeof userRoleEnum)['enumValues'][number]

export type ProvisionCredentialUserInput = Readonly<{
  name: string
  email: string
  password: string
  role: UserRole
}>

export type ProvisionedUser = Readonly<{
  id: string
  email: string
  role: UserRole
}>

export async function provisionCredentialUser(
  auth: Auth,
  input: ProvisionCredentialUserInput,
): Promise<ProvisionedUser> {
  const context = await auth.$context
  const normalizedEmail = input.email.trim().toLowerCase()

  const existing = await context.internalAdapter.findUserByEmail(normalizedEmail)
  if (existing) {
    throw new Error('A user with this email address already exists')
  }

  const minimumLength = context.password.config.minPasswordLength
  if (input.password.length < minimumLength) {
    throw new Error(`Password must be at least ${minimumLength} characters`)
  }

  // Hash BEFORE creating the user: a hashing failure must not leave an
  // identity behind that can never sign in.
  const hash = await context.password.hash(input.password)

  const user = await context.internalAdapter.createUser({
    name: input.name.trim(),
    email: normalizedEmail,
    role: input.role,
  })

  await context.internalAdapter.createAccount({
    userId: user.id,
    // `credential` is Better Auth's provider id for email/password accounts;
    // the sign-in route looks the account up by exactly this value.
    providerId: 'credential',
    accountId: user.id,
    password: hash,
  })

  return Object.freeze({
    id: user.id,
    email: user.email,
    role: input.role,
  })
}
