export type QuoteMutationRole =
  | 'admin'
  | 'representative'
  | 'read_only'
  | 'system'

export interface QuoteMutationActor {
  readonly id: string
  readonly role: QuoteMutationRole
  readonly permissions: readonly string[]
}

export type QuoteMutationScope = 'any' | 'own'

export function isQuoteMutationAuthorized(input: {
  readonly actor: QuoteMutationActor
  readonly ownerUserId: string
  readonly permission: string
}): boolean {
  const { actor, ownerUserId, permission } = input
  if (actor.role === 'read_only') return false

  return (
    actor.permissions.includes(`${permission}:any`) ||
    (actor.permissions.includes(`${permission}:own`) && actor.id === ownerUserId)
  )
}
