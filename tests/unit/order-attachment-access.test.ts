import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  NO_ATTACHMENT_CAPABILITIES,
  resolveOrderAttachmentCapabilities,
} from '@/lib/orders/attachment-access.server'
import type { CommercialActor, CommercialResourceScope } from '@/lib/orders/security-policy.server'

const admin: CommercialActor = { id: randomUUID(), role: 'admin', tenantId: randomUUID() }
const representative: CommercialActor = { id: randomUUID(), role: 'representative', tenantId: admin.tenantId }
const readOnly: CommercialActor = { id: randomUUID(), role: 'read_only', tenantId: admin.tenantId }

function scope(overrides: Partial<CommercialResourceScope> = {}): CommercialResourceScope {
  return {
    tenantId: admin.tenantId,
    ownerUserId: representative.id,
    assignedUserIds: [readOnly.id],
    status: 'open',
    ...overrides,
  }
}

describe('order attachment capability projection', () => {
  it('grants an owning representative full open-order capabilities', () => {
    expect(resolveOrderAttachmentCapabilities(representative, scope())).toEqual({
      canList: true,
      canDownload: true,
      canUpload: true,
      mayDeleteAny: true,
    })
  })

  it('grants an admin everything except upload/delete on closed orders', () => {
    const invoiced = resolveOrderAttachmentCapabilities(admin, scope({ status: 'invoiced' }))
    expect(invoiced).toEqual({
      canList: true,
      canDownload: true,
      canUpload: false,
      mayDeleteAny: false,
    })
  })

  it('denies read_only actors the panel entirely', () => {
    expect(resolveOrderAttachmentCapabilities(readOnly, scope())).toEqual(
      NO_ATTACHMENT_CAPABILITIES,
    )
  })

  it('treats out-of-scope actors as absent, not forbidden', () => {
    const outsider: CommercialActor = {
      id: randomUUID(),
      role: 'representative',
      tenantId: admin.tenantId,
    }
    expect(resolveOrderAttachmentCapabilities(outsider, scope())).toEqual(
      NO_ATTACHMENT_CAPABILITIES,
    )
  })

  it('blocks representative deletion once the order leaves open', () => {
    expect(
      resolveOrderAttachmentCapabilities(representative, scope({ status: 'confirmed' }))
        .mayDeleteAny,
    ).toBe(false)
    expect(
      resolveOrderAttachmentCapabilities(admin, scope({ status: 'confirmed' })).mayDeleteAny,
    ).toBe(true)
  })
})
