import type { UserManagementRole } from './user-management.schema'

/**
 * Narrow, deliberately serializable user DTOs for the admin user-management
 * surface (`/app/configuracoes/usuarios`). These projections never include
 * Better Auth credential material: no `accounts.password` hash, no session
 * tokens, no `auth_subject`, and no verification values.
 */
export type ManagedUser = Readonly<{
  id: string
  name: string
  email: string
  role: UserManagementRole
  active: boolean
  createdAt: string
  disabledAt: string | null
}>

export type ManagedUserListItem = Readonly<{
  id: string
  name: string
  email: string
  role: UserManagementRole
  active: boolean
  lastSignInAt: string | null
  createdAt: string
}>

export type ManagedUserPage = Readonly<{
  items: readonly ManagedUserListItem[]
  nextCursor: string | null
}>

/**
 * Result of a successful role assignment or account-status change. The actor
 * receives the refreshed narrow projection of the target user only.
 */
export type ManagedUserMutationResult = Readonly<{
  user: ManagedUser
  revokedSessionCount: number | null
}>
