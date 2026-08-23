import { describe, expect, it } from 'vitest'
import {
  orderHistoryEventSchema,
  orderHistoryInputSchema,
  orderHistoryOutputSchema,
} from '@/domain/orders/contracts'
import {
  createOrderHistoryService,
  type OrderHistoryAuditRow,
  type OrderHistorySource,
} from '@/domain/orders/history-service.server'
import type { CommercialActor } from '@/lib/orders/security-policy.server'

const tenantA = '10000000-0000-4000-8000-000000000001'
const orderId = '30000000-0000-4000-8000-000000000001'
const attachmentId = '80000000-0000-4000-8000-000000000001'

const admin: CommercialActor = { id: 'admin-a', role: 'admin', tenantId: tenantA }
const representative: CommercialActor = {
  id: 'rep-a',
  role: 'representative',
  tenantId: tenantA,
}
const outsider: CommercialActor = { id: 'rep-b', role: 'representative', tenantId: tenantA }
const reader: CommercialActor = { id: 'reader-a', role: 'read_only', tenantId: tenantA }

const scope = {
  tenantId: tenantA,
  ownerUserId: representative.id,
  assignedUserIds: [reader.id] as readonly string[],
  status: 'open',
}

function row(overrides: Partial<OrderHistoryAuditRow> & Pick<OrderHistoryAuditRow, 'id'>): OrderHistoryAuditRow {
  return Object.freeze({
    type: 'order.status_changed',
    occurredAt: new Date('2026-08-20T12:00:00.000Z'),
    actorId: 'admin-a',
    description: 'Situação do pedido atualizada: motivo',
    attachment: null,
    ...overrides,
  })
}

/** Sensitive rows a buggy implementation might leak from audit sources. */
const sensitiveRows: readonly OrderHistoryAuditRow[] = [
  // Not representable in the allowlisted type union — simulates auth internals.
  row({
    id: 'auth-attempt',
    type: 'auth.attempt.logged',
  } as unknown as OrderHistoryAuditRow),
]

class MemorySource {
  rows: readonly OrderHistoryAuditRow[] = []
  loadCalls = 0
  deniedActors: readonly string[] = []

  loadAuditRows(orderId_: string): Promise<readonly OrderHistoryAuditRow[]> {
    if (orderId_ !== orderId) return Promise.resolve([])
    this.loadCalls += 1
    return Promise.resolve(this.rows)
  }

  async resolveResourceAccess(actor: CommercialActor, id: string) {
    if (id !== orderId || actor.tenantId !== tenantA) {
      return { ok: false as const, error: { category: 'not-found' as const } }
    }
    const isAssigned =
      scope.ownerUserId === actor.id ||
      scope.assignedUserIds.includes(actor.id)
    if (actor.role === 'read_only' && !isAssigned) {
      return { ok: false as const, error: { category: 'not-found' as const } }
    }
    if (actor.role === 'representative' && !isAssigned) {
      return { ok: false as const, error: { category: 'not-found' as const } }
    }
    return {
      ok: true as const,
      data: {
        scope,
        authorization: (actor.role === 'read_only'
          ? 'allow_redacted'
          : 'allow') as 'allow' | 'allow_redacted',
      },
    }
  }
}

function createHarness(rows: readonly OrderHistoryAuditRow[] = []) {
  const source = new MemorySource()
  source.rows = [...rows, ...sensitiveRows]
  const service = createOrderHistoryService(source as unknown as OrderHistorySource)
  return { service, source }
}

describe('history input validation', () => {
  it('defaults to reverse chronological order with bounded page size', () => {
    const parsed = orderHistoryInputSchema.parse({ id: orderId })
    expect(parsed).toMatchObject({ id: orderId, direction: 'desc', limit: 25 })
  })

  it('rejects limits above the hard cap and unknown fields', () => {
    expect(orderHistoryInputSchema.safeParse({ id: orderId, limit: 101 }).success).toBe(false)
    expect(orderHistoryInputSchema.safeParse({ id: orderId, extra: true }).success).toBe(false)
    expect(orderHistoryInputSchema.safeParse({}).success).toBe(false)
  })
})

describe('unified history ordering and merge', () => {
  it('merges lifecycle and attachment events into one deterministic desc timeline', async () => {
    const { service } = createHarness([
      row({ id: 'b-late-lifecycle', occurredAt: new Date('2026-08-21T10:00:00.000Z') }),
      row({
        id: 'a-upload',
        type: 'order.attachment.uploaded',
        occurredAt: new Date('2026-08-19T09:00:00.000Z'),
        description: 'Anexo enviado: Contrato assinado',
        attachment: { id: attachmentId, label: 'Contrato assinado' },
      }),
      row({ id: 'c-created', type: 'order.created', occurredAt: new Date('2026-08-18T08:00:00.000Z'), description: 'Pedido criado' }),
      row({ id: 'd-delete', type: 'order.attachment.deleted', occurredAt: new Date('2026-08-19T09:00:00.000Z'), description: 'Anexo excluído: Duplicata' , attachment: { id: attachmentId, label: 'Duplicata' } }),
      row({ id: 'e-transition', occurredAt: new Date('2026-08-20T12:00:00.000Z') }),
    ])

    const result = await service.history(admin, { id: orderId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.events.map((event) => event.id)).toEqual([
      'b-late-lifecycle',
      'e-transition',
      'd-delete',
      'a-upload',
      'c-created',
    ])
  })

  it('breaks equal timestamps by stable id tiebreaker in both directions', async () => {
    const sameTime = new Date('2026-08-20T12:00:00.000Z')
    const { service } = createHarness([
      row({ id: 'zzz', occurredAt: sameTime }),
      row({ id: 'aaa', occurredAt: sameTime }),
      row({ id: 'mmm', occurredAt: sameTime }),
    ])
    const descending = await service.history(admin, { id: orderId })
    const ascending = await service.history(admin, { id: orderId, direction: 'asc' })
    expect(descending.ok && ascending.ok).toBe(true)
    if (!descending.ok || !ascending.ok) return
    expect(descending.data.events.map((event) => event.id)).toEqual(['zzz', 'mmm', 'aaa'])
    expect(ascending.data.events.map((event) => event.id)).toEqual(['aaa', 'mmm', 'zzz'])
  })

  it('renders safe descriptions, actor ids, and attachment labels only', async () => {
    const { service } = createHarness([
      row({
        id: 'evt-1',
        type: 'order.attachment.uploaded',
        occurredAt: new Date('2026-08-21T12:00:00.000Z'),
        description: 'Anexo enviado: NF-e',
        attachment: { id: attachmentId, label: 'NF-e' },
        actorId: 'rep-a',
      }),
      row({ id: 'evt-2', type: 'order.created', description: 'Pedido criado', actorId: null }),
    ])
    const result = await service.history(representative, { id: orderId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const event of result.data.events) {
      expect(orderHistoryEventSchema.safeParse(event).success).toBe(true)
    }
    expect(result.data.events[0]).toMatchObject({
      description: 'Anexo enviado: NF-e',
      actorId: 'rep-a',
      attachment: { id: attachmentId, label: 'NF-e' },
    })
    expect(result.data.events[1]).toMatchObject({ actorId: null, attachment: null })
  })

  it('excludes sensitive auth/audit rows from every page', async () => {
    const { service } = createHarness(
      Array.from({ length: 30 }, (_, index) =>
        row({ id: `evt-${String(index).padStart(2, '0')}` }),
      ),
    )
    const firstPage = await service.history(admin, { id: orderId, limit: 10 })
    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) return
    const allIds = new Set(firstPage.data.events.map((event) => event.id))
    let cursor = firstPage.data.nextCursor
    while (cursor) {
      const page = await service.history(admin, { id: orderId, limit: 10, cursor })
      expect(page.ok).toBe(true)
      if (!page.ok) break
      for (const event of page.data.events) allIds.add(event.id)
      cursor = page.data.nextCursor
    }
    expect(allIds.has('auth-attempt')).toBe(false)
    expect(allIds.size).toBe(30)
    for (const id of allIds) {
      expect(id.startsWith('evt-')).toBe(true)
    }
  })
})

describe('history pagination', () => {
  const fullTimeline = Array.from({ length: 7 }, (_, index) =>
    row({
      id: `evt-${index}`,
      occurredAt: new Date(Date.UTC(2026, 7, 20, 12, index)),
    }),
  )

  it('pages deterministically forward through the whole timeline', async () => {
    const { service } = createHarness(fullTimeline)
    const collected: string[] = []
    let cursor: string | null = null
    do {
      const result = await service.history(admin, {
        id: orderId,
        limit: 3,
        ...(cursor ? { cursor } : {}),
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      collected.push(...result.data.events.map((event) => event.id))
      cursor = result.data.nextCursor
    } while (cursor)
    expect(collected).toHaveLength(7)
    expect(new Set(collected).size).toBe(7)
    expect(collected).toEqual([...fullTimeline].reverse().map((row_) => row_.id))
  })

  it('returns an empty final page signal when the timeline fits one page', async () => {
    const { service } = createHarness(fullTimeline.slice(0, 2))
    const result = await service.history(admin, { id: orderId, limit: 25 })
    expect(result.ok && result.data.nextCursor === null).toBe(true)
  })

  it('rejects malformed cursors as validation errors', async () => {
    const { service } = createHarness(fullTimeline)
    const result = await service.history(admin, { id: orderId, cursor: '!!!not-base64url!!!' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatchObject({
      category: 'validation',
      issues: [{ path: ['cursor'] }],
    })
  })
})

describe('history authorization', () => {
  it('denies actors outside the order scope with not-found', async () => {
    const { service, source } = createHarness([row({ id: 'evt-0' })])
    const result = await service.history(outsider, { id: orderId })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({ category: 'not-found' })
    expect(source.loadCalls).toBe(0)
  })

  it('never loads audit rows before authorization succeeds', async () => {
    const { service, source } = createHarness([row({ id: 'evt-0' })])
    await service.history(outsider, { id: orderId })
    await service.history({ ...representative, tenantId: '99999999-0000-4000-8000-000000000001' }, { id: orderId })
    expect(source.loadCalls).toBe(0)
  })

  it('allows read_only actors assigned to the order (redacted read surface)', async () => {
    const { service } = createHarness([row({ id: 'evt-0' })])
    const result = await service.history(reader, { id: orderId })
    expect(result.ok).toBe(true)
  })
})

describe('source immutability', () => {
  it('does not mutate or reorder the underlying audit rows', async () => {
    const rows = [
      row({ id: 'b', occurredAt: new Date('2026-08-21T00:00:00.000Z') }),
      row({ id: 'a', occurredAt: new Date('2026-08-19T00:00:00.000Z') }),
    ]
    const before = rows.map((row_) => ({ ...row_, occurredAt: new Date(row_.occurredAt) }))
    const { service } = createHarness(rows)
    await service.history(admin, { id: orderId, direction: 'asc' })
    await service.history(admin, { id: orderId, direction: 'desc' })
    expect(rows.map((row_) => row_.id)).toEqual(before.map((row_) => row_.id))
    expect(rows.map((row_) => row_.occurredAt.getTime())).toEqual(
      before.map((row_) => row_.occurredAt.getTime()),
    )
  })

  it('emits events that validate against the published output schema', async () => {
    const { service } = createHarness([
      row({
        id: 'evt-0',
        type: 'order.attachment.deleted',
        description: 'Anexo excluído: Contrato',
        attachment: { id: attachmentId, label: 'Contrato' },
      }),
    ])
    const result = await service.history(admin, { id: orderId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parsed = orderHistoryOutputSchema.safeParse(result.data)
    expect(parsed.success).toBe(true)
  })
})
