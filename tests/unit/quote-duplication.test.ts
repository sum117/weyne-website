import { describe, expect, it } from 'vitest'
import {
  createInMemoryQuoteDuplicationStore,
  createQuoteDuplicationService,
  type DuplicableQuote,
  type QuoteDuplicationStore,
} from '@/lib/quotes/duplication.server'

const sourceQuote: DuplicableQuote = {
  id: 'quote-source',
  number: 'ORC-2026-000041',
  status: 'rejected',
  ownerUserId: 'rep-1',
  customer: { id: 'customer-1', active: true, legalName: 'Cliente Fonte' },
  priceList: { id: 'price-list-1', active: true, key: 'PRICE_1', name: 'Preço 1' },
  validUntil: '2026-09-30',
  paymentTerms: '28 dias',
  notes: 'Condição negociada',
  lifecycle: { approvedAt: null, rejectedAt: new Date('2026-08-15T10:00:00Z') },
  storageReferences: ['quotes/source.pdf'],
  lines: [
    {
      id: 'line-source',
      productId: 'product-1',
      position: 1,
      quantity: '2.000000',
      discount: { kind: 'percentage', value: '5.000000' },
      snapshot: {
        productCode: 'SKU-1',
        description: 'Produto original',
        unit: 'UN',
        industry: { id: 'industry-1', name: 'Indústria Fonte' },
        price: {
          productPriceId: 'price-version-old',
          unitPrice: '10.000000',
          currencyCode: 'BRL',
        },
      },
      storageReferences: ['quote-lines/source-sheet.pdf'],
    },
  ],
}

const admin = {
  id: 'admin-1',
  role: 'admin' as const,
  permissions: ['quotes:duplicate:any'],
}

function createService(store: QuoteDuplicationStore) {
  let sequence = 1
  return createQuoteDuplicationService({
    store,
    now: () => new Date('2026-08-17T14:00:00Z'),
    createId: () => `generated-${sequence++}`,
    refreshLine: async (line) => structuredClone(line.snapshot),
  })
}

describe('quote duplication server command', () => {
  it('creates a newly numbered editable draft with refreshed, independent line snapshots', async () => {
    const store = createInMemoryQuoteDuplicationStore({
      quotes: [sourceQuote],
      firstSequence: 42,
    })
    const service = createQuoteDuplicationService({
      store,
      now: () => new Date('2026-08-17T14:00:00Z'),
      createId: (() => {
        const ids = ['quote-copy', 'line-copy', 'event-copy']
        return () => ids.shift()!
      })(),
      refreshLine: async (line) => ({
        ...structuredClone(line.snapshot),
        description: 'Produto corrente',
        price: {
          productPriceId: 'price-version-current',
          unitPrice: '12.500000',
          currencyCode: 'BRL',
        },
      }),
    })

    const result = await service.duplicate({
      sourceQuoteId: sourceQuote.id,
      actor: admin,
      idempotencyKey: 'duplicate-1',
    })

    expect(result.quote).toMatchObject({
      id: 'quote-copy',
      number: 'ORC-2026-000042',
      status: 'draft',
      duplicatedFromQuoteId: sourceQuote.id,
      validUntil: null,
      lifecycle: {},
      storageReferences: [],
      lines: [
        {
          id: 'line-copy',
          quantity: '2.000000',
          snapshot: {
            description: 'Produto corrente',
            price: {
              productPriceId: 'price-version-current',
              unitPrice: '12.500000',
            },
          },
          storageReferences: [],
        },
      ],
    })
    expect(result.event).toMatchObject({
      id: 'event-copy',
      actorId: admin.id,
      sourceQuoteId: sourceQuote.id,
      quoteId: 'quote-copy',
      eventType: 'quote_duplicated',
      idempotencyKey: 'duplicate-1',
    })
    expect(result.quote.lines[0]).not.toBe(sourceQuote.lines[0])
    expect(result.quote.lines[0]!.snapshot).not.toBe(sourceQuote.lines[0]!.snapshot)
    expect(store.snapshot().quotes).toHaveLength(2)
    expect(store.snapshot().events).toHaveLength(1)
  })

  it('allocates a unique number for each intentional duplication', async () => {
    const store = createInMemoryQuoteDuplicationStore({
      quotes: [sourceQuote],
      firstSequence: 99,
    })
    const service = createService(store)

    const first = await service.duplicate({
      sourceQuoteId: sourceQuote.id,
      actor: admin,
      idempotencyKey: 'unique-1',
    })
    const second = await service.duplicate({
      sourceQuoteId: sourceQuote.id,
      actor: admin,
      idempotencyKey: 'unique-2',
    })

    expect(first.quote.number).toBe('ORC-2026-000099')
    expect(second.quote.number).toBe('ORC-2026-000100')
    expect(second.quote.number).not.toBe(first.quote.number)
  })

  it('keeps source and duplicate mutable records independent after edits', async () => {
    const store = createInMemoryQuoteDuplicationStore({ quotes: [sourceQuote] })
    const result = await createService(store).duplicate({
      sourceQuoteId: sourceQuote.id,
      actor: admin,
      idempotencyKey: 'independent-1',
    })

    ;(result.quote.lines[0]!.snapshot.industry as { name: string }).name = 'Editada'
    ;(result.quote.lines[0]!.discount as { value: string }).value = '50.000000'
    ;(result.quote.lines[0]!.storageReferences as string[]).push('new-object-key')

    const persisted = store.snapshot().quotes
    const persistedSource = persisted.find((quote) => quote.id === sourceQuote.id)!
    const persistedDuplicate = persisted.find((quote) => quote.id === result.quote.id)!
    expect(persistedSource.lines[0]!.snapshot.industry.name).toBe('Indústria Fonte')
    expect(persistedSource.lines[0]!.discount?.value).toBe('5.000000')
    expect(persistedSource.lines[0]!.storageReferences).toEqual([
      'quote-lines/source-sheet.pdf',
    ])
    expect(persistedDuplicate.lines[0]!.storageReferences).toEqual([])
  })

  it('returns the original result for idempotent retries without new writes', async () => {
    const store = createInMemoryQuoteDuplicationStore({ quotes: [sourceQuote] })
    const service = createService(store)
    const input = {
      sourceQuoteId: sourceQuote.id,
      actor: admin,
      idempotencyKey: 'retry-1',
    } as const

    const first = await service.duplicate(input)
    const retry = await service.duplicate(input)

    expect(retry).toEqual(first)
    expect(store.snapshot().quotes).toHaveLength(2)
    expect(store.snapshot().events).toHaveLength(1)
    expect(store.snapshot().nextSequence).toBe(2)
  })

  it('serializes concurrent requests using the same idempotency key', async () => {
    const store = createInMemoryQuoteDuplicationStore({ quotes: [sourceQuote] })
    const service = createService(store)
    const input = {
      sourceQuoteId: sourceQuote.id,
      actor: admin,
      idempotencyKey: 'concurrent-1',
    } as const

    const [first, second] = await Promise.all([
      service.duplicate(input),
      service.duplicate(input),
    ])

    expect(second).toEqual(first)
    expect(store.snapshot().quotes).toHaveLength(2)
    expect(store.snapshot().events).toHaveLength(1)
  })

  it('rolls back quote, event, command, and numbering when audit persistence fails', async () => {
    const baseStore = createInMemoryQuoteDuplicationStore({
      quotes: [sourceQuote],
      firstSequence: 7,
    })
    const failingStore: QuoteDuplicationStore = {
      transaction: (work) =>
        baseStore.transaction((transaction) =>
          work({
            ...transaction,
            appendEvent: async () => {
              throw new Error('audit unavailable')
            },
          }),
        ),
    }

    await expect(
      createService(failingStore).duplicate({
        sourceQuoteId: sourceQuote.id,
        actor: admin,
        idempotencyKey: 'rollback-1',
      }),
    ).rejects.toThrow('audit unavailable')

    expect(baseStore.snapshot()).toMatchObject({
      quotes: [sourceQuote],
      events: [],
      commands: [],
      nextSequence: 7,
    })
  })

  it('denies read-only and out-of-scope callers through direct service invocation', async () => {
    const store = createInMemoryQuoteDuplicationStore({ quotes: [sourceQuote] })
    const service = createService(store)
    const callers = [
      {
        id: sourceQuote.ownerUserId,
        role: 'read_only' as const,
        permissions: ['quotes:duplicate:any'],
      },
      {
        id: 'other-representative',
        role: 'representative' as const,
        permissions: ['quotes:duplicate:own'],
      },
    ]

    for (const [index, actor] of callers.entries()) {
      await expect(
        service.duplicate({
          sourceQuoteId: sourceQuote.id,
          actor,
          idempotencyKey: `forbidden-${index}`,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
    expect(store.snapshot().quotes).toHaveLength(1)
    expect(store.snapshot().events).toHaveLength(0)
  })

  it('rejects reusing an idempotency key for another source quote', async () => {
    const otherQuote = { ...structuredClone(sourceQuote), id: 'quote-other' }
    const store = createInMemoryQuoteDuplicationStore({
      quotes: [sourceQuote, otherQuote],
    })
    const service = createService(store)
    await service.duplicate({
      sourceQuoteId: sourceQuote.id,
      actor: admin,
      idempotencyKey: 'reused-1',
    })

    await expect(
      service.duplicate({
        sourceQuoteId: otherQuote.id,
        actor: admin,
        idempotencyKey: 'reused-1',
      }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    })
  })
})
