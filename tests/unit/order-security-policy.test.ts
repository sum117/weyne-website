import { describe, expect, it } from 'vitest'
import {
  authorizeCommercialAction,
  type CommercialActor,
  type CommercialResourceScope,
} from '@/lib/orders/security-policy.server'

const tenantA = '10000000-0000-4000-8000-000000000001'
const tenantB = '20000000-0000-4000-8000-000000000001'

const actors = {
  admin: { id: 'admin-a', role: 'admin', tenantId: tenantA },
  representative: {
    id: 'representative-a',
    role: 'representative',
    tenantId: tenantA,
  },
  readOnly: { id: 'reader-a', role: 'read_only', tenantId: tenantA },
} satisfies Record<string, CommercialActor>

function resource(
  overrides: Partial<CommercialResourceScope> = {},
): CommercialResourceScope {
  return {
    tenantId: tenantA,
    ownerUserId: 'representative-a',
    assignedUserIds: ['reader-a'],
    status: 'open',
    ...overrides,
  }
}

describe('commercial order and quote authorization policy', () => {
  it.each([
    ['quote.read', 'allow'],
    ['quote.approve', 'allow'],
    ['order.read', 'allow'],
    ['order.history.read', 'allow'],
    ['order.confirm', 'allow'],
    ['order.attachment.list', 'allow'],
    ['order.attachment.download', 'allow'],
    ['order.attachment.upload', 'allow'],
    ['order.attachment.delete', 'allow'],
  ] as const)('allows admin to perform %s inside the tenant', (action, expected) => {
    expect(authorizeCommercialAction(actors.admin, action, resource())).toBe(expected)
  })

  it.each([
    ['quote.read', 'allow'],
    ['quote.approve', 'forbidden'],
    ['order.read', 'allow'],
    ['order.history.read', 'allow'],
    ['order.confirm', 'forbidden'],
    ['order.attachment.list', 'allow'],
    ['order.attachment.download', 'allow'],
    ['order.attachment.upload', 'allow'],
  ] as const)(
    'applies representative own-record permissions for %s',
    (action, expected) => {
      expect(authorizeCommercialAction(actors.representative, action, resource())).toBe(
        expected,
      )
    },
  )

  it.each([
    ['quote.read', 'allow_redacted'],
    ['quote.approve', 'forbidden'],
    ['order.read', 'allow_redacted'],
    ['order.history.read', 'allow_redacted'],
    ['order.confirm', 'forbidden'],
    ['order.attachment.list', 'forbidden'],
    ['order.attachment.download', 'forbidden'],
    ['order.attachment.upload', 'forbidden'],
    ['order.attachment.delete', 'forbidden'],
  ] as const)(
    'limits explicitly assigned read-only users for %s',
    (action, expected) => {
      expect(authorizeCommercialAction(actors.readOnly, action, resource())).toBe(expected)
    },
  )

  it.each(Object.values(actors))(
    'conceals cross-tenant direct object IDs from $role',
    (actor) => {
      expect(
        authorizeCommercialAction(actor, 'order.read', resource({ tenantId: tenantB })),
      ).toBe('not_found')
      expect(
        authorizeCommercialAction(
          actor,
          'order.attachment.download',
          resource({ tenantId: tenantB }),
        ),
      ).toBe('not_found')
    },
  )

  it('conceals unowned and unassigned direct object IDs from non-admin roles', () => {
    const outsideScope = resource({
      ownerUserId: 'representative-b',
      assignedUserIds: [],
    })

    expect(
      authorizeCommercialAction(actors.representative, 'quote.read', outsideScope),
    ).toBe('not_found')
    expect(authorizeCommercialAction(actors.readOnly, 'order.read', outsideScope)).toBe(
      'not_found',
    )
  })

  it('restricts representative attachment deletion to open orders and own uploads', () => {
    expect(
      authorizeCommercialAction(
        actors.representative,
        'order.attachment.delete',
        resource(),
        { attachmentCreatedBy: actors.representative.id },
      ),
    ).toBe('allow')
    expect(
      authorizeCommercialAction(
        actors.representative,
        'order.attachment.delete',
        resource({ status: 'confirmed' }),
        { attachmentCreatedBy: actors.representative.id },
      ),
    ).toBe('forbidden')
    expect(
      authorizeCommercialAction(
        actors.representative,
        'order.attachment.delete',
        resource(),
        { attachmentCreatedBy: 'admin-a' },
      ),
    ).toBe('forbidden')
  })
})
