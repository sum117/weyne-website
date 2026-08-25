export type CommercialRole = 'admin' | 'representative' | 'read_only'

export type CommercialActor = Readonly<{
  id: string
  role: CommercialRole
  tenantId: string
}>

export type CommercialAction =
  | 'quote.read'
  | 'quote.approve'
  | 'order.read'
  | 'order.history.read'
  | 'order.confirm'
  | 'order.attachment.list'
  | 'order.attachment.download'
  | 'order.attachment.upload'
  | 'order.attachment.delete'

export type CommercialResourceScope = Readonly<{
  tenantId: string
  ownerUserId: string
  assignedUserIds: readonly string[]
  status: string
}>

export type AuthorizationResult = 'allow' | 'allow_redacted' | 'forbidden' | 'not_found'

const ATTACHMENT_READ_ACTIONS: readonly CommercialAction[] = [
  'order.attachment.list',
  'order.attachment.download',
]

export function authorizeCommercialAction(
  actor: CommercialActor,
  action: CommercialAction,
  resource: CommercialResourceScope,
  context: Readonly<{ attachmentCreatedBy?: string }> = {},
): AuthorizationResult {
  if (actor.tenantId !== resource.tenantId) return 'not_found'

  const ownsResource = resource.ownerUserId === actor.id
  const isAssigned = resource.assignedUserIds.includes(actor.id)

  if (actor.role === 'admin') {
    if (
      (action === 'order.attachment.upload' || action === 'order.attachment.delete') &&
      resource.status !== 'open' &&
      resource.status !== 'confirmed'
    ) {
      return 'forbidden'
    }
    return 'allow'
  }

  if (actor.role === 'read_only') {
    if (!isAssigned) return 'not_found'
    if (action === 'quote.read' || action === 'order.read' || action === 'order.history.read') {
      return 'allow_redacted'
    }
    return 'forbidden'
  }

  if (!ownsResource && !isAssigned) return 'not_found'
  if (action === 'quote.read' || action === 'order.read' || action === 'order.history.read') {
    return 'allow'
  }
  if (ATTACHMENT_READ_ACTIONS.includes(action)) return 'allow'
  if (action === 'order.attachment.upload') {
    return resource.status === 'open' || resource.status === 'confirmed'
      ? 'allow'
      : 'forbidden'
  }
  if (action === 'order.attachment.delete') {
    return resource.status === 'open' && context.attachmentCreatedBy === actor.id
      ? 'allow'
      : 'forbidden'
  }

  return 'forbidden'
}
