import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createAuditActivityQuery,
  type AuditEntityReference,
  type AuditEventRow,
  type AuditActivityRepositoryQuery,
} from '@/lib/audit/activity.server'
import { createPostgresQuoteAuditRepository } from '@/lib/audit/quote-audit-repository.server'

const admin = { id: 'admin-1', role: 'admin' as const, displayName: 'Administrador' }

function repository() {
  return {
    listEvents: vi.fn(
      async (_input?: AuditActivityRepositoryQuery): Promise<readonly AuditEventRow[]> => [],
    ),
    loadActorMetadata: vi.fn(async (_actorIds?: readonly string[]) => new Map()),
    loadEntityMetadata: vi.fn(
      async (_entities?: readonly AuditEntityReference[]) => new Map(),
    ),
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

const UUID = (hex12: string) => `${hex12.slice(0, 8)}-0000-4000-8000-${hex12.slice(-12).padStart(12, '0')}`
const ENTITY_ID = UUID('aaaaaaaaaaaa')
const MARKER = 'leak-marker-value'

function authorizedQuery(storeOverrides?: (store: ReturnType<typeof repository>) => void) {
  const store = repository()
  store.loadActorMetadata.mockResolvedValue(new Map([[admin.id, 'Ana Admin']]))
  store.loadEntityMetadata.mockResolvedValue(
    new Map([[`quote:${ENTITY_ID}`, 'ORC-2026-000001']]),
  )
  storeOverrides?.(store)
  const query = createAuditActivityQuery({
    authenticate: async () => admin,
    repository: store,
    authorizeEntities: async () =>
      new Set([`quote:${ENTITY_ID}`]),
  })
  return { store, query }
}

function eventRow(overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: UUID('300000000003'),
    actorId: admin.id,
    action: 'update',
    entity: { type: 'quote', id: ENTITY_ID },
    occurredAt: new Date('2026-08-17T12:00:00.000Z'),
    correlationId: 'request-1',
    before: null,
    after: { status: 'sent' },
    ...overrides,
  }
}

describe('audit request bounds and filters', () => {
  const FROM = '2026-01-01T00:00:00.000Z'
  const EXACTLY_NINETY_DAYS = '2026-04-01T00:00:00.000Z'

  const rejectedInputs: readonly [string, Record<string, unknown>][] = [
    ['a zero limit', { limit: 0 }],
    ['an oversized limit', { limit: 101 }],
    ['a non-integer limit', { limit: 2.5 }],
    ['an unknown top-level field', { theme: 'dark' }],
    ['an unknown filter field', { filters: { sortBy: 'id' } }],
    ['a non-allowlisted action', { filters: { action: 'delete' } }],
    ['an unsupported entity type', { filters: { entityType: 'order' } }],
    ['a non-uuid entity id', { filters: { entityId: 'not-a-uuid' } }],
    ['an unparseable date', { filters: { occurredFrom: 'yesterday' } }],
    ['an inverted date range', { filters: { occurredFrom: FROM, occurredTo: '2025-12-31T23:59:59.999Z' } }],
    ['a date range beyond 90 days', { filters: { occurredFrom: FROM, occurredTo: '2026-04-01T00:00:00.001Z' } }],
    ['an oversized actor filter', { filters: { actorId: 'a'.repeat(129) } }],
    ['a blank actor filter', { filters: { actorId: '   ' } }],
    ['an oversized correlation filter', { filters: { correlationId: 'c'.repeat(129) } }],
    ['an oversized cursor', { cursor: 'x'.repeat(513) }],
    [
      'a semantically invalid cursor',
      {
        cursor: Buffer.from(
          JSON.stringify({ occurredAt: 'nope', id: 'nope' }),
          'utf8',
        ).toString('base64url'),
      },
    ],
  ]

  it.each(rejectedInputs)('rejects %s with INVALID_FILTER before querying', async (_name, input) => {
    const { store, query } = authorizedQuery()
    const result = await query(input)
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_FILTER', status: 400 },
    })
    expect(store.listEvents).not.toHaveBeenCalled()
  })

  it('accepts every documented filter at its boundary values', async () => {
    const { store, query } = authorizedQuery()
    const filters = {
      actorId: 'a'.repeat(128),
      action: 'transition' as const,
      entityType: 'quote' as const,
      entityId: ENTITY_ID,
      occurredFrom: '2026-01-01T00:00:00-03:00',
      occurredTo: EXACTLY_NINETY_DAYS,
      correlationId: 'c'.repeat(128),
    }
    const cursor = Buffer.from(
      JSON.stringify({ occurredAt: FROM, id: UUID('200000000002') }),
      'utf8',
    ).toString('base64url')

    const result = await query({ limit: 100, cursor, filters })

    expect(result).toMatchObject({ ok: true })
    expect(store.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 101, cursor: { occurredAt: FROM, id: UUID('200000000002') }, filters }),
    )
  })

  it('accepts a date range of exactly 90 days and a one-sided bound', async () => {
    const { query } = authorizedQuery()
    await expect(
      query({ filters: { occurredFrom: FROM, occurredTo: EXACTLY_NINETY_DAYS } }),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      query({ filters: { occurredTo: EXACTLY_NINETY_DAYS } }),
    ).resolves.toMatchObject({ ok: true })
  })
})

describe('per-invocation authorization', () => {
  it('re-runs authentication and role checks on every call', async () => {
    const store = repository()
    const authenticate = vi.fn()
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...admin, role: 'read_only' as const })
    const query = createAuditActivityQuery({
      authenticate,
      repository: store,
      authorizeEntities: async () => new Set<string>(),
    })

    await expect(query({})).resolves.toMatchObject({ ok: true })
    await expect(query({})).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED', status: 401 },
    })
    await expect(query({})).resolves.toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', status: 403 },
    })
    expect(authenticate).toHaveBeenCalledTimes(3)
    expect(store.listEvents).toHaveBeenCalledTimes(1)
  })
})

describe('empty results', () => {
  it('returns an empty page without loading metadata', async () => {
    const { store, query } = authorizedQuery()
    const result = await query({})
    expect(result).toEqual({ ok: true, data: { items: [], nextCursor: null } })
    expect(store.loadActorMetadata).toHaveBeenCalledWith([])
    expect(store.loadEntityMetadata).toHaveBeenCalledWith([])
  })
})

describe('representative event types', () => {
  const descriptions: readonly [AuditEventRow['action'], string][] = [
    ['create', 'criou'],
    ['update', 'atualizou'],
    ['transition', 'alterou o status de'],
    ['duplicate', 'duplicou'],
  ]

  it.each(descriptions)('describes %s events in pt-BR', async (action, verb) => {
    const { store, query } = authorizedQuery((mock) => {
      mock.listEvents.mockResolvedValue([eventRow({ action })])
    })
    void store
    const result = await query({})
    expect(result.ok && result.data.items[0]?.description).toBe(
      `Ana Admin ${verb} o orçamento ORC-2026-000001.`,
    )
  })

  it('falls back safely for unknown actors and unauthorized entities', async () => {
    const store = repository()
    store.listEvents.mockResolvedValue([
      eventRow({ actorId: 'ghost-user', action: 'create', before: { secret: MARKER } }),
    ])
    const query = createAuditActivityQuery({
      authenticate: async () => admin,
      repository: store,
      authorizeEntities: async () => new Set<string>(),
    })

    const result = await query({})
    expect(result.ok && result.data.items[0]?.description).toBe(
      'Usuário do sistema criou um orçamento.',
    )
    expect(JSON.stringify(result)).not.toContain(MARKER)
  })
})

describe('pre-serialization redaction', () => {
  async function summarize(payload: unknown): Promise<{ json: string; itemAfter: unknown }> {
    const { query } = authorizedQuery((mock) => {
      mock.listEvents.mockResolvedValue([
        eventRow({ action: 'create', before: payload, after: payload }),
      ])
    })
    const result = await query({})
    if (!result.ok) throw new Error('expected success')
    return { json: JSON.stringify(result), itemAfter: result.data.items[0]?.after }
  }

  it('removes authentication-internal fields in before and after payloads', async () => {
    const payload = {
      password: MARKER,
      passwordHash: MARKER,
      passwordHistory: MARKER,
      passcode: MARKER,
      secret: MARKER,
      token: MARKER,
      accessToken: MARKER,
      refreshToken: MARKER,
      apiKey: MARKER,
      privateKey: MARKER,
      credential: MARKER,
      authorization: MARKER,
      cookie: MARKER,
      session: MARKER,
      sessionId: MARKER,
      mfa: MARKER,
      otp: MARKER,
      authSubject: MARKER,
      salt: MARKER,
      hash: MARKER,
    }
    const { json, itemAfter } = await summarize(payload)
    for (const key of Object.keys(payload)) {
      expect(itemAfter).toMatchObject({ [key]: '[REDACTED]' })
    }
    expect(json).not.toContain(MARKER)
  })

  it('removes policy-restricted PII fields in before and after payloads', async () => {
    const payload = {
      email: MARKER,
      phone: MARKER,
      whatsapp: MARKER,
      taxId: MARKER,
      cpf: MARKER,
      cnpj: MARKER,
      stateRegistration: MARKER,
      address: MARKER,
      postalCode: MARKER,
      cep: MARKER,
      contactName: MARKER,
      notes: MARKER,
      note: MARKER,
      creditLimit: MARKER,
      bank: MARKER,
      account: MARKER,
      document: MARKER,
    }
    const { json, itemAfter } = await summarize(payload)
    for (const key of Object.keys(payload)) {
      expect(itemAfter).toMatchObject({ [key]: '[REDACTED]' })
    }
    expect(json).not.toContain(MARKER)
  })

  it('cannot be bypassed by payload shape: nesting, arrays, nulls, and similar names', async () => {
    const payload = {
      nested: { profile: { primaryEmail: MARKER } },
      deeplyNested: { a: { b: { c: { d: { password: MARKER } } } } },
      lines: [
        { price: '10', customerPhone: MARKER },
        { memo: 'kept-visible' },
      ],
      nullable: { status: null, legacyNotes: MARKER },
      similar: {
        passwordStrength: MARKER,
        passingReview: 'kept-passing',
        signature: 'kept-signature',
        documentation: MARKER,
      },
      scalarTypes: { count: 3, active: true },
    }
    const { json, itemAfter } = await summarize(payload)
    expect(json).not.toContain(MARKER)
    expect(itemAfter).toMatchObject({
      nested: { profile: { primaryEmail: '[REDACTED]' } },
      deeplyNested: { a: { b: { c: { d: '[TRUNCATED]' } } } },
      lines: [
        { price: '10', customerPhone: '[REDACTED]' },
        { memo: 'kept-visible' },
      ],
      nullable: { status: null, legacyNotes: '[REDACTED]' },
      similar: {
        passwordStrength: '[REDACTED]',
        passingReview: 'kept-passing',
        signature: 'kept-signature',
        documentation: '[REDACTED]',
      },
      scalarTypes: { count: 3, active: true },
    })
  })

  it('bounds summaries instead of leaking oversized content', async () => {
    const longText = 'x'.repeat(300)
    const wideObject = Object.fromEntries(
      Array.from({ length: 52 }, (_v, i) => [`field${i}`, `v${i}`]),
    ) as Record<string, string>
    const payload = {
      longText,
      wideObject,
      longArray: Array.from({ length: 22 }, (_v, i) => ({ index: i })),
      tooDeep: { l1: { l2: { l3: { l4: { l5: { secretValue: MARKER } } } } } },
    }
    const { json, itemAfter } = await summarize(payload)
    expect(json).not.toContain(MARKER)
    const summary = itemAfter as Record<string, unknown>
    expect(summary.longText).toBe(`${'x'.repeat(256)}…`)
    expect(summary.wideObject).toMatchObject({ field49: 'v49', _truncated: true })
    expect(Object.keys(summary.wideObject as object)).not.toContain('field50')
    expect(summary.longArray).toHaveLength(21)
    expect((summary.longArray as unknown[]).at(-1)).toBe('[TRUNCATED]')
    expect(summary.tooDeep).toEqual({ l1: { l2: { l3: { l4: '[TRUNCATED]' } } } })
  })
})

describe('batched metadata (N+1 regression)', () => {
  it('keeps metadata lookups at fixed counts regardless of page size', async () => {
    const store = repository()
    const actors = Array.from({ length: 40 }, (_v, i) => `actor-${i}`)
    const quoteIds = Array.from(
      { length: 25 },
      (_v, i): string => UUID(`bbbb0000${String(i).padStart(4, '0')}bb`),
    )
    store.listEvents.mockResolvedValue(
      Array.from({ length: 100 }, (_v, i) =>
        eventRow({
          id: UUID(`c${String(i).padStart(11, '0')}ccc`),
          actorId: actors[i % actors.length],
          entity: { type: 'quote', id: quoteIds[i % quoteIds.length] ?? ENTITY_ID },
        }),
      ),
    )
    const authorizeEntities = vi.fn(async () => new Set(quoteIds.map((id) => `quote:${id}`)))
    const query = createAuditActivityQuery({
      authenticate: async () => admin,
      repository: store,
      authorizeEntities,
    })

    const result = await query({ limit: 100 })

    expect(result.ok).toBe(true)
    expect(store.listEvents).toHaveBeenCalledTimes(1)
    expect(store.loadActorMetadata).toHaveBeenCalledTimes(1)
    expect(store.loadActorMetadata).toHaveBeenCalledWith(actors)
    expect(authorizeEntities).toHaveBeenCalledTimes(1)
    expect(store.loadEntityMetadata).toHaveBeenCalledTimes(1)
    const entityArg = store.loadEntityMetadata.mock.calls[0]?.[0] ?? []
    expect(entityArg).toHaveLength(25)
  })
})

describe('pagination determinism', () => {
  function fiveRowStore() {
    const store = repository()
    const t1 = new Date('2026-08-17T12:00:00.000Z')
    const t2 = new Date('2026-08-16T08:30:00.000Z')
    const rows = [
      eventRow({ id: UUID('e0000000000c'), occurredAt: t1 }),
      eventRow({ id: UUID('d0000000000b'), occurredAt: t1 }),
      eventRow({ id: UUID('c0000000000a'), occurredAt: t1 }),
      eventRow({ id: UUID('b00000000009'), occurredAt: t2 }),
      eventRow({ id: UUID('a00000000008'), occurredAt: t2 }),
    ]
    let queried = false
    store.listEvents.mockImplementation(async (input) => {
      queried = true
      void queried
      // Emulate the adapter contract: `limit` is page size + 1 probe row.
      const cursorId = input?.cursor?.id
      const start = cursorId
        ? rows.findIndex((row) => row.id === cursorId) + 1
        : 0
      const pageSize = Math.min((input?.limit ?? 1) - 1, rows.length - start)
      return rows.slice(start, start + pageSize + 1)
    })
    return { store, rows }
  }

  it('chains keyset pages without duplicates or gaps across equal timestamps', async () => {
    const { store, rows } = fiveRowStore()
    const query = createAuditActivityQuery({
      authenticate: async () => admin,
      repository: store,
      authorizeEntities: async () => new Set([`quote:${ENTITY_ID}`]),
    })

    const collected: string[] = []
    let cursor: string | null | undefined
    for (let guard = 0; guard < 10; guard += 1) {
      const result = await query({ limit: 2, ...(cursor ? { cursor } : {}) })
      if (!result.ok) throw new Error('expected success')
      collected.push(...result.data.items.map((item) => item.id))
      cursor = result.data.nextCursor
      if (!cursor) break
    }

    expect(collected).toHaveLength(new Set(collected).size)
    expect(collected).toEqual(rows.map((row) => row.id))
    expect(cursor).toBeNull()
  })

  it('breaks equal-timestamp ties by descending id inside the cursor', async () => {
    const { store } = fiveRowStore()
    const query = createAuditActivityQuery({
      authenticate: async () => admin,
      repository: store,
      authorizeEntities: async () => new Set([`quote:${ENTITY_ID}`]),
    })

    const result = await query({ limit: 2 })
    if (!result.ok) throw new Error('expected success')
    const decoded = JSON.parse(
      Buffer.from(result.data.nextCursor ?? '', 'base64url').toString('utf8'),
    ) as { occurredAt: string; id: string }
    expect(decoded).toEqual({
      occurredAt: '2026-08-17T12:00:00.000Z',
      id: UUID('d0000000000b'),
    })
  })
})

describe('append-only audit storage contract', () => {
  const AUDIT_SOURCES = [
    'src/lib/audit/activity.server.ts',
    'src/lib/audit/quote-audit-repository.server.ts',
    'src/features/app/audit/audit-activity.functions.ts',
  ]
  const MUTATION_SQL = /(INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+"?quote_audit"?/i

  it('exposes no SQL mutation path for quote_audit rows in any audit module', () => {
    for (const relative of AUDIT_SOURCES) {
      const source = readFileSync(resolve(process.cwd(), relative), 'utf8')
      expect(source, `${relative} must not mutate quote_audit`).not.toMatch(MUTATION_SQL)
    }
  })

  it('rejects hostile schema identifiers before any search_path interpolation', () => {
    for (const schemaName of ['public; DROP SCHEMA app', 'app"--', 'app app2']) {
      expect(() =>
        createPostgresQuoteAuditRepository({
          sql: { unsafe: vi.fn() } as never,
          schemaName,
          loadActorNames: async (ids) => new Map(ids.map((id) => [id, id])),
        }),
      ).toThrow('Invalid PostgreSQL schema name')
    }
  })

  it('exposes only GET server functions in the audit feature', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/app/audit/audit-activity.functions.ts'),
      'utf8',
    )
    expect(source).toContain("method: 'GET'")
    expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/)
  })

  it('keeps the database-level append-only trigger in place', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'drizzle/0002_quote_persistence.sql'),
      'utf8',
    )
    expect(migration).toContain('quote_audit_prevent_mutation_trg')
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE OR TRUNCATE ON quote_audit/)
  })
})
