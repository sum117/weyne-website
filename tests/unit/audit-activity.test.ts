import { describe, expect, it, vi } from 'vitest'
import {
  createAuditActivityQuery,
  type AuditEventRow,
} from '@/lib/audit/activity.server'
import { createPostgresQuoteAuditRepository } from '@/lib/audit/quote-audit-repository.server'

const admin = { id: 'admin-1', role: 'admin' as const, displayName: 'Administrador' }

function repository() {
  return {
    listEvents: vi.fn(async (): Promise<readonly AuditEventRow[]> => []),
    loadActorMetadata: vi.fn(async () => new Map()),
    loadEntityMetadata: vi.fn(async () => new Map()),
  }
}

describe('authorized audit activity query', () => {
  it('denies an unauthenticated request before accessing the event store', async () => {
    const store = repository()
    const query = createAuditActivityQuery({
      authenticate: async () => null,
      repository: store,
      authorizeEntities: async () => new Set<string>(),
    })

    await expect(query({})).resolves.toEqual({
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        status: 401,
        message: 'Autenticação necessária.',
      },
    })
    expect(store.listEvents).not.toHaveBeenCalled()
  })

  it('denies a non-admin request directly before accessing the event store', async () => {
    const store = repository()
    const query = createAuditActivityQuery({
      authenticate: async () => ({ ...admin, role: 'representative' as const }),
      repository: store,
      authorizeEntities: async () => new Set<string>(),
    })

    await expect(query({})).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', status: 403 },
    })
    expect(store.listEvents).not.toHaveBeenCalled()
  })

  it('validates bounded filters before querying the event store', async () => {
    const store = repository()
    const query = createAuditActivityQuery({
      authenticate: async () => admin,
      repository: store,
      authorizeEntities: async () => new Set<string>(),
    })

    const result = await query({
      limit: 101,
      filters: {
        actorId: 'a'.repeat(129),
        occurredFrom: '2026-01-01T00:00:00.000Z',
        occurredTo: '2026-05-01T00:00:00.000Z',
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FILTER', status: 400 },
    })
    expect(store.listEvents).not.toHaveBeenCalled()
  })

  it('returns stable pages, batched metadata, authorized links, and redacted summaries', async () => {
    const store = repository()
    store.listEvents.mockResolvedValue([
      {
        id: '30000000-0000-4000-8000-000000000003',
        actorId: 'admin-1',
        action: 'update',
        entity: { type: 'quote', id: '10000000-0000-4000-8000-000000000001' },
        occurredAt: new Date('2026-08-17T12:00:00.000Z'),
        correlationId: 'request-3',
        before: { status: 'draft', password: 'before-secret', customer: { email: 'a@example.test' } },
        after: { status: 'sent', accessToken: 'after-secret', lines: [{ quantity: '2', apiKey: 'nested-secret' }] },
      },
      {
        id: '20000000-0000-4000-8000-000000000002',
        actorId: 'admin-1',
        action: 'create',
        entity: { type: 'quote', id: '10000000-0000-4000-8000-000000000001' },
        occurredAt: new Date('2026-08-17T12:00:00.000Z'),
        correlationId: 'request-2',
        before: null,
        after: { status: 'draft' },
      },
    ])
    store.loadActorMetadata.mockResolvedValue(new Map([['admin-1', 'Ana Admin']]))
    store.loadEntityMetadata.mockResolvedValue(
      new Map([['quote:10000000-0000-4000-8000-000000000001', 'ORC-2026-000001']]),
    )
    const authorizeEntities = vi.fn(async () =>
      new Set(['quote:10000000-0000-4000-8000-000000000001']),
    )
    const query = createAuditActivityQuery({
      authenticate: async () => admin,
      repository: store,
      authorizeEntities,
    })

    const result = await query({ limit: 1, filters: { action: 'update' } })

    expect(store.listEvents).toHaveBeenCalledWith({
      limit: 2,
      cursor: null,
      filters: { action: 'update' },
      orderBy: ['occurredAt:desc', 'id:desc'],
    })
    expect(store.loadActorMetadata).toHaveBeenCalledTimes(1)
    expect(authorizeEntities).toHaveBeenCalledTimes(1)
    expect(store.loadEntityMetadata).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            actor: { id: 'admin-1', displayName: 'Ana Admin' },
            description: 'Ana Admin atualizou o orçamento ORC-2026-000001.',
            before: { status: 'draft', password: '[REDACTED]' },
            after: {
              status: 'sent',
              accessToken: '[REDACTED]',
              lines: [{ quantity: '2', apiKey: '[REDACTED]' }],
            },
            entity: {
              type: 'quote',
              id: '10000000-0000-4000-8000-000000000001',
              displayName: 'ORC-2026-000001',
              href: '/app/orcamentos/10000000-0000-4000-8000-000000000001',
            },
          },
        ],
      },
    })
    expect(JSON.stringify(result)).not.toContain('before-secret')
    expect(JSON.stringify(result)).not.toContain('after-secret')
    expect(JSON.stringify(result)).not.toContain('nested-secret')
    expect(result.ok && result.data.nextCursor).toEqual(expect.any(String))
  })

  it('omits entity display metadata and links when access is not authorized', async () => {
    const store = repository()
    store.listEvents.mockResolvedValue([
      {
        id: '30000000-0000-4000-8000-000000000003',
        actorId: 'admin-1',
        action: 'update',
        entity: { type: 'quote', id: '10000000-0000-4000-8000-000000000001' },
        occurredAt: new Date('2026-08-17T12:00:00.000Z'),
        correlationId: 'request-3',
        before: null,
        after: { status: 'sent' },
      },
    ])
    const query = createAuditActivityQuery({
      authenticate: async () => admin,
      repository: store,
      authorizeEntities: async () => new Set<string>(),
    })

    const result = await query({})

    expect(store.loadEntityMetadata).toHaveBeenCalledWith([])
    expect(result).toMatchObject({
      ok: true,
      data: {
        items: [{ entity: { type: 'quote', id: '10000000-0000-4000-8000-000000000001' } }],
      },
    })
    expect(result.ok && result.data.items[0]?.entity).not.toHaveProperty('href')
    expect(result.ok && result.data.items[0]?.entity).not.toHaveProperty('displayName')
  })
})

describe('PostgreSQL quote audit adapter', () => {
  it('pushes bounded filters and the deterministic keyset order into one event query', async () => {
    const unsafe = vi.fn(async (statement: string) =>
      statement.includes('SELECT')
        ? [
            {
              id: '30000000-0000-4000-8000-000000000003',
              quoteId: '10000000-0000-4000-8000-000000000001',
              actorId: 'admin-1',
              operation: 'update',
              commandId: 'request-3',
              beforeState: { status: 'draft' },
              afterState: { status: 'sent' },
              occurredAt: new Date('2026-08-17T12:00:00.000Z'),
            },
          ]
        : [],
    )
    const repository = createPostgresQuoteAuditRepository({
      sql: { unsafe } as never,
      schemaName: 'public',
      loadActorNames: async (ids) => new Map(ids.map((id) => [id, id])),
    })

    const rows = await repository.listEvents({
      limit: 26,
      cursor: {
        occurredAt: '2026-08-18T00:00:00.000Z',
        id: '40000000-0000-4000-8000-000000000004',
      },
      filters: { actorId: 'admin-1', action: 'update', correlationId: 'request-3' },
      orderBy: ['occurredAt:desc', 'id:desc'],
    })

    const calls = unsafe.mock.calls as unknown as Array<[string, unknown[]?]>
    const [query = '', parameters] = calls.at(-1) ?? []
    expect(query).toContain('ORDER BY qa.occurred_at DESC, qa.id DESC')
    expect(query).toContain('(qa.occurred_at, qa.id) <')
    expect(parameters).toEqual([
      'admin-1',
      'update',
      'request-3',
      '2026-08-18T00:00:00.000Z',
      '40000000-0000-4000-8000-000000000004',
      26,
    ])
    expect(rows[0]).toMatchObject({
      action: 'update',
      correlationId: 'request-3',
      entity: { type: 'quote', id: '10000000-0000-4000-8000-000000000001' },
    })
  })
})
