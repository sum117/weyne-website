import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createPostgresQuoteConversionService,
  type QuoteConversionSnapshot,
} from '@/lib/orders/quote-conversion.server'
import { createPostgresQuoteRepository } from '@/lib/quotes/quote-repository.server'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

const actor = { id: 'representative-1', role: 'representative' as const }
let harness: PostgresTestHarness

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'quote_to_order',
    migrationNames: [
      '0000_migration_smoke.sql',
      '0002_quote_persistence.sql',
      '0004_order_persistence.sql',
      '0005_quote_to_order_conversion.sql',
      '0010_order_line_commission_facts.sql',
    ],
  })
})

beforeEach(async () => {
  await harness.reset()
})

afterAll(async () => {
  await harness?.close()
})

function snapshot(): QuoteConversionSnapshot {
  return {
    revision: 3,
    currencyCode: 'BRL',
    totals: {
      grossItemsAmount: '100.000000',
      perItemDiscountAmount: '10.000000',
      netItemsAmount: '90.000000',
      generalDiscountRate: '5.000000',
      generalDiscountAmount: '4.500000',
      netAfterDiscountsAmount: '85.500000',
      ipiAmount: '8.550000',
      configuredTaxAmount: '15.390000',
      freightAmount: '10.000000',
      grandTotalAmount: '119.440000',
      commissionBasisAmount: '85.500000',
      commissionAmount: '2.565000',
    },
    lines: [
      {
        sourceQuoteLineId: randomUUID(),
        lineNumber: 1,
        product: {
          id: randomUUID(),
          industryId: randomUUID(),
          industryName: 'Indústria Fictícia Teste',
          internalCode: 'TEST-001',
          manufacturerCode: 'FAB-001',
          description: 'Produto aprovado e congelado',
          brand: 'Marca Teste',
          category: 'Categoria Teste',
          ncm: '12345678',
          cest: '1234567',
          ean: null,
          dun: null,
          packaging: 'CX',
          unit: 'UN',
        },
        quantity: '10.000000',
        unitPrice: {
          priceListId: randomUUID(),
          productPriceVersionId: randomUUID(),
          source: 'price_list',
          amount: '10.000000',
        },
        grossAmount: '100.000000',
        perItemDiscountRate: '10.000000',
        perItemDiscountAmount: '10.000000',
        netBeforeGeneralDiscountAmount: '90.000000',
        allocatedGeneralDiscountAmount: '4.500000',
        netAfterDiscountsAmount: '85.500000',
        ipiRate: '10.000000',
        ipiBasisAmount: '85.500000',
        ipiAmount: '8.550000',
        configuredTaxAmount: '15.390000',
        freightAmount: '10.000000',
        lineTotalAmount: '119.440000',
        commissionSource: 'product_override',
        commissionRate: '3.000000',
        commissionBasisAmount: '85.500000',
        commissionAmount: '2.565000',
        configuredTaxes: [
          {
            code: 'ICMS',
            rate: '18.000000',
            basisAmount: '85.500000',
            amount: '15.390000',
          },
        ],
      },
    ],
  }
}

const customerSnapshot = {
  id: 'f71d9d64-2c66-4bd4-84e8-b0834f870a33',
  legalName: 'Cliente Fictício Teste Ltda.',
  tradeName: 'Cliente Teste',
  taxIdentifier: '00000000000000',
  stateRegistration: 'ISENTO',
  email: 'cliente@example.invalid',
  phone: '+55 00 00000-0000',
  address: {
    street: 'Rua Fictícia',
    number: '123',
    complement: 'Sala 4',
    district: 'Centro de Testes',
    city: 'Cidade Sintética',
    state: 'ZZ',
    postalCode: '00000000',
    countryCode: 'BR',
  },
}

async function createDraftQuote(commercialSnapshot = snapshot()) {
  const repository = createPostgresQuoteRepository({
    sql: harness.sql,
    schemaName: harness.schemaName,
  })
  return repository.create({
    ownerUserId: actor.id,
    validUntil: '2026-09-30',
    customerSnapshot,
    commercialSnapshot,
    actor,
    commandId: randomUUID(),
  })
}

async function createApprovedQuote(commercialSnapshot = snapshot()) {
  const repository = createPostgresQuoteRepository({
    sql: harness.sql,
    schemaName: harness.schemaName,
  })
  const created = await createDraftQuote(commercialSnapshot)
  const sent = await repository.transition({
    quoteId: created.id,
    expectedVersion: created.version,
    toStatus: 'sent',
    actor,
    commandId: randomUUID(),
  })
  return repository.transition({
    quoteId: sent.id,
    expectedVersion: sent.version,
    toStatus: 'approved',
    actor,
    commandId: randomUUID(),
  })
}

describe('approved quote to order conversion on PostgreSQL', () => {
  it('atomically creates an open order with immutable approved snapshots and histories', async () => {
    const approved = await createApprovedQuote()
    const service = createPostgresQuoteConversionService({
      sql: harness.sql,
      schemaName: harness.schemaName,
    })

    const order = await service.convert({
      quoteId: approved.id,
      commandId: 'convert-success-1',
      actor,
    })

    expect(order).toMatchObject({
      sourceQuoteId: approved.id,
      number: 'PED-2026-000001',
      status: 'open',
      version: 1n,
    })

    const [persisted] = await harness.sql<
      Array<{
        quoteStatus: string
        clientLegalName: string
        grandTotalAmount: string
        productDescription: string
        unitPriceAmount: string
        taxAmount: string
        orderHistoryCount: string
        quoteConversionHistoryCount: string
      }>
    >`
      SELECT
        q.status AS "quoteStatus",
        o.client_legal_name AS "clientLegalName",
        o.grand_total_amount::text AS "grandTotalAmount",
        ol.product_description AS "productDescription",
        ol.unit_price_amount::text AS "unitPriceAmount",
        olt.amount::text AS "taxAmount",
        (SELECT count(*)::text FROM order_state_audit osa WHERE osa.order_id = o.id)
          AS "orderHistoryCount",
        (SELECT count(*)::text FROM quote_audit qa
          WHERE qa.quote_id = q.id AND qa.after_state ->> 'status' = 'converted')
          AS "quoteConversionHistoryCount"
      FROM quotes q
      JOIN orders o ON o.source_quote_id = q.id
      JOIN order_lines ol ON ol.order_id = o.id
      JOIN order_line_taxes olt ON olt.order_line_id = ol.id
      WHERE q.id = ${approved.id}
    `

    expect(persisted).toEqual({
      quoteStatus: 'converted',
      clientLegalName: customerSnapshot.legalName,
      grandTotalAmount: '119.440000',
      productDescription: 'Produto aprovado e congelado',
      unitPriceAmount: '10.000000',
      taxAmount: '15.390000',
      orderHistoryCount: '1',
      quoteConversionHistoryCount: '1',
    })

    await harness.sql`
      UPDATE quotes
      SET customer_snapshot = ${JSON.stringify({ ...customerSnapshot, legalName: 'ALTERADO' })}::jsonb,
          commercial_snapshot = ${JSON.stringify({ ...snapshot(), totals: { grandTotalAmount: '0.000000' } })}::jsonb
      WHERE id = ${approved.id}
    `
    const [unchanged] = await harness.sql<
      Array<{ clientLegalName: string; grandTotalAmount: string; productDescription: string }>
    >`
      SELECT o.client_legal_name AS "clientLegalName",
             o.grand_total_amount::text AS "grandTotalAmount",
             ol.product_description AS "productDescription"
      FROM orders o JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.id = ${order.id}
    `
    expect(unchanged).toEqual({
      clientLegalName: customerSnapshot.legalName,
      grandTotalAmount: '119.440000',
      productDescription: 'Produto aprovado e congelado',
    })
  })

  it('returns one order for retries and genuinely concurrent conversion commands', async () => {
    const approved = await createApprovedQuote()
    const databaseUrl = process.env.TEST_DATABASE_URL!
    const clients = [postgres(databaseUrl, { max: 1 }), postgres(databaseUrl, { max: 1 })]

    try {
      const [first, second] = await Promise.all(
        clients.map((client, index) =>
          createPostgresQuoteConversionService({
            sql: client,
            schemaName: harness.schemaName,
          }).convert({
            quoteId: approved.id,
            commandId: `concurrent-conversion-${index}`,
            actor,
          }),
        ),
      )
      expect(second).toEqual(first)

      const retry = await createPostgresQuoteConversionService({
        sql: harness.sql,
        schemaName: harness.schemaName,
      }).convert({
        quoteId: approved.id,
        commandId: 'concurrent-conversion-0',
        actor,
      })
      expect(retry).toEqual(first)

      const [counts] = await harness.sql<
        Array<{
          orders: string
          lines: string
          histories: string
          conversionEvents: string
          commands: string
        }>
      >`
        SELECT
          (SELECT count(*)::text FROM orders WHERE source_quote_id = ${approved.id}) AS orders,
          (SELECT count(*)::text FROM order_lines ol JOIN orders o ON o.id = ol.order_id
            WHERE o.source_quote_id = ${approved.id}) AS lines,
          (SELECT count(*)::text FROM order_state_audit osa JOIN orders o ON o.id = osa.order_id
            WHERE o.source_quote_id = ${approved.id}) AS histories,
          (SELECT count(*)::text FROM quote_audit qa
            WHERE qa.quote_id = ${approved.id} AND qa.after_state ->> 'status' = 'converted') AS "conversionEvents",
          (SELECT count(*)::text FROM quote_conversion_commands
            WHERE quote_id = ${approved.id} AND order_id IS NOT NULL) AS commands
      `
      expect(counts).toEqual({
        orders: '1',
        lines: '1',
        histories: '1',
        conversionEvents: '1',
        commands: '2',
      })
    } finally {
      await Promise.all(clients.map((client) => client.end({ timeout: 5 })))
    }
  })

  it('rolls back the order, number, histories, and idempotency reservation on failure', async () => {
    const approved = await createApprovedQuote()
    const service = createPostgresQuoteConversionService({
      sql: harness.sql,
      schemaName: harness.schemaName,
    })
    await harness.sql.unsafe(`
      CREATE FUNCTION fail_test_conversion() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'converted' THEN
          RAISE EXCEPTION 'synthetic conversion failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_test_conversion_trg
      BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION fail_test_conversion();
    `)

    await expect(
      service.convert({ quoteId: approved.id, commandId: 'rollback-conversion', actor }),
    ).rejects.toThrow('synthetic conversion failure')

    const [rolledBack] = await harness.sql<
      Array<{ status: string; orders: string; commands: string; orderSequence: string | null }>
    >`
      SELECT q.status,
        (SELECT count(*)::text FROM orders WHERE source_quote_id = q.id) AS orders,
        (SELECT count(*)::text FROM quote_conversion_commands WHERE quote_id = q.id) AS commands,
        (SELECT next_value::text FROM document_sequences WHERE document_type = 'order') AS "orderSequence"
      FROM quotes q WHERE q.id = ${approved.id}
    `
    expect(rolledBack).toEqual({
      status: 'approved',
      orders: '0',
      commands: '0',
      orderSequence: null,
    })

    await harness.sql.unsafe(
      'DROP TRIGGER fail_test_conversion_trg ON quotes; DROP FUNCTION fail_test_conversion()',
    )
    const recovered = await service.convert({
      quoteId: approved.id,
      commandId: 'rollback-conversion',
      actor,
    })
    expect(recovered.number).toBe('PED-2026-000001')
  })

  it('rejects conversion when stored totals fail server-side recalculation, leaving the quote intact', async () => {
    const tampered: QuoteConversionSnapshot = {
      ...snapshot(),
      totals: { ...snapshot().totals, grandTotalAmount: '999.990000' },
    }
    const approved = await createApprovedQuote(tampered)
    const service = createPostgresQuoteConversionService({
      sql: harness.sql,
      schemaName: harness.schemaName,
    })

    await expect(
      service.convert({ quoteId: approved.id, commandId: 'tampered-totals', actor }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_INTEGRITY_ERROR' })

    const [intact] = await harness.sql<Array<{ status: string; orders: string }>>`
      SELECT q.status,
        (SELECT count(*)::text FROM orders WHERE source_quote_id = q.id) AS orders
      FROM quotes q WHERE q.id = ${approved.id}
    `
    expect(intact).toEqual({ status: 'approved', orders: '0' })
  })

  it('recalculates totals from snapshot lines without consulting catalog prices', async () => {
    const priced = snapshot()
    // Quoted values deliberately differ from any catalog truth: fidelity to
    // the approved snapshot is what matters, not agreement with the catalog.
    const approved = await createApprovedQuote(priced)
    const service = createPostgresQuoteConversionService({
      sql: harness.sql,
      schemaName: harness.schemaName,
    })

    const order = await service.convert({
      quoteId: approved.id,
      commandId: 'snapshot-fidelity',
      actor,
    })
    const [persisted] = await harness.sql<
      Array<{
        grossItemsAmount: string
        perItemDiscountAmount: string
        netItemsAmount: string
        generalDiscountRate: string
        generalDiscountAmount: string
        netAfterDiscountsAmount: string
        ipiAmount: string
        configuredTaxAmount: string
        freightAmount: string
        grandTotalAmount: string
        commissionBasisAmount: string
        commissionAmount: string
        quantity: string
        unitPriceAmount: string
        ipiRate: string
        commissionRate: string
        taxRate: string
        taxBasisAmount: string
        allocatedGeneralDiscountAmount: string
      }>
    >`
      SELECT o.gross_items_amount::text AS "grossItemsAmount",
             o.per_item_discount_amount::text AS "perItemDiscountAmount",
             o.net_items_amount::text AS "netItemsAmount",
             o.general_discount_rate::text AS "generalDiscountRate",
             o.general_discount_amount::text AS "generalDiscountAmount",
             o.net_after_discounts_amount::text AS "netAfterDiscountsAmount",
             o.ipi_amount::text AS "ipiAmount",
             o.configured_tax_amount::text AS "configuredTaxAmount",
             o.freight_amount::text AS "freightAmount",
             o.grand_total_amount::text AS "grandTotalAmount",
             o.commission_basis_amount::text AS "commissionBasisAmount",
             o.commission_amount::text AS "commissionAmount",
             ol.quantity::text AS quantity,
             ol.unit_price_amount::text AS "unitPriceAmount",
             ol.ipi_rate::text AS "ipiRate",
             ol.commission_rate::text AS "commissionRate",
             olt.rate::text AS "taxRate",
             olt.basis_amount::text AS "taxBasisAmount",
             ol.allocated_general_discount_amount::text AS "allocatedGeneralDiscountAmount"
      FROM orders o
      JOIN order_lines ol ON ol.order_id = o.id
      JOIN order_line_taxes olt ON olt.order_line_id = ol.id
      WHERE o.id = ${order.id}
    `

    // Every header total equals the stored snapshot exactly.
    expect(persisted).toEqual(
      expect.objectContaining({
        grossItemsAmount: priced.totals.grossItemsAmount,
        perItemDiscountAmount: priced.totals.perItemDiscountAmount,
        netItemsAmount: priced.totals.netItemsAmount,
        generalDiscountRate: priced.totals.generalDiscountRate,
        generalDiscountAmount: priced.totals.generalDiscountAmount,
        netAfterDiscountsAmount: priced.totals.netAfterDiscountsAmount,
        ipiAmount: priced.totals.ipiAmount,
        configuredTaxAmount: priced.totals.configuredTaxAmount,
        freightAmount: priced.totals.freightAmount,
        grandTotalAmount: priced.totals.grandTotalAmount,
        commissionBasisAmount: priced.totals.commissionBasisAmount,
        commissionAmount: priced.totals.commissionAmount,
        quantity: priced.lines[0]!.quantity,
        unitPriceAmount: priced.lines[0]!.unitPrice.amount,
        ipiRate: priced.lines[0]!.ipiRate,
        commissionRate: priced.lines[0]!.commissionRate,
        taxRate: priced.lines[0]!.configuredTaxes[0]!.rate,
        taxBasisAmount: priced.lines[0]!.configuredTaxes[0]!.basisAmount,
        allocatedGeneralDiscountAmount:
          priced.lines[0]!.allocatedGeneralDiscountAmount,
      }),
    )
  })

  it('resolves a unique-conflict race to the canonical order instead of failing', async () => {
    const approved = await createApprovedQuote()
    const service = createPostgresQuoteConversionService({
      sql: harness.sql,
      schemaName: harness.schemaName,
    })
    const first = await service.convert({
      quoteId: approved.id,
      commandId: 'race-first',
      actor,
    })

    // Simulate the race window: an order exists but the quote's converted
    // marker was not yet visible to the second transaction (status forced
    // back to 'approved' after the fact).
    await harness.sql`UPDATE quotes SET status = 'approved' WHERE id = ${approved.id}`
    const raced = await service.convert({
      quoteId: approved.id,
      commandId: 'race-second',
      actor,
    })

    expect(raced.id).toBe(first.id)
    expect(raced.number).toBe(first.number)

    const [counts] = await harness.sql<Array<{ orders: string; status: string }>>`
      SELECT (SELECT count(*)::text FROM orders WHERE source_quote_id = ${approved.id}) AS orders,
             (SELECT status FROM quotes WHERE id = ${approved.id}) AS status
    `
    expect(counts).toEqual({ orders: '1', status: 'approved' })
  })

  it('persists immutable commission facts with provenance and survives rule edits', async () => {
    const priced = snapshot()
    const approved = await createApprovedQuote(priced)
    const service = createPostgresQuoteConversionService({
      sql: harness.sql,
      schemaName: harness.schemaName,
    })

    const order = await service.convert({
      quoteId: approved.id,
      commandId: 'commission-facts',
      actor,
    })

    // The conversion-time snapshot records the selected source, rate, basis,
    // value, and the provenance of the selected rate.
    const [facts] = await harness.sql<
      Array<{
        commissionSource: string
        commissionRate: string
        commissionBasisAmount: string
        commissionAmount: string
        commissionIndustryId: string | null
        commissionProvenance: string
      }>
    >`
      SELECT commission_source AS "commissionSource",
             commission_rate::text AS "commissionRate",
             commission_basis_amount::text AS "commissionBasisAmount",
             commission_amount::text AS "commissionAmount",
             commission_industry_id::text AS "commissionIndustryId",
             commission_provenance AS "commissionProvenance"
      FROM order_lines WHERE order_id = ${order.id}
    `
    const line = priced.lines[0]!
    expect(facts).toEqual({
      commissionSource: line.commissionSource,
      commissionRate: line.commissionRate,
      commissionBasisAmount: line.commissionBasisAmount,
      commissionAmount: line.commissionAmount,
      commissionIndustryId: line.product.industryId,
      commissionProvenance: 'product_override_snapshot',
    })

    // Later edits to the quote's stored rules cannot recalculate or silently
    // change a converted order's frozen facts.
    await harness.sql`
      UPDATE quotes
      SET commercial_snapshot = ${JSON.stringify({
        ...priced,
        lines: [
          {
            ...line,
            commissionSource: 'industry_default',
            commissionRate: '99.000000',
            commissionAmount: '84585.000000',
          },
        ],
        totals: { ...priced.totals, commissionAmount: '84585.000000' },
      })}::jsonb
      WHERE id = ${approved.id}
    `

    const [unchanged] = await harness.sql<
      Array<{
        orders: string
        commissionRate: string
        commissionAmount: string
        commissionProvenance: string | null
      }>
    >`
      SELECT (SELECT count(*)::text FROM orders) AS orders,
             ol.commission_rate::text AS "commissionRate",
             ol.commission_amount::text AS "commissionAmount",
             ol.commission_provenance AS "commissionProvenance"
      FROM order_lines ol WHERE ol.order_id = ${order.id}
    `
    expect(unchanged).toEqual({
      orders: '1',
      commissionRate: line.commissionRate,
      commissionAmount: line.commissionAmount,
      commissionProvenance: 'product_override_snapshot',
    })
  })

  it('persists per-line commission precedence across mixed sources', async () => {
    const first = snapshot()
    // Second line carries no overrides: it falls through to its industry
    // default rate instead of the first line's product override.
    const industryLine = {
      ...first.lines[0]!,
      sourceQuoteLineId: randomUUID(),
      lineNumber: 2,
      product: { ...first.lines[0]!.product, id: randomUUID() },
      quantity: '1.000000',
      unitPrice: { ...first.lines[0]!.unitPrice, amount: '50.000000' },
      grossAmount: '50.000000',
      perItemDiscountRate: '0.000000',
      perItemDiscountAmount: '0.000000',
      netBeforeGeneralDiscountAmount: '50.000000',
      allocatedGeneralDiscountAmount: '0.000000',
      netAfterDiscountsAmount: '50.000000',
      ipiRate: '0.000000',
      ipiBasisAmount: '50.000000',
      ipiAmount: '0.000000',
      configuredTaxAmount: '0.000000',
      freightAmount: '0.000000',
      lineTotalAmount: '50.000000',
      commissionSource: 'industry_default' as const,
      commissionRate: '5.000000',
      commissionBasisAmount: '50.000000',
      commissionAmount: '2.500000',
      configuredTaxes: [
        { code: 'ICMS', rate: '0.000000', basisAmount: '50.000000', amount: '0.000000' },
      ],
    }
    const priced: QuoteConversionSnapshot = {
      ...first,
      totals: {
        ...first.totals,
        grossItemsAmount: '150.000000',
        perItemDiscountAmount: '10.000000',
        netItemsAmount: '140.000000',
        netAfterDiscountsAmount: '135.500000',
        ipiAmount: '8.550000',
        configuredTaxAmount: '15.390000',
        grandTotalAmount: '169.440000',
        commissionBasisAmount: '135.500000',
        commissionAmount: '5.065000',
      },
      lines: [first.lines[0]!, industryLine],
    }
    const approved = await createApprovedQuote(priced)
    const service = createPostgresQuoteConversionService({
      sql: harness.sql,
      schemaName: harness.schemaName,
    })

    const order = await service.convert({
      quoteId: approved.id,
      commandId: 'commission-precedence',
      actor,
    })

    const facts = await harness.sql<
      Array<{
        lineNumber: string
        commissionSource: string
        commissionRate: string
        commissionProvenance: string
        commissionIndustryId: string | null
      }>
    >`
      SELECT line_number::text AS "lineNumber",
             commission_source AS "commissionSource",
             commission_rate::text AS "commissionRate",
             commission_provenance AS "commissionProvenance",
             commission_industry_id::text AS "commissionIndustryId"
      FROM order_lines WHERE order_id = ${order.id} ORDER BY line_number
    `
    expect(facts).toEqual([
      {
        lineNumber: '1',
        commissionSource: 'product_override',
        commissionRate: '3.000000',
        commissionProvenance: 'product_override_snapshot',
        commissionIndustryId: first.lines[0]!.product.industryId,
      },
      {
        lineNumber: '2',
        commissionSource: 'industry_default',
        commissionRate: '5.000000',
        commissionProvenance: 'industry_default_snapshot',
        commissionIndustryId: industryLine.product.industryId,
      },
    ])
  })

  it('rejects invalid states, unauthorized actors, and reused command ids without effects', async () => {
    const draft = await createDraftQuote()
    const approved = await createApprovedQuote()
    const service = createPostgresQuoteConversionService({
      sql: harness.sql,
      schemaName: harness.schemaName,
    })

    await expect(
      service.convert({ quoteId: draft.id, commandId: 'invalid-draft', actor }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    await expect(
      service.convert({
        quoteId: approved.id,
        commandId: 'forbidden-read-only',
        actor: { id: actor.id, role: 'read_only' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const converted = await service.convert({
      quoteId: approved.id,
      commandId: 'reused-command',
      actor,
    })
    await expect(
      service.convert({ quoteId: draft.id, commandId: 'reused-command', actor }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })

    const [counts] = await harness.sql<Array<{ orders: string; draftStatus: string }>>`
      SELECT
        (SELECT count(*)::text FROM orders) AS orders,
        (SELECT status FROM quotes WHERE id = ${draft.id}) AS "draftStatus"
    `
    expect(counts).toEqual({ orders: '1', draftStatus: 'draft' })
    expect(converted.sourceQuoteId).toBe(approved.id)
  })
})
