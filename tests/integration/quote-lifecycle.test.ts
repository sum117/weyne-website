import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createQuoteLifecycleService,
  type QuoteLifecycleActor,
  type QuoteStatus,
} from '@/lib/quotes/lifecycle.server'
import { createPostgresQuoteLifecycleStore } from '@/lib/quotes/lifecycle-postgres.server'
import { createPostgresQuoteRepository } from '@/lib/quotes/quote-repository.server'
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')
const schemaName = `quote_lifecycle_${randomUUID().replaceAll('-', '')}`
const sql = postgres(databaseUrl, { max: 5, onnotice: () => undefined })
const migrations = [
  new URL('../../drizzle/0002_quote_persistence.sql', import.meta.url),
  new URL('../../drizzle/0004_quote_lifecycle.sql', import.meta.url),
]

const admin: QuoteLifecycleActor = {
  id: 'admin-1',
  role: 'admin',
  permissions: [
    'quotes:send:any',
    'quotes:update:any',
    'quotes:decide:any',
    'quotes:cancel:any',
  ],
}

const system: QuoteLifecycleActor = {
  id: 'system:quote-expiration',
  role: 'system',
  permissions: ['system:expire_quotes'],
}

beforeAll(async () => {
  await sql.unsafe(`CREATE SCHEMA "${schemaName}"`)
})

beforeEach(async () => {
  await sql.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
  await sql.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await sql.unsafe(`SET search_path TO "${schemaName}", public`)
  for (const migration of migrations) {
    await sql.unsafe(await readFile(migration, 'utf8'))
  }
})

afterAll(async () => {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  await sql.end()
})

function lifecycle(client: Sql = sql) {
  return createQuoteLifecycleService({
    store: createPostgresQuoteLifecycleStore({ sql: client, schemaName }),
  })
}

async function createReadyQuote(
  options: { validUntil?: string; status?: QuoteStatus } = {},
) {
  const validUntil =
    options.validUntil ??
    (
      await sql<{ date: string }[]>`
        SELECT (statement_timestamp() AT TIME ZONE 'America/Fortaleza')::date::text AS date
      `
    )[0]!.date
  const quote = await createPostgresQuoteRepository({
    sql,
    schemaName,
  }).create({
    ownerUserId: 'representative-1',
    validUntil,
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
    actor: { id: admin.id, role: admin.role },
    commandId: `create-${crypto.randomUUID()}`,
  })
  await sql`
    UPDATE quotes
    SET ready_to_send = true, status = ${options.status ?? 'draft'}
    WHERE id = ${quote.id}
  `
  return quote
}

describe('PostgreSQL quote lifecycle store', () => {
  it('commits the quote, history, and idempotent result in one transaction', async () => {
    const quote = await createReadyQuote()
    const request = {
      quoteId: quote.id,
      command: 'sendQuote' as const,
      actor: admin,
      idempotencyKey: 'postgres-send-1',
    }

    const first = await lifecycle().transition(request)
    const retry = await lifecycle().transition(request)

    expect(retry).toEqual(first)
    const persisted = await sql<{
      status: string
      historyCount: number
      commandCount: number
    }[]>`
      SELECT
        q.status,
        (SELECT count(*)::integer FROM quote_transition_history h WHERE h.quote_id = q.id)
          AS "historyCount",
        (SELECT count(*)::integer FROM quote_lifecycle_commands c WHERE c.quote_id = q.id)
          AS "commandCount"
      FROM quotes q
      WHERE q.id = ${quote.id}
    `
    expect(persisted[0]).toEqual({ status: 'sent', historyCount: 1, commandCount: 1 })
  })

  it('serializes competing transitions so exactly one commits', async () => {
    const quote = await createReadyQuote({ status: 'sent' })
    const firstClient = postgres(databaseUrl, { max: 1 })
    const secondClient = postgres(databaseUrl, { max: 1 })

    try {
      const outcomes = await Promise.allSettled([
        lifecycle(firstClient).transition({
          quoteId: quote.id,
          command: 'approveQuote',
          actor: admin,
          idempotencyKey: 'postgres-competing-approve',
        }),
        lifecycle(secondClient).transition({
          quoteId: quote.id,
          command: 'rejectQuote',
          actor: admin,
          idempotencyKey: 'postgres-competing-reject',
          reason: 'Cliente recusou',
        }),
      ])

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
      const counts = await sql<{ historyCount: number; commandCount: number }[]>`
        SELECT
          (SELECT count(*)::integer FROM quote_transition_history WHERE quote_id = ${quote.id})
            AS "historyCount",
          (SELECT count(*)::integer FROM quote_lifecycle_commands WHERE quote_id = ${quote.id})
            AS "commandCount"
      `
      expect(counts[0]).toEqual({ historyCount: 1, commandCount: 1 })
    } finally {
      await Promise.all([
        firstClient.end({ timeout: 5 }),
        secondClient.end({ timeout: 5 }),
      ])
    }
  })

  it('rolls back a status update when the audit insert fails', async () => {
    const quote = await createReadyQuote()
    await sql.unsafe(`
      CREATE FUNCTION fail_quote_transition_history()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'synthetic history failure';
      END;
      $$;
      CREATE TRIGGER fail_quote_transition_history_trg
      BEFORE INSERT ON quote_transition_history
      FOR EACH ROW EXECUTE FUNCTION fail_quote_transition_history();
    `)

    await expect(
      lifecycle().transition({
        quoteId: quote.id,
        command: 'sendQuote',
        actor: admin,
        idempotencyKey: 'postgres-rollback-send',
      }),
    ).rejects.toThrow(/synthetic history failure/i)

    const persisted = await sql<{ status: string; commandCount: number }[]>`
      SELECT
        status,
        (SELECT count(*)::integer FROM quote_lifecycle_commands WHERE quote_id = ${quote.id})
          AS "commandCount"
      FROM quotes
      WHERE id = ${quote.id}
    `
    expect(persisted[0]).toEqual({ status: 'draft', commandCount: 0 })
  })

  it('uses the database business date for inclusive validity and safe expiration', async () => {
    const todayRows = await sql<{ today: string; yesterday: string }[]>`
      SELECT
        (clock_timestamp() AT TIME ZONE 'America/Fortaleza')::date::text AS today,
        ((clock_timestamp() AT TIME ZONE 'America/Fortaleza')::date - 1)::text AS yesterday
    `
    const todayQuote = await createReadyQuote({ validUntil: todayRows[0]!.today })
    const sent = await lifecycle().transition({
      quoteId: todayQuote.id,
      command: 'sendQuote',
      actor: admin,
      idempotencyKey: 'boundary-send',
    })
    const approved = await lifecycle().transition({
      quoteId: sent.quote.id,
      command: 'approveQuote',
      actor: admin,
      idempotencyKey: 'boundary-approve',
    })
    expect(approved.quote.status).toBe('approved')

    const stale = await createReadyQuote({
      validUntil: todayRows[0]!.yesterday,
      status: 'sent',
    })
    await expect(
      lifecycle().transition({
        quoteId: stale.id,
        command: 'cancelQuote',
        actor: admin,
        idempotencyKey: 'stale-cancel',
        reason: 'Tentativa concorrente tardia',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })

    const expired = await lifecycle().transition({
      quoteId: stale.id,
      command: 'expireQuote',
      actor: system,
      idempotencyKey: 'boundary-expire',
    })
    expect(expired.quote.status).toBe('expired')
  })
})
