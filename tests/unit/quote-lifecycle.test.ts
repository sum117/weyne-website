import { describe, expect, it } from 'vitest'

import {
  QUOTE_STATUSES,
  QuoteLifecycleError,
  createInMemoryQuoteLifecycleStore,
  createQuoteLifecycleService,
  type QuoteLifecycleRecord,
} from '@/lib/quotes/lifecycle.server'

const today = '2026-08-17'

function draftQuote(overrides: Partial<QuoteLifecycleRecord> = {}): QuoteLifecycleRecord {
  return {
    id: 'quote-1',
    ownerUserId: 'representative-1',
    status: 'draft',
    validUntil: '2026-08-18',
    version: 1,
    revision: 0,
    readyToSend: true,
    customerSnapshot: { id: 'customer-1', legalName: 'Cliente Sintético' },
    commercialSnapshot: {
      priceListKey: 'PRICE_1',
      generalDiscountRate: '0',
      freight: '0',
      lines: [
        {
          productId: 'product-1',
          internalCode: 'SYN-001',
          description: 'Produto sintético',
          unit: 'CX',
          quantity: '1.000',
          unitPrice: '100.0000',
          lineDiscountRate: '0',
        },
      ],
      totals: {
        merchandiseGross: '100.00',
        merchandiseNet: '100.00',
        total: '100.00',
      },
    },
    sentAt: null,
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectedReason: null,
    expiredAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelledReason: null,
    ...overrides,
  }
}

const representative = {
  id: 'representative-1',
  role: 'representative' as const,
  permissions: ['quotes:send:own'] as const,
}

const admin = {
  id: 'admin-1',
  role: 'admin' as const,
  permissions: [
    'quotes:send:any',
    'quotes:update:any',
    'quotes:decide:any',
    'quotes:cancel:any',
  ] as const,
}

const system = {
  id: 'system:quote-expiration',
  role: 'system' as const,
  permissions: ['system:expire_quotes'] as const,
}

function createService(quote: QuoteLifecycleRecord) {
  const store = createInMemoryQuoteLifecycleStore({
    quotes: [quote],
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  })
  return {
    store,
    service: createQuoteLifecycleService({ store, businessDate: () => today }),
  }
}

describe('quote lifecycle service', () => {
  it('sends a ready draft and records the transition atomically', async () => {
    const store = createInMemoryQuoteLifecycleStore({
      quotes: [draftQuote()],
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    })
    const service = createQuoteLifecycleService({ store, businessDate: () => today })

    const result = await service.transition({
      quoteId: 'quote-1',
      command: 'sendQuote',
      actor: representative,
      idempotencyKey: 'send-quote-1',
    })

    expect(result.quote.status).toBe('sent')
    expect(result.quote.revision).toBe(1)
    expect(result.history).toMatchObject({
      actorId: representative.id,
      fromStatus: 'draft',
      toStatus: 'sent',
      reason: null,
    })
    expect(store.snapshot().history).toHaveLength(1)
  })

  it('exports stable typed domain errors', () => {
    expect(new QuoteLifecycleError('QUOTE_NOT_FOUND').code).toBe('QUOTE_NOT_FOUND')
  })

  it('reopens a sent quote only with a reason and clears its sent marker', async () => {
    const { service } = createService(
      draftQuote({
        status: 'sent',
        revision: 1,
        sentAt: new Date('2026-08-16T12:00:00.000Z'),
      }),
    )

    await expect(
      service.transition({
        quoteId: 'quote-1',
        command: 'reopenQuote',
        actor: admin,
        idempotencyKey: 'reopen-without-reason',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION_REASON' })

    const result = await service.transition({
      quoteId: 'quote-1',
      command: 'reopenQuote',
      actor: admin,
      idempotencyKey: 'reopen-with-reason',
      reason: 'Corrigir condições de pagamento',
    })

    expect(result.quote).toMatchObject({ status: 'draft', sentAt: null, revision: 1 })
    expect(result.history.reason).toBe('Corrigir condições de pagamento')
  })

  it.each([
    ['approveQuote', 'approved'],
    ['rejectQuote', 'rejected'],
    ['cancelQuote', 'cancelled'],
  ] as const)('moves sent quotes with %s to %s', async (command, expectedStatus) => {
    const { service } = createService(
      draftQuote({
        status: 'sent',
        revision: 1,
        sentAt: new Date('2026-08-16T12:00:00.000Z'),
      }),
    )

    const result = await service.transition({
      quoteId: 'quote-1',
      command,
      actor: admin,
      idempotencyKey: `${command}-1`,
      reason: command === 'approveQuote' ? undefined : 'Decisão comercial registrada',
    })

    expect(result.quote.status).toBe(expectedStatus)
    expect(result.history.toStatus).toBe(expectedStatus)
  })

  it('expires only a sent quote after its inclusive validity date', async () => {
    const { service } = createService(
      draftQuote({
        status: 'sent',
        validUntil: '2026-08-16',
        revision: 1,
        sentAt: new Date('2026-08-15T12:00:00.000Z'),
      }),
    )

    const result = await service.transition({
      quoteId: 'quote-1',
      command: 'expireQuote',
      actor: system,
      idempotencyKey: 'expire-1',
    })

    expect(result.quote).toMatchObject({ status: 'expired' })
    expect(result.history).toMatchObject({
      actorId: system.id,
      fromStatus: 'sent',
      toStatus: 'expired',
    })
  })

  it.each(['draft', 'approved'] as const)(
    'cancels a %s quote with a required reason',
    async (status) => {
      const { service } = createService(draftQuote({ status }))

      const result = await service.transition({
        quoteId: 'quote-1',
        command: 'cancelQuote',
        actor: admin,
        idempotencyKey: `cancel-${status}`,
        reason: 'Negociação encerrada',
      })

      expect(result.quote.status).toBe('cancelled')
    },
  )

  it.each([
    ['sendQuote', 'sent'],
    ['sendQuote', 'approved'],
    ['reopenQuote', 'draft'],
    ['reopenQuote', 'approved'],
    ['approveQuote', 'draft'],
    ['approveQuote', 'rejected'],
    ['rejectQuote', 'draft'],
    ['rejectQuote', 'approved'],
    ['expireQuote', 'draft'],
    ['expireQuote', 'approved'],
    ['cancelQuote', 'rejected'],
    ['cancelQuote', 'expired'],
    ['cancelQuote', 'converted'],
    ['cancelQuote', 'cancelled'],
  ] as const)('rejects illegal %s calls from %s', async (command, status) => {
    const { service } = createService(
      draftQuote({
        status,
        validUntil: command === 'expireQuote' ? '2026-08-16' : '2026-08-18',
      }),
    )
    const actor = command === 'expireQuote' ? system : admin

    await expect(
      service.transition({
        quoteId: 'quote-1',
        command,
        actor,
        idempotencyKey: `illegal-${command}-${status}`,
        reason: ['reopenQuote', 'rejectQuote', 'cancelQuote'].includes(command)
          ? 'Motivo válido'
          : undefined,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })

  it('keeps the transition adjacency closed for every other command/status pair', async () => {
    const legalSources = {
      sendQuote: ['draft'],
      reopenQuote: ['sent'],
      approveQuote: ['sent'],
      rejectQuote: ['sent'],
      expireQuote: ['sent'],
      cancelQuote: ['draft', 'sent', 'approved'],
    } as const

    for (const command of Object.keys(legalSources) as (keyof typeof legalSources)[]) {
      for (const status of QUOTE_STATUSES) {
        if ((legalSources[command] as readonly string[]).includes(status)) continue
        const { service } = createService(
          draftQuote({
            status,
            validUntil: command === 'expireQuote' ? '2026-08-16' : '2026-08-18',
          }),
        )

        await expect(
          service.transition({
            quoteId: 'quote-1',
            command,
            actor: command === 'expireQuote' ? system : admin,
            idempotencyKey: `closed-${command}-${status}`,
            reason: ['reopenQuote', 'rejectQuote', 'cancelQuote'].includes(command)
              ? 'Motivo válido'
              : undefined,
          }),
        ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
      }
    }
  })

  it('denies direct service calls before looking up an idempotent result', async () => {
    const { service } = createService(
      draftQuote({ status: 'sent', sentAt: new Date('2026-08-16T12:00:00.000Z') }),
    )
    const request = {
      quoteId: 'quote-1',
      command: 'approveQuote' as const,
      idempotencyKey: 'approve-once',
    }
    await service.transition({ ...request, actor: admin })

    await expect(
      service.transition({
        ...request,
        actor: {
          id: 'reader-1',
          role: 'read_only',
          permissions: ['quotes:decide:any'],
        },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('enforces own scope even when a representative has the command permission', async () => {
    const { service } = createService(draftQuote({ ownerUserId: 'representative-2' }))

    await expect(
      service.transition({
        quoteId: 'quote-1',
        command: 'sendQuote',
        actor: representative,
        idempotencyKey: 'foreign-send',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('returns the original result for an idempotent retry without a duplicate event', async () => {
    const { service, store } = createService(draftQuote())
    const request = {
      quoteId: 'quote-1',
      command: 'sendQuote' as const,
      actor: representative,
      idempotencyKey: 'stable-send-key',
    }

    const first = await service.transition(request)
    const retry = await service.transition(request)

    expect(retry).toEqual(first)
    expect(store.snapshot().history).toHaveLength(1)
    expect(store.snapshot().commands).toHaveLength(1)
  })

  it('rejects reusing an idempotency key with a different normalized payload', async () => {
    const { service } = createService(
      draftQuote({ status: 'sent', sentAt: new Date('2026-08-16T12:00:00.000Z') }),
    )
    const base = {
      quoteId: 'quote-1',
      command: 'approveQuote' as const,
      actor: admin,
      idempotencyKey: 'approve-key',
    }
    await service.transition({ ...base, reason: 'Primeira observação' })

    await expect(
      service.transition({ ...base, reason: 'Outra observação' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
  })

  it('allows only one of two concurrent competing transitions to commit', async () => {
    const { service, store } = createService(
      draftQuote({ status: 'sent', sentAt: new Date('2026-08-16T12:00:00.000Z') }),
    )

    const outcomes = await Promise.allSettled([
      service.transition({
        quoteId: 'quote-1',
        command: 'approveQuote',
        actor: admin,
        idempotencyKey: 'competing-approve',
      }),
      service.transition({
        quoteId: 'quote-1',
        command: 'rejectQuote',
        actor: admin,
        idempotencyKey: 'competing-reject',
        reason: 'Cliente recusou',
      }),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(store.snapshot().history).toHaveLength(1)
  })

  it('rolls back the quote when writing its audit event fails', async () => {
    const store = createInMemoryQuoteLifecycleStore({
      quotes: [draftQuote()],
      failAppendHistory: () => new Error('history unavailable'),
    })
    const service = createQuoteLifecycleService({ store, businessDate: () => today })

    await expect(
      service.transition({
        quoteId: 'quote-1',
        command: 'sendQuote',
        actor: representative,
        idempotencyKey: 'failed-history',
      }),
    ).rejects.toThrow('history unavailable')

    expect(store.snapshot().quotes[0]!.status).toBe('draft')
    expect(store.snapshot().history).toHaveLength(0)
    expect(store.snapshot().commands).toHaveLength(0)
  })

  it('uses the same effective expiration status in list and detail read models', () => {
    const quote = draftQuote({ status: 'sent', validUntil: '2026-08-16' })

    const { service } = createService(quote)

    return Promise.all([
      expect(service.toListReadModel(quote)).resolves.toMatchObject({ status: 'expired' }),
      expect(service.toDetailReadModel(quote)).resolves.toMatchObject({ status: 'expired' }),
      expect(
        service.toDetailReadModel({ ...quote, validUntil: today }),
      ).resolves.toMatchObject({ status: 'sent' }),
    ])
  })

  it.each(['sendQuote', 'approveQuote'] as const)(
    'revalidates persisted snapshots before %s',
    async (command) => {
      const quote = draftQuote({
        status: command === 'sendQuote' ? 'draft' : 'sent',
        commercialSnapshot: {
          priceListKey: 'PRICE_1',
          lines: [],
          totals: { total: '100.00' },
        },
      })
      const { service, store } = createService(quote)

      await expect(
        service.transition({
          quoteId: quote.id,
          command,
          actor: admin,
          idempotencyKey: `invalid-snapshot-${command}`,
        }),
      ).rejects.toMatchObject({ code: 'QUOTE_NOT_READY' })
      expect(store.snapshot().history).toHaveLength(0)
    },
  )

  it('rejects a ready flag when persisted totals do not match the line snapshots', async () => {
    const quote = draftQuote({
      commercialSnapshot: {
        ...draftQuote().commercialSnapshot,
        totals: {
          merchandiseGross: '100.00',
          merchandiseNet: '100.00',
          total: '0.00',
        },
      },
    })
    const { service } = createService(quote)

    await expect(
      service.transition({
        quoteId: quote.id,
        command: 'sendQuote',
        actor: admin,
        idempotencyKey: 'mismatched-totals',
      }),
    ).rejects.toMatchObject({ code: 'QUOTE_NOT_READY' })
  })
})
