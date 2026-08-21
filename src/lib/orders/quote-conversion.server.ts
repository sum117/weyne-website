import { createHash } from 'node:crypto'
import type { Sql } from 'postgres'
import type {
  NewOrderLineSnapshot,
  NewOrderSnapshot,
  OrderClientSnapshot,
  PersistedOrder,
} from '@/lib/orders/repository.server'
import { buildOrderCommissionFacts } from '@/lib/orders/commission-facts.server'
import { verifyOrderTotals } from '@/lib/orders/total-verification.server'
import type { QuoteActor, QuoteStatus } from '@/lib/quotes/quote-repository.server'

export type QuoteConversionSnapshot = Readonly<{
  revision: number
  currencyCode: string
  totals: NewOrderSnapshot['totals']
  lines: readonly Readonly<NewOrderLineSnapshot>[]
}>

export type QuoteConversionErrorCode =
  | 'QUOTE_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_STATE_TRANSITION'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SNAPSHOT_INTEGRITY_ERROR'

export class QuoteConversionError extends Error {
  readonly code: QuoteConversionErrorCode

  constructor(code: QuoteConversionErrorCode, message: string = code) {
    super(message)
    this.name = 'QuoteConversionError'
    this.code = code
  }
}

type QuoteRow = Readonly<{
  id: string
  quoteNumber: string
  ownerUserId: string
  status: QuoteStatus
  validUntil: string
  version: number
  customerSnapshot: unknown
  commercialSnapshot: unknown
}>

type CommandRow = Readonly<{
  payloadHash: string
  quoteId: string
  orderId: string | null
}>

type ExistingOrderRow = Readonly<{
  id: string
  sourceQuoteId: string
  number: string
  status: PersistedOrder['status']
  version: string
  createdAt: Date | string
}>

export function createPostgresQuoteConversionService(options: {
  readonly sql: Sql
  readonly schemaName: string
}) {
  const { sql, schemaName } = options
  if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
    throw new Error(`Invalid PostgreSQL schema name: ${schemaName}`)
  }
  const quotedSchema = `"${schemaName}"`

  return Object.freeze({
    async convert(input: Readonly<{
      quoteId: string
      commandId: string
      actor: QuoteActor
    }>): Promise<PersistedOrder> {
      const commandId = input.commandId.trim()
      if (!commandId) throw new QuoteConversionError('SNAPSHOT_INTEGRITY_ERROR', 'commandId is required')
      const payloadHash = hashPayload(input)

      return sql.begin(async (transaction) => {
        const tx = transaction as unknown as Sql
        await tx.unsafe(`SET LOCAL search_path TO ${quotedSchema}, public`)

        const quote = await lockQuote(tx, input.quoteId)
        if (!quote) throw new QuoteConversionError('QUOTE_NOT_FOUND')
        assertAuthorized(quote, input.actor)

        const command = await findCommand(tx, commandId)
        if (command && command.payloadHash !== payloadHash) {
          throw new QuoteConversionError('IDEMPOTENCY_KEY_REUSED')
        }
        if (command && command.quoteId !== quote.id) {
          throw new QuoteConversionError('IDEMPOTENCY_KEY_REUSED')
        }

        const existingOrder = await findOrder(tx, quote.id)
        if (command?.orderId) {
          if (!existingOrder || existingOrder.id !== command.orderId) {
            throw new QuoteConversionError('SNAPSHOT_INTEGRITY_ERROR')
          }
          return existingOrder
        }

        if (quote.status === 'converted') {
          if (!existingOrder) throw new QuoteConversionError('SNAPSHOT_INTEGRITY_ERROR')
          await completeCommand(tx, { commandId, payloadHash, quoteId: quote.id, orderId: existingOrder.id })
          return existingOrder
        }
        if (quote.status !== 'approved') {
          throw new QuoteConversionError(
            'INVALID_STATE_TRANSITION',
            `Cannot convert quote from ${quote.status}`,
          )
        }
        if (existingOrder) {
          // A committed order already exists for this quote. Regardless of the
          // quote's visible status (a racing transaction may not yet have
          // flipped it to 'converted'), resolve to the canonical order instead
          // of failing — this is the unique-conflict resolution path.
          return existingOrder
        }

        const orderSnapshot = parseOrderSnapshot(quote)
        const totalProblems = verifyOrderTotals(orderSnapshot)
        if (totalProblems.length > 0) {
          throw new QuoteConversionError(
            'SNAPSHOT_INTEGRITY_ERROR',
            `Stored quote totals failed server-side verification: ${totalProblems.join('; ')}`,
          )
        }
        // Conversion-time commission snapshot: the pure calculator resolves
        // precedence and value once; the facts frozen here are what the
        // order reports forever, regardless of later rule edits.
        const commissionFacts = buildOrderCommissionFacts(
          orderSnapshot.lines.map((line) => ({
            sourceQuoteLineId: line.sourceQuoteLineId,
            lineNumber: line.lineNumber,
            industryId: line.product.industryId,
            grossAmount: line.grossAmount,
            perItemDiscountAmount: line.perItemDiscountAmount,
            allocatedGeneralDiscountAmount: line.allocatedGeneralDiscountAmount,
            commissionSource: line.commissionSource,
            commissionRate: line.commissionRate,
            commissionBasisAmount: line.commissionBasisAmount,
            commissionAmount: line.commissionAmount,
          })),
        )
        await reserveCommand(tx, { commandId, payloadHash, quoteId: quote.id })

        const order = await createOrder(tx, orderSnapshot, commissionFacts, input.actor.id)

        const [updated] = await tx<QuoteRow[]>`
          UPDATE quotes
          SET status = 'converted', version = version + 1, updated_at = clock_timestamp()
          WHERE id = ${quote.id} AND status = 'approved' AND version = ${quote.version}
          RETURNING
            id,
            quote_number AS "quoteNumber",
            owner_user_id AS "ownerUserId",
            status,
            valid_until::text AS "validUntil",
            version,
            customer_snapshot AS "customerSnapshot",
            commercial_snapshot AS "commercialSnapshot"
        `
        if (!updated) throw new QuoteConversionError('INVALID_STATE_TRANSITION')

        await tx`
          INSERT INTO quote_versions (quote_id, version, operation, snapshot)
          VALUES (
            ${updated.id},
            ${updated.version},
            'transition',
            jsonb_build_object(
              'id', ${updated.id}::text,
              'quoteNumber', ${updated.quoteNumber}::text,
              'sourceQuoteId', NULL,
              'ownerUserId', ${updated.ownerUserId}::text,
              'status', ${updated.status}::text,
              'validUntil', ${updated.validUntil}::text,
              'version', ${updated.version}::integer,
              'customerSnapshot', ${JSON.stringify(updated.customerSnapshot)}::jsonb,
              'commercialSnapshot', ${JSON.stringify(updated.commercialSnapshot)}::jsonb
            )
          )
        `
        await tx`
          INSERT INTO quote_audit (
            quote_id, actor_id, actor_role, operation, version, command_id,
            before_state, after_state
          ) VALUES (
            ${updated.id}, ${input.actor.id}, ${input.actor.role}, 'transition',
            ${updated.version}, ${commandId},
            jsonb_build_object(
              'status', ${quote.status}::text,
              'version', ${quote.version}::integer
            ),
            jsonb_build_object(
              'status', 'converted',
              'version', ${updated.version}::integer,
              'orderId', ${order.id}::text
            )
          )
        `
        await completeCommand(tx, {
          commandId,
          payloadHash,
          quoteId: quote.id,
          orderId: order.id,
        })
        return order
      }) as Promise<PersistedOrder>
    },
  })
}

async function createOrder(
  tx: Sql,
  snapshot: NewOrderSnapshot,
  commissionFacts: ReturnType<typeof buildOrderCommissionFacts>,
  actorId: string,
): Promise<PersistedOrder> {
  const [clock] = await tx<Array<{ occurredAt: Date; year: number }>>`
    SELECT clock_timestamp() AS "occurredAt",
           extract(year FROM transaction_timestamp() AT TIME ZONE 'America/Fortaleza')::integer AS year
  `
  if (!clock) throw new QuoteConversionError('SNAPSHOT_INTEGRITY_ERROR')
  const [allocated] = await tx<Array<{ sequence: string }>>`
    INSERT INTO document_sequences (document_type, year, next_value)
    VALUES ('order', ${clock.year}, 2)
    ON CONFLICT (document_type, year)
    DO UPDATE SET next_value = document_sequences.next_value + 1
    RETURNING (next_value - 1)::text AS sequence
  `
  const sequence = Number(allocated?.sequence)
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999999) {
    throw new QuoteConversionError('SNAPSHOT_INTEGRITY_ERROR')
  }
  const number = `PED-${clock.year}-${String(sequence).padStart(6, '0')}`
  const client = snapshot.client
  const totals = snapshot.totals
  const [created] = await tx<
    Array<{
      id: string
      sourceQuoteId: string
      number: string
      status: PersistedOrder['status']
      version: string
      createdAt: Date
    }>
  >`
    INSERT INTO orders (
      source_quote_id, source_quote_revision, number, number_year, number_sequence,
      status, version, client_id, client_legal_name, client_trade_name,
      client_tax_identifier, client_state_registration, client_email, client_phone,
      client_address_street, client_address_number, client_address_complement,
      client_address_district, client_address_city, client_address_state,
      client_address_postal_code, client_address_country_code, currency_code,
      gross_items_amount, per_item_discount_amount, net_items_amount,
      general_discount_rate, general_discount_amount, net_after_discounts_amount,
      ipi_amount, configured_tax_amount, freight_amount, grand_total_amount,
      commission_basis_amount, commission_amount, created_at, created_by,
      creation_reason, updated_at, updated_by, status_changed_at,
      status_changed_by, status_change_reason
    ) VALUES (
      ${snapshot.sourceQuoteId}, ${snapshot.sourceQuoteRevision}, ${number}, ${clock.year}, ${sequence},
      'open', 1, ${client.id}, ${client.legalName}, ${client.tradeName},
      ${client.taxIdentifier}, ${client.stateRegistration}, ${client.email}, ${client.phone},
      ${client.address.street}, ${client.address.number}, ${client.address.complement},
      ${client.address.district}, ${client.address.city}, ${client.address.state},
      ${client.address.postalCode}, ${client.address.countryCode}, ${snapshot.currencyCode},
      ${totals.grossItemsAmount}, ${totals.perItemDiscountAmount}, ${totals.netItemsAmount},
      ${totals.generalDiscountRate}, ${totals.generalDiscountAmount}, ${totals.netAfterDiscountsAmount},
      ${totals.ipiAmount}, ${totals.configuredTaxAmount}, ${totals.freightAmount}, ${totals.grandTotalAmount},
      ${totals.commissionBasisAmount}, ${totals.commissionAmount}, ${clock.occurredAt}, ${actorId},
      'Approved quote conversion', ${clock.occurredAt}, ${actorId}, ${clock.occurredAt},
      ${actorId}, 'Approved quote conversion'
    )
    RETURNING id, source_quote_id AS "sourceQuoteId", number, status,
              version::text AS version, created_at AS "createdAt"
  `
  if (!created) throw new QuoteConversionError('SNAPSHOT_INTEGRITY_ERROR')

  for (const [index, line] of snapshot.lines.entries()) {
    const facts = commissionFacts.lines[index]
    if (!facts) throw new QuoteConversionError('SNAPSHOT_INTEGRITY_ERROR')
    const [createdLine] = await tx<Array<{ id: string }>>`
      INSERT INTO order_lines (
        order_id, source_quote_line_id, line_number, product_id,
        product_industry_id, product_industry_name, product_internal_code,
        product_manufacturer_code, product_description, product_brand, product_category,
        product_ncm, product_cest, product_ean, product_dun, product_packaging, product_unit,
        quantity, price_list_id, product_price_version_id, unit_price_source, unit_price_amount,
        gross_amount, per_item_discount_rate, per_item_discount_amount,
        net_before_general_discount_amount, allocated_general_discount_amount,
        net_after_discounts_amount, ipi_rate, ipi_basis_amount, ipi_amount,
        configured_tax_amount, freight_amount, line_total_amount, commission_source,
        commission_rate, commission_basis_amount, commission_amount,
        commission_industry_id, commission_provenance, created_at
      ) VALUES (
        ${created.id}, ${line.sourceQuoteLineId}, ${line.lineNumber}, ${line.product.id},
        ${line.product.industryId}, ${line.product.industryName},
        ${line.product.internalCode}, ${line.product.manufacturerCode}, ${line.product.description},
        ${line.product.brand}, ${line.product.category}, ${line.product.ncm}, ${line.product.cest},
        ${line.product.ean}, ${line.product.dun}, ${line.product.packaging}, ${line.product.unit},
        ${line.quantity}, ${line.unitPrice.priceListId}, ${line.unitPrice.productPriceVersionId},
        ${line.unitPrice.source}, ${line.unitPrice.amount}, ${line.grossAmount},
        ${line.perItemDiscountRate}, ${line.perItemDiscountAmount},
        ${line.netBeforeGeneralDiscountAmount}, ${line.allocatedGeneralDiscountAmount},
        ${line.netAfterDiscountsAmount}, ${line.ipiRate}, ${line.ipiBasisAmount}, ${line.ipiAmount},
        ${line.configuredTaxAmount}, ${line.freightAmount}, ${line.lineTotalAmount},
        ${line.commissionSource}, ${line.commissionRate}, ${line.commissionBasisAmount},
        ${line.commissionAmount}, ${facts.industryId}, ${facts.provenance}, ${clock.occurredAt}
      ) RETURNING id
    `
    if (!createdLine) throw new QuoteConversionError('SNAPSHOT_INTEGRITY_ERROR')
    for (const tax of line.configuredTaxes) {
      await tx`
        INSERT INTO order_line_taxes (order_line_id, code, rate, basis_amount, amount, created_at)
        VALUES (${createdLine.id}, ${tax.code}, ${tax.rate}, ${tax.basisAmount}, ${tax.amount}, ${clock.occurredAt})
      `
    }
  }
  await tx`
    INSERT INTO order_state_audit (
      order_id, from_status, to_status, actor, reason, occurred_at, version
    ) VALUES (
      ${created.id}, NULL, 'open', ${actorId}, 'Approved quote conversion', ${clock.occurredAt}, 1
    )
  `
  return Object.freeze({ ...created, version: BigInt(created.version) })
}

async function lockQuote(tx: Sql, quoteId: string): Promise<QuoteRow | null> {
  const rows = await tx<QuoteRow[]>`
    SELECT
      id,
      quote_number AS "quoteNumber",
      owner_user_id AS "ownerUserId",
      status,
      valid_until::text AS "validUntil",
      version,
      customer_snapshot AS "customerSnapshot",
      commercial_snapshot AS "commercialSnapshot"
    FROM quotes
    WHERE id = ${quoteId}
    FOR UPDATE
  `
  return rows[0] ?? null
}

function assertAuthorized(quote: QuoteRow, actor: QuoteActor): void {
  const allowed = actor.role === 'admin' || (actor.role === 'representative' && actor.id === quote.ownerUserId)
  if (!allowed) throw new QuoteConversionError('FORBIDDEN')
}

async function findCommand(tx: Sql, commandId: string): Promise<CommandRow | null> {
  const rows = await tx<CommandRow[]>`
    SELECT payload_hash AS "payloadHash", quote_id AS "quoteId", order_id AS "orderId"
    FROM quote_conversion_commands
    WHERE command_id = ${commandId}
  `
  return rows[0] ?? null
}

async function findOrder(tx: Sql, quoteId: string): Promise<PersistedOrder | null> {
  const rows = await tx<ExistingOrderRow[]>`
    SELECT id, source_quote_id AS "sourceQuoteId", number, status,
           version::text AS version, created_at AS "createdAt"
    FROM orders
    WHERE source_quote_id = ${quoteId}
  `
  const order = rows[0]
  return order
    ? Object.freeze({
        id: order.id,
        sourceQuoteId: order.sourceQuoteId,
        number: order.number,
        status: order.status,
        version: BigInt(order.version),
        createdAt: order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt),
      })
    : null
}

async function reserveCommand(
  tx: Sql,
  input: Readonly<{ commandId: string; payloadHash: string; quoteId: string }>,
): Promise<void> {
  await tx`
    INSERT INTO quote_conversion_commands (command_id, payload_hash, quote_id)
    VALUES (${input.commandId}, ${input.payloadHash}, ${input.quoteId})
    ON CONFLICT (command_id) DO NOTHING
  `
}

async function completeCommand(
  tx: Sql,
  input: Readonly<{ commandId: string; payloadHash: string; quoteId: string; orderId: string }>,
): Promise<void> {
  await tx`
    INSERT INTO quote_conversion_commands (
      command_id, payload_hash, quote_id, order_id, completed_at
    ) VALUES (
      ${input.commandId}, ${input.payloadHash}, ${input.quoteId}, ${input.orderId}, clock_timestamp()
    )
    ON CONFLICT (command_id) DO UPDATE
    SET order_id = EXCLUDED.order_id, completed_at = EXCLUDED.completed_at
    WHERE quote_conversion_commands.payload_hash = EXCLUDED.payload_hash
      AND quote_conversion_commands.quote_id = EXCLUDED.quote_id
  `
}

function parseOrderSnapshot(quote: QuoteRow): NewOrderSnapshot {
  if (!isCustomerSnapshot(quote.customerSnapshot) || !isConversionSnapshot(quote.commercialSnapshot)) {
    throw new QuoteConversionError('SNAPSHOT_INTEGRITY_ERROR')
  }
  return Object.freeze({
    sourceQuoteId: quote.id,
    sourceQuoteRevision: quote.commercialSnapshot.revision,
    client: quote.customerSnapshot,
    currencyCode: quote.commercialSnapshot.currencyCode,
    totals: quote.commercialSnapshot.totals,
    lines: quote.commercialSnapshot.lines,
  })
}

function isCustomerSnapshot(value: unknown): value is OrderClientSnapshot {
  if (!isRecord(value) || !isRecord(value.address)) return false
  return [value.id, value.legalName, value.taxIdentifier].every(isNonEmptyString)
    && [
      value.address.street,
      value.address.number,
      value.address.district,
      value.address.city,
      value.address.state,
      value.address.postalCode,
      value.address.countryCode,
    ].every(isNonEmptyString)
}

function isConversionSnapshot(value: unknown): value is QuoteConversionSnapshot {
  return isRecord(value)
    && Number.isInteger(value.revision)
    && Number(value.revision) > 0
    && isNonEmptyString(value.currencyCode)
    && isRecord(value.totals)
    && Array.isArray(value.lines)
    && value.lines.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hashPayload(input: Readonly<{ quoteId: string; actor: QuoteActor }>): string {
  return createHash('sha256')
    .update(JSON.stringify({ quoteId: input.quoteId, actorId: input.actor.id, actorRole: input.actor.role }))
    .digest('hex')
}
