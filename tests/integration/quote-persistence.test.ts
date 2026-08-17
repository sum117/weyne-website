import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createPostgresQuoteRepository,
  type CreateQuoteInput,
  type QuoteStatus,
} from '@/lib/quotes/quote-repository.server'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

let harness: PostgresTestHarness

const actor = { id: 'representative-1', role: 'representative' as const }
const baseInput: Omit<CreateQuoteInput, 'actor' | 'commandId'> = {
  ownerUserId: actor.id,
  validUntil: '2026-09-30',
  customerSnapshot: {
    id: 'customer-1',
    legalName: 'Cliente Sintético Ltda.',
    document: '00000000000191',
  },
  commercialSnapshot: {
    priceListKey: 'PRICE_2',
    generalDiscountRate: '5.000000',
    freight: '12.34',
    notes: 'Entregar pela manhã',
    lines: [
      {
        productId: 'product-1',
        internalCode: 'SYN-001',
        description: 'Produto sintético',
        unit: 'CX',
        quantity: '2.000000',
        unitPrice: '50.000000',
        lineDiscountRate: '10.000000',
        lineNet: '90.00',
      },
    ],
    totals: { merchandiseGross: '100.00', merchandiseNet: '85.50', total: '97.84' },
  },
}

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'quote_persistence',
    migrationNames: ['0001_catalog_pricing.sql', '0002_quote_persistence.sql'],
  })
})

beforeEach(async () => {
  await harness.reset()
})

afterAll(async () => {
  await harness?.close()
})

function repository(sql: Sql = harness.sql) {
  return createPostgresQuoteRepository({ sql, schemaName: harness.schemaName })
}

async function createQuote(commandId: string = crypto.randomUUID()) {
  return repository().create({ ...baseInput, actor, commandId })
}

describe('quote persistence and lifecycle on PostgreSQL', () => {
  it('reloads immutable snapshots, versions, and actor-rich audit history', async () => {
    const repo = repository()
    const created = await repo.create({ ...baseInput, actor, commandId: 'create-1' })
    const reloaded = await repo.get(created.id)

    expect(reloaded).toEqual(created)
    expect(created.quoteNumber).toMatch(/^ORC-\d{4}-\d{6}$/)
    expect(created.version).toBe(1)

    const updated = await repo.updateDraft({
      quoteId: created.id,
      expectedVersion: 1,
      actor,
      commandId: 'update-1',
      commercialSnapshot: {
        ...baseInput.commercialSnapshot,
        freight: '20.00',
        totals: { merchandiseGross: '100.00', merchandiseNet: '85.50', total: '105.50' },
      },
    })

    expect((await repo.get(created.id))?.commercialSnapshot).toEqual(
      updated.commercialSnapshot,
    )
    expect(await repo.listVersions(created.id)).toMatchObject([
      { version: 1, operation: 'create', snapshot: { commercialSnapshot: baseInput.commercialSnapshot } },
      { version: 2, operation: 'update', snapshot: { commercialSnapshot: updated.commercialSnapshot } },
    ])
    expect(await repo.listAudit(created.id)).toMatchObject([
      {
        actorId: actor.id,
        actorRole: actor.role,
        operation: 'create',
        version: 1,
        beforeState: null,
        afterState: { status: 'draft', version: 1 },
      },
      {
        actorId: actor.id,
        actorRole: actor.role,
        operation: 'update',
        version: 2,
        beforeState: { status: 'draft', version: 1 },
        afterState: { status: 'draft', version: 2 },
      },
    ])
  })

  it('permits every lifecycle edge and rejects closed or invalid edges explicitly', async () => {
    const allowed: ReadonlyArray<readonly [QuoteStatus, QuoteStatus]> = [
      ['draft', 'sent'],
      ['draft', 'cancelled'],
      ['sent', 'draft'],
      ['sent', 'approved'],
      ['sent', 'rejected'],
      ['sent', 'expired'],
      ['sent', 'cancelled'],
      ['approved', 'converted'],
      ['approved', 'cancelled'],
    ]

    for (const [from, to] of allowed) {
      const quote = await createQuote(`create-${from}-${to}`)
      let current = quote
      if (from === 'sent' || from === 'approved') {
        current = await repository().transition({
          quoteId: quote.id,
          expectedVersion: current.version,
          toStatus: 'sent',
          actor,
          commandId: `prepare-sent-${quote.id}`,
        })
      }
      if (from === 'approved') {
        current = await repository().transition({
          quoteId: quote.id,
          expectedVersion: current.version,
          toStatus: 'approved',
          actor,
          commandId: `prepare-approved-${quote.id}`,
        })
      }

      const transitioned = await repository().transition({
        quoteId: quote.id,
        expectedVersion: current.version,
        toStatus: to,
        actor,
        commandId: `transition-${from}-${to}`,
        reason: to === 'rejected' || to === 'cancelled' ? 'Motivo obrigatório' : undefined,
      })
      expect(transitioned.status).toBe(to)
      expect((await repository().listAudit(quote.id)).at(-1)).toMatchObject({
        actorId: actor.id,
        actorRole: actor.role,
        operation: 'transition',
        version: transitioned.version,
        beforeState: { status: from, version: current.version },
        afterState: { status: to, version: transitioned.version },
      })
    }

    const draft = await createQuote('create-invalid')
    await expect(
      repository().transition({
        quoteId: draft.id,
        expectedVersion: draft.version,
        toStatus: 'approved',
        actor,
        commandId: 'invalid-transition',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })

  it('duplicates into a new numbered draft without source identity, lifecycle, or history', async () => {
    const repo = repository()
    const source = await repo.create({ ...baseInput, actor, commandId: 'source-create' })
    const sent = await repo.transition({
      quoteId: source.id,
      expectedVersion: source.version,
      toStatus: 'sent',
      actor,
      commandId: 'source-send',
    })
    const rejected = await repo.transition({
      quoteId: source.id,
      expectedVersion: sent.version,
      toStatus: 'rejected',
      reason: 'Cliente adiou a compra',
      actor,
      commandId: 'source-reject',
    })

    const duplicate = await repo.duplicate({
      sourceQuoteId: rejected.id,
      actor,
      commandId: 'duplicate-1',
      validUntil: '2026-10-31',
    })

    expect(duplicate).toMatchObject({
      ownerUserId: source.ownerUserId,
      status: 'draft',
      version: 1,
      validUntil: '2026-10-31',
      customerSnapshot: source.customerSnapshot,
      commercialSnapshot: source.commercialSnapshot,
    })
    expect(duplicate.id).not.toBe(source.id)
    expect(duplicate.quoteNumber).not.toBe(source.quoteNumber)
    expect(await repo.listAudit(duplicate.id)).toMatchObject([
      { operation: 'duplicate', version: 1, beforeState: null },
    ])
    expect(await repo.listVersions(duplicate.id)).toHaveLength(1)
  })

  it('reports a stale edit and succeeds after the editor reloads the winning version', async () => {
    const repo = repository()
    const initial = await repo.create({ ...baseInput, actor, commandId: 'conflict-create' })
    const firstEditor = await repo.get(initial.id)
    const secondEditor = await repo.get(initial.id)

    const winner = await repo.updateDraft({
      quoteId: initial.id,
      expectedVersion: firstEditor!.version,
      actor,
      commandId: 'editor-one',
      commercialSnapshot: { ...baseInput.commercialSnapshot, notes: 'Alteração do editor 1' },
    })

    await expect(
      repo.updateDraft({
        quoteId: initial.id,
        expectedVersion: secondEditor!.version,
        actor,
        commandId: 'editor-two-stale',
        commercialSnapshot: { ...baseInput.commercialSnapshot, notes: 'Alteração do editor 2' },
      }),
    ).rejects.toMatchObject({
      code: 'CONCURRENT_MODIFICATION',
      currentVersion: winner.version,
    })

    const reloaded = await repo.get(initial.id)
    const recovered = await repo.updateDraft({
      quoteId: initial.id,
      expectedVersion: reloaded!.version,
      actor,
      commandId: 'editor-two-retry',
      commercialSnapshot: { ...reloaded!.commercialSnapshot, notes: 'Alteração conciliada' },
    })
    expect(recovered.version).toBe(3)
    expect(recovered.commercialSnapshot).toMatchObject({ notes: 'Alteração conciliada' })
  })

  it('allocates unique valid numbers from genuinely separate concurrent connections', async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL!
    const clients = Array.from({ length: 20 }, () =>
      postgres(databaseUrl, { max: 1, prepare: false }),
    )

    try {
      const created = await Promise.all(
        clients.map((client, index) =>
          repository(client).create({
            ...baseInput,
            actor,
            commandId: `parallel-create-${index}`,
          }),
        ),
      )
      const numbers = created.map((quote) => quote.quoteNumber)
      expect(new Set(numbers)).toHaveLength(20)
      expect(numbers.every((number) => /^ORC-\d{4}-\d{6}$/.test(number))).toBe(true)

      const persisted = await repository().listQuoteNumbers()
      expect(new Set(persisted)).toEqual(new Set(numbers))
    } finally {
      await Promise.all(clients.map((client) => client.end({ timeout: 5 })))
    }
  })
})
