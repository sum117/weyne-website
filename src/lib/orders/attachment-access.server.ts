import {
  authorizeCommercialAction,
  type CommercialActor,
  type CommercialResourceScope,
} from './security-policy.server'

/**
 * Server-side attachment capability projection for the order-detail UI.
 *
 * Capabilities are advisory: the client uses them only to hide or disable
 * controls. Every list, upload, download, and delete call re-evaluates the
 * shared RBAC policy server-side, so a stale or forged capability can never
 * widen access.
 */

export type OrderAttachmentCapabilities = Readonly<{
  /** May this actor see the attachment panel at all? */
  readonly canList: boolean
  /** May this actor fetch file bytes? */
  readonly canDownload: boolean
  /** May this actor upload new attachments to this order right now? */
  readonly canUpload: boolean
  /**
   * Per-attachment delete is decided by the server per row (representatives
   * may only remove their own uploads on open orders). This flag reflects the
   * actor's coarse ability so the whole action column can be hidden when no
   * row could ever be deletable by this actor.
   */
  readonly mayDeleteAny: boolean
}>

export const NO_ATTACHMENT_CAPABILITIES: OrderAttachmentCapabilities = Object.freeze({
  canList: false,
  canDownload: false,
  canUpload: false,
  mayDeleteAny: false,
})

/**
 * Evaluates every attachment action against the same policy matrix the
 * endpoints use, for one order scope. `scope` must come from server-side
 * storage — never from request data.
 */
export function resolveOrderAttachmentCapabilities(
  actor: CommercialActor,
  scope: CommercialResourceScope,
): OrderAttachmentCapabilities {
  const canList =
    authorizeCommercialAction(actor, 'order.attachment.list', scope) === 'allow'
  if (!canList) return NO_ATTACHMENT_CAPABILITIES

  return Object.freeze({
    canList,
    canDownload:
      authorizeCommercialAction(actor, 'order.attachment.download', scope) === 'allow',
    canUpload:
      authorizeCommercialAction(actor, 'order.attachment.upload', scope) === 'allow',
    // A representative can delete at least their own attachments while the
    // order is open; admins can delete on open/confirmed orders. The final
    // per-row decision still belongs to the endpoint.
    mayDeleteAny:
      actor.role === 'admin'
        ? scope.status === 'open' || scope.status === 'confirmed'
        : actor.role === 'representative' && scope.status === 'open',
  })
}
