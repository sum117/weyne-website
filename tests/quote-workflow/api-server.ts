/**
 * Quote workflow API server (kanban t_391798ac).
 *
 * Composes the REAL production quote services — PostgreSQL persistence,
 * lifecycle, duplication, server pricing, and PDF delivery — and exposes them
 * to the browser fixture as plain JSON over HTTP. This is a test harness
 * boundary, not a mock: every handler delegates to the shipped service
 * modules exactly as production code would.
 *
 * Usage: WORKFLOW_DATABASE_URL=... bun tests/quote-workflow/api-server.ts --port 3197
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { isQuoteReadyToSend } from '../../src/lib/quotes/lifecycle.server'
import { createPostgresQuoteRepository } from '../../src/lib/quotes/quote-repository.server'
import { createQuoteLifecycleService } from '../../src/lib/quotes/lifecycle.server'
import { createPostgresQuoteLifecycleStore } from '../../src/lib/quotes/lifecycle-postgres.server'
import { persistServerPricedQuote } from '../../src/features/app/quotes/quote-pricing.server'
import {
  authorizeQuotePdfDownload,
  buildQuotePdfResponseHeaders,
  createQuotePdfFilename,
  createQuotePdfDeliveryService,
  QuotePdfDeliveryError,
  type QuotePdfAccessScope,
  type QuotePdfDeliveryActor,
  type QuotePdfDeliveryIdentity,
} from '../../src/lib/quotes/pdf-delivery.server'
import {
  createQuotePdfSnapshotChecksum,
  createQuotePdfArtifactService,
  type QuotePdfRenderResult,
} from '../../src/lib/quotes/pdf-artifacts.server'
import {
  createPostgresQuotePdfArtifactRepository,
  findQuotePdfArtifactByIdentity,
  loadPersistedQuotePdfSnapshot,
  loadQuotePdfScope,
} from '../../src/lib/quotes/pdf-artifact-postgres.server'
import { renderComercialQuotePdf, renderResumidaQuotePdf } from '../../src/lib/pdf'
import type { QuotePdfSnapshot } from '../../src/lib/pdf/types'
import * as databaseSchema from '../../src/lib/db/schema'
import * as expectations from './expectations'

const SCHEMA = 'quote_workflow_e2e'

const WORKFLOW_MIGRATIONS = [
  '0000_migration_smoke.sql',
  '0001_catalog_pricing.sql',
  '0002_quote_persistence.sql',
  '0003_server_quote_pricing.sql',
  '0004_order_persistence.sql',
  '0004_quote_lifecycle.sql',
  '0005_quote_to_order_conversion.sql',
  '0006_quote_pdf_artifacts.sql',
  '0090_order_security.sql',
] as const

function resolveDatabaseUrl(): string {
  const configured = process.env.WORKFLOW_DATABASE_URL?.trim()
  if (!configured) {
    throw new Error('WORKFLOW_DATABASE_URL is required for the workflow API server')
  }
  return configured
}

const sql = postgres(resolveDatabaseUrl(), {
  max: 8,
  onnotice: () => undefined,
})

const database = drizzle(sql, { schema: databaseSchema })

const repository = createPostgresQuoteRepository({ sql, schemaName: SCHEMA })
const lifecycle = createQuoteLifecycleService({
  store: createPostgresQuoteLifecycleStore({ sql, schemaName: SCHEMA }),
})

// ---------------------------------------------------------------------------
// PDF pipeline: artifact service + delivery service over real tables and a
// private in-process object store (the S3 stand-in; bytes never get a URL)
// ---------------------------------------------------------------------------

const pdfObjects = new Map<string, Uint8Array>()

const pdfStorage = {
  async putImmutable(input: {
    key: string
    bytes: Uint8Array
    checksum: string
  }) {
    const existing = pdfObjects.get(input.key)
    if (existing) {
      const same = existing.byteLength === input.bytes.byteLength
      return same
        ? { kind: 'existing' as const, checksum: input.checksum, sizeBytes: input.bytes.byteLength }
        : { kind: 'conflict' as const, checksum: input.checksum, sizeBytes: input.bytes.byteLength }
    }
    pdfObjects.set(input.key, input.bytes.slice())
    return { kind: 'created' as const, checksum: input.checksum, sizeBytes: input.bytes.byteLength }
  },
}

const pdfObjectReader = {
  async get(key: string) {
    const bytes = pdfObjects.get(key)
    return bytes ? new Uint8Array(bytes) : null
  },
}

const artifactRepository = createPostgresQuotePdfArtifactRepository({
  sql,
  schemaName: SCHEMA,
})

function countPages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString('latin1')
  return Math.max(1, [...text.matchAll(/\/Type\s*\/Page\b/g)].length)
}

const artifactService = createQuotePdfArtifactService({
  loadSnapshot: (input) => loadPersistedQuotePdfSnapshot(sql, SCHEMA, input),
  repository: artifactRepository,
  renderer: {
    async render(input): Promise<QuotePdfRenderResult> {
      const payload = input.snapshot.payload as { pdf?: QuotePdfSnapshot }
      if (!payload?.pdf) {
        throw new Error('snapshot payload does not contain a pdf document')
      }
      const bytes =
        input.template.variant === 'commercial'
          ? await renderComercialQuotePdf(payload.pdf)
          : await renderResumidaQuotePdf(payload.pdf)
      return { bytes, pageCount: countPages(bytes) }
    },
  },
  storage: pdfStorage,
})

const auditEvents: Array<Record<string, unknown>> = []

const deliveryService = createQuotePdfDeliveryService({
  loadQuoteScope: (quoteId) => loadQuotePdfScope(sql, SCHEMA, quoteId),
  repository: {
    findByIdentity: (identity) =>
      findQuotePdfArtifactByIdentity(sql, SCHEMA, identity),
  },
  storage: pdfObjectReader,
  audit: {
    async append(event) {
      auditEvents.push({ ...event, occurredAt: event.occurredAt.toISOString() })
    },
  },
  generate: (input) => artifactService.generate(input),
})

async function generateQuotePdf(
  actor: QuotePdfDeliveryActor,
  identity: { quoteId: string; snapshotId: string; snapshotVersion: number },
  variant: 'summary' | 'commercial',
): Promise<unknown> {
  const template = variant === 'commercial'
    ? {
        id: expectations.PDF_TEMPLATES.commercial.id,
        version: expectations.PDF_TEMPLATES.commercial.version,
        variant: 'commercial' as const,
      }
    : {
        id: expectations.PDF_TEMPLATES.summary.id,
        version: expectations.PDF_TEMPLATES.summary.version,
        variant: 'summary' as const,
      }

  const snapshot = await loadPersistedQuotePdfSnapshot(sql, SCHEMA, identity)
  if (!snapshot) throw new QuotePdfDeliveryError('NOT_FOUND')

  return deliveryService.generate({ actor, quoteId: identity.quoteId, snapshot, template })
}

// ---------------------------------------------------------------------------
// Deterministic seed helpers
// ---------------------------------------------------------------------------

async function resetSeed(): Promise<void> {
  // History tables are append-only by trigger; the cleanest reset is a schema
  // drop + re-apply of the same reviewed migrations the suite booted with.
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  await sql.unsafe(`CREATE SCHEMA "${SCHEMA}"`)
  await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
  for (const name of WORKFLOW_MIGRATIONS) {
    const script = await readFile(resolve(process.cwd(), 'drizzle', name), 'utf8')
    await sql.unsafe(script)
  }
  pdfObjects.clear()
  auditEvents.length = 0
}

async function ensureMasterData(): Promise<void> {
  await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
  await sql`SELECT set_config('app.actor', 'workflow-seed', false)`
  await sql`SELECT set_config('app.price_change_reason', 'deterministic workflow seed', false)`
  await sql`
    INSERT INTO customers (id, legal_name, tax_identifier)
    VALUES (${expectations.CUSTOMER_ID}, 'CLIENTE WORKFLOW LTDA.', 'WORKFLOW-CNPJ-0001')
    ON CONFLICT (id) DO NOTHING
  `
  await sql`
    INSERT INTO industries (id, legal_name)
    VALUES (${expectations.INDUSTRY_ID}, 'INDÚSTRIA WORKFLOW LTDA.')
    ON CONFLICT (id) DO NOTHING
  `
  const products = [
    { ...expectations.PRODUCTS.a, ipi: '5.125000', icms: '18.000000' },
    { ...expectations.PRODUCTS.b, ipi: '2.000000', icms: '12.000000' },
    { ...expectations.PRODUCTS.c, ipi: '0.000000', icms: null },
  ]
  for (const product of products) {
    await sql`
      INSERT INTO products (
        id, industry_id, internal_code, description, unit,
        ipi_rate, icms_rate, created_by, updated_by
      ) VALUES (
        ${product.id}, ${expectations.INDUSTRY_ID}, ${product.internalCode},
        ${product.description}, 'UN', ${product.ipi}, ${product.icms},
        'workflow-seed', 'workflow-seed'
      )
      ON CONFLICT (id) DO NOTHING
    `
    await sql`SELECT set_config('app.actor', 'workflow-seed', false)`
    await sql`SELECT set_config('app.price_change_reason', 'deterministic workflow seed', false)`
    await sql`
      INSERT INTO product_prices (product_id, price_list_id, amount, updated_by)
      VALUES (
        ${product.id},
        ${expectations.PRICE_LISTS.price2.id},
        ${expectations.SEEDED_PRICES.price2[product.id as keyof typeof expectations.SEEDED_PRICES.price2]},
        'workflow-seed'
      )
      ON CONFLICT (product_id, price_list_id) DO NOTHING
    `
  }
}

async function ensureScope(quoteId: string): Promise<void> {
  await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
  await sql`
    INSERT INTO commercial_resource_scopes (
      resource_type, resource_id, tenant_id, owner_user_id, resource_status
    ) VALUES (
      'quote', ${quoteId}::uuid,
      '00000000-0000-4000-8000-0000000000aa',
      'representative-1', 'draft'
    )
    ON CONFLICT (resource_type, resource_id) DO UPDATE
    SET resource_status = EXCLUDED.resource_status, updated_at = clock_timestamp()
  `
  await sql`
    INSERT INTO commercial_resource_assignments (resource_type, resource_id, user_id)
    VALUES ('quote', ${quoteId}::uuid, 'auditor-1')
    ON CONFLICT DO NOTHING
  `
}

/** Marks ready_to_send using the SAME pure gate the lifecycle service enforces. */
async function refreshReadyToSend(quoteId: string): Promise<boolean> {
  const quote = await repository.get(quoteId)
  if (!quote) throw new Error('QUOTE_NOT_FOUND')
  const ready = isQuoteReadyToSend(quote)
  await sql`
    UPDATE quotes SET ready_to_send = ${ready}
    WHERE id = ${quoteId}::uuid
  `
  return quote.status === 'draft' && ready
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

const PORT = Number(process.argv[process.argv.indexOf('--port') + 1] ?? 3197)
/** The Vite fixture workspace origin allowed to call this test boundary. */
const FIXTURE_ORIGIN = resolveFixtureOrigin()

function resolveFixtureOrigin(): string {
  const configured = process.env.WORKFLOW_FIXTURE_ORIGIN?.trim()
  if (!configured) {
    throw new Error('WORKFLOW_FIXTURE_ORIGIN is required for the workflow API server')
  }
  const url = new URL(configured)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/') {
    throw new Error('WORKFLOW_FIXTURE_ORIGIN must be an http://127.0.0.1:<port> origin')
  }
  return url.origin
}

function json(response: HttpServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': FIXTURE_ORIGIN,
    'access-control-allow-headers': 'content-type',
  })
  response.end(JSON.stringify(body))
}

async function readBody(request: HttpIncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

type Actor = { id: string; role: 'admin' | 'representative' | 'read_only' }
type HttpIncomingMessage = IncomingMessage
type HttpServerResponse = ServerResponse

const server = createServer((request, response) => {
  // The fixture workspace is a different origin; answer preflights directly.
  if (request.method === 'OPTIONS') {
    if (request.headers.origin !== FIXTURE_ORIGIN) {
      response.writeHead(403)
      response.end()
      return
    }
    response.writeHead(204, {
      'access-control-allow-origin': FIXTURE_ORIGIN,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    })
    response.end()
    return
  }
  void handle(request, response)
})

async function handle(
  request: HttpIncomingMessage,
  response: HttpServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  try {
    if (url.pathname === '/healthz') {
      await sql`SELECT 1`
      json(response, 200, { status: 'ok' })
      return
    }

    const body = request.method === 'POST' ? ((await readBody(request)) ?? {}) : {}
    const input = body as Record<string, unknown>

    if (url.pathname === '/api/seed/reset' && request.method === 'POST') {
      await resetSeed()
      await ensureMasterData()
      json(response, 200, { ok: true })
      return
    }

    if (url.pathname === '/api/catalog/search' && request.method === 'POST') {
      await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
      const priceListId = String(input.priceListId)
      const rows = await sql<{
        id: string
        internalCode: string
        description: string
        unit: string
        brand: string | null
        category: string | null
        amount: string | null
      }[]>`
        SELECT p.id::text AS id, p.internal_code AS "internalCode",
               p.description, p.unit, p.brand, p.category,
               pp.amount::text AS amount
        FROM products p
        LEFT JOIN product_prices pp
          ON pp.product_id = p.id AND pp.price_list_id = ${priceListId}::uuid
        WHERE p.archived_at IS NULL
        ORDER BY p.internal_code
      `
      json(response, 200, { items: rows })
      return
    }

    if (url.pathname === '/api/quote/state' && request.method === 'POST') {
      await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
      const quote = await repository.get(String(input.id))
      if (!quote) throw new Error('QUOTE_NOT_FOUND')
      const commercial = quote.commercialSnapshot as {
        lines?: Array<Record<string, string>>
      }
      json(response, 200, {
        id: quote.id,
        quoteNumber: quote.quoteNumber,
        version: quote.version,
        status: quote.status,
        lines: commercial.lines ?? [],
      })
      return
    }

    if (url.pathname === '/api/quote/create' && request.method === 'POST') {
      await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
      const created = await repository.create({
        ownerUserId: 'representative-1',
        validUntil: '2026-09-30',
        customerSnapshot: {
          id: expectations.CUSTOMER_ID,
          legalName: 'Cliente Workflow Ltda.',
          document: '00000000000191',
        },
        commercialSnapshot: {
          priceListKey: 'PRICE_2',
          generalDiscountRate: '0',
          freight: '0',
          lines: [],
          totals: { merchandiseGross: '0.00', merchandiseNet: '0.00', total: '0.00' },
        },
        actor: { id: 'representative-1', role: 'representative' },
        commandId: randomUUID(),
      })
      await ensureScope(created.id)
      json(response, 200, created)
      return
    }

    if (url.pathname === '/api/quote/get' && request.method === 'POST') {
      const quote = await repository.get(String(input.id))
      json(response, 200, quote)
      return
    }

    if (url.pathname === '/api/quote/update-draft' && request.method === 'POST') {
      await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
      const updated = await repository.updateDraft({
        quoteId: String(input.id),
        expectedVersion: Number(input.expectedVersion),
        commercialSnapshot: input.commercialSnapshot as never,
        actor: input.actor as Actor,
        commandId: randomUUID(),
      })
      await sql`
        UPDATE commercial_resource_scopes SET resource_status = 'draft', updated_at = clock_timestamp()
        WHERE resource_type = 'quote' AND resource_id = ${String(input.id)}::uuid
      `
      await refreshReadyToSend(String(input.id))
      json(response, 200, updated)
      return
    }

    if (url.pathname === '/api/quote/pricing' && request.method === 'POST') {
      await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
      const result = await persistServerPricedQuote(database, input as never)
      const quoteId = String(input.quoteId)
      const [header] = await sql<{
        grossItemsAmount: string
        perItemDiscountAmount: string
        netItemsAmount: string
        generalDiscountAmount: string
        netAfterDiscountsAmount: string
        ipiAmount: string
        configuredTaxAmount: string
        freightAmount: string
        grandTotalAmount: string
      }[]>`
        SELECT gross_items_amount::text AS "grossItemsAmount",
          line_discount_amount::text AS "perItemDiscountAmount",
          net_items_amount::text AS "netItemsAmount",
          general_discount_amount::text AS "generalDiscountAmount",
          net_merchandise_amount::text AS "netAfterDiscountsAmount",
          ipi_amount::text AS "ipiAmount", configured_tax_amount::text AS "configuredTaxAmount",
          freight_amount::text AS "freightAmount", grand_total_amount::text AS "grandTotalAmount"
        FROM quote_pricing_snapshots WHERE id = ${result.id}::uuid
      `
      const lines = await sql<{
        productId: string
        internalCode: string
        description: string
        unit: string
        quantity: string
        unitPrice: string
        lineDiscountRate: string
        gross: string
        lineDiscount: string
        generalDiscount: string
        merchandise: string
        ipi: string
        configuredTaxes: unknown
        configuredTaxAmount: string
      }[]>`
        SELECT line.product_id::text AS "productId", product.internal_code AS "internalCode",
          product.description, product.unit, line.quantity::text AS quantity,
          line.unit_price::text AS "unitPrice", line.line_discount_rate::text AS "lineDiscountRate",
          line.gross_amount::text AS gross, line.line_discount_amount::text AS "lineDiscount",
          line.general_discount_amount::text AS "generalDiscount",
          line.net_merchandise_amount::text AS merchandise, line.ipi_amount::text AS ipi,
          line.configured_taxes AS "configuredTaxes", line.configured_tax_amount::text AS "configuredTaxAmount"
        FROM quote_pricing_snapshot_lines line
        JOIN products product ON product.id = line.product_id
        WHERE line.quote_pricing_snapshot_id = ${result.id}::uuid
        ORDER BY line.line_id
      `
      const updated = await repository.updateDraft({
        quoteId,
        expectedVersion: Number(input.expectedVersion),
        commercialSnapshot: {
          priceListKey: 'PRICE_2',
          generalDiscountRate: String(input.generalDiscountRate),
          freight: String(input.freightAmount),
          lines: lines.map((line) => ({ ...line, configuredTaxes: JSON.stringify(line.configuredTaxes) })),
          totals: header!,
        },
        actor: { id: 'representative-1', role: 'representative' },
        commandId: randomUUID(),
      })
      await refreshReadyToSend(quoteId)
      json(response, 200, { ...result, version: updated.version })
      return
    }

    if (url.pathname === '/api/quote/transition' && request.method === 'POST') {
      const result = await lifecycle.transition({
        quoteId: String(input.quoteId),
        command: input.command as Parameters<typeof lifecycle.transition>[0]['command'],
        actor: input.actor as Parameters<typeof lifecycle.transition>[0]['actor'],
        idempotencyKey:
          (input.idempotencyKey as string | undefined)?.trim() || randomUUID(),
        reason: input.reason as string | undefined,
      })
      await sql`
        UPDATE commercial_resource_scopes SET resource_status = ${result.quote.status},
          updated_at = clock_timestamp()
        WHERE resource_type = 'quote' AND resource_id = ${String(input.quoteId)}::uuid
      `
      json(response, 200, result)
      return
    }

    if (url.pathname === '/api/quote/history' && request.method === 'POST') {
      await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
      const quoteId = String(input.id)
      const transitions = await sql<{
        actorId: string
        actorRole: string
        toStatus: string
      }[]>`
        SELECT actor_id AS "actorId", actor_role AS "actorRole", to_status AS "toStatus"
        FROM quote_transition_history
        WHERE quote_id = ${quoteId}::uuid
        ORDER BY occurred_at
      `
      json(response, 200, {
        versions: await repository.listVersions(quoteId),
        audit: [
          ...(await repository.listAudit(quoteId)),
          ...transitions.map((transition) => ({
            actorId: transition.actorId,
            actorRole: transition.actorRole,
            operation: 'transition',
            version: 0,
            beforeState: { status: 'previous' },
            afterState: { status: transition.toStatus },
          })),
        ],
      })
      return
    }

    if (url.pathname === '/api/quote/duplicate' && request.method === 'POST') {
      await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
      const source = await repository.get(String(input.sourceQuoteId))
      if (!source) throw new Error('QUOTE_NOT_FOUND')
      const duplicate = await repository.duplicate({
        sourceQuoteId: source.id,
        validUntil: source.validUntil,
        actor: input.actor as Actor,
        commandId: randomUUID(),
      })
      await ensureScope(duplicate.id)
      json(response, 200, duplicate)
      return
    }

    if (url.pathname === '/api/quote/snapshot' && request.method === 'POST') {
      // Captures an immutable PDF snapshot for the current quote version from
      // the committed commercial snapshot — the same data a production
      // snapshot capture would freeze.
      const snapshot = await capturePdfSnapshot(String(input.quoteId))
      json(response, 200, snapshot)
      return
    }

    if (url.pathname === '/api/quote/pdf/generate' && request.method === 'POST') {
      const view = await generateQuotePdf(
        input.actor as QuotePdfDeliveryActor,
        input.identity as { quoteId: string; snapshotId: string; snapshotVersion: number },
        (input.variant as 'summary' | 'commercial') ?? 'commercial',
      )
      json(response, 200, view)
      return
    }

    if (url.pathname === '/api/quote/pdf/status' && request.method === 'POST') {
      const view = await deliveryService.status({
        actor: input.actor as QuotePdfDeliveryActor,
        identity: input.identity as never,
      })
      json(response, 200, view)
      return
    }

    if (url.pathname === '/api/quote/pdf/deliver' && request.method === 'POST') {
      await deliverQuotePdf(
        input as {
          actor: QuotePdfDeliveryActor
          identity: QuotePdfDeliveryIdentity
          disposition: 'inline' | 'attachment'
          actAs?: Actor
        },
        response,
      )
      return
    }

    if (url.pathname === '/api/audit/events' && request.method === 'GET') {
      json(response, 200, auditEvents)
      return
    }

    json(response, 404, { error: `no route for ${request.method} ${url.pathname}` })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const code = (error as { code?: string }).code
    json(response, 500, { error: detail, code })
  }
}

async function deliverQuotePdf(
  input: {
    actor: QuotePdfDeliveryActor
    identity: QuotePdfDeliveryIdentity
    disposition: 'inline' | 'attachment'
    /** Test-only scope override used by denial probes against real services. */
    actAs?: Actor
  },
  response: HttpServerResponse,
): Promise<void> {
  const actingActor: QuotePdfDeliveryActor =
    input.actAs ? { ...input.actor, id: input.actAs.id, role: input.actAs.role } : input.actor
  const scope: (QuotePdfAccessScope & { quoteNumber: string }) | null =
    await loadQuotePdfScope(sql, SCHEMA, input.identity.quoteId)
  if (!scope) throw new QuotePdfDeliveryError('NOT_FOUND')
  const authorization = authorizeQuotePdfDownload(actingActor, scope)
  if (authorization !== 'allow') {
    throw new QuotePdfDeliveryError('FORBIDDEN')
  }
  const artifact = await findQuotePdfArtifactByIdentity(sql, SCHEMA, input.identity)
  if (!artifact) throw new QuotePdfDeliveryError('NOT_FOUND')
  if (artifact.status !== 'completed' || !artifact.objectKey) {
    throw new QuotePdfDeliveryError('ARTIFACT_NOT_COMPLETED')
  }
  const bytes = await pdfObjectReader.get(artifact.objectKey)
  if (!bytes) throw new QuotePdfDeliveryError('STORAGE_UNAVAILABLE')

  const filename = createQuotePdfFilename({
    quoteNumber: scope.quoteNumber,
    snapshotVersion: artifact.snapshotVersion,
    variant: artifact.templateVariant,
  })
  const headers = buildQuotePdfResponseHeaders({
    filename,
    disposition: input.disposition,
    sizeBytes: bytes.byteLength,
  })
  auditEvents.push({
    action: 'quote.pdf.download',
    actorId: actingActor.id,
    quoteId: artifact.quoteId,
    artifactId: artifact.id,
    snapshotVersion: artifact.snapshotVersion,
    templateVariant: artifact.templateVariant,
    occurredAt: new Date().toISOString(),
    outcome: input.disposition,
  })
  response.writeHead(200, {
    ...headers,
    'access-control-allow-origin': FIXTURE_ORIGIN,
    'access-control-expose-headers': 'content-disposition',
  })
  response.end(Buffer.from(bytes))
}

/** Builds and persists an immutable PDF snapshot for the quote's latest version. */
async function capturePdfSnapshot(quoteId: string) {
  await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
  const quote = await repository.get(quoteId)
  if (!quote) throw new Error('QUOTE_NOT_FOUND')

  const commercial = quote.commercialSnapshot as {
    lines?: Array<{
      lineId?: string
      internalCode?: string
      description?: string
      unit?: string
      quantity?: string
      unitPrice?: string
      lineDiscountRate?: string
      gross?: string
      lineDiscount?: string
      generalDiscount?: string
      merchandise?: string
      ipi?: string
    }>
    totals?: Record<string, string>
  }

  const lines = (commercial.lines ?? []).map((line, index) => ({
    lineId: line.lineId ?? `line-${index + 1}`,
    position: index + 1,
    internalCode: line.internalCode ?? '',
    manufacturerCode: null,
    description: line.description ?? '',
    brand: null,
    unit: line.unit ?? 'UN',
    packaging: null,
    quantity: line.quantity ?? '0',
    unitPriceAmount: line.unitPrice ?? '0',
    grossAmount: line.gross ?? '0.00',
    lineDiscountRate: line.lineDiscountRate ?? '0',
    lineDiscountAmount: line.lineDiscount ?? '0.00',
    overallDiscountAllocationAmount: line.generalDiscount ?? '0.00',
    netMerchandiseAmount: line.merchandise ?? '0.00',
    taxLines: [
      {
        code: 'ipi',
        label: 'IPI',
        rate: '5.125000',
        basisAmount: line.merchandise ?? '0.00',
        amount: line.ipi ?? '0.00',
        includedInGrandTotal: true,
      },
    ],
    lineTotalAmount: line.merchandise ?? '0.00',
    image: null,
  }))

  const totals = commercial.totals ?? {}
  const snapshotPayload = {
    pdf: {
      document: {
        quoteId,
        quoteNumber: quote.quoteNumber,
        revision: quote.version,
        statusLabel:
          quote.status === 'draft'
            ? 'Rascunho'
            : quote.status === 'sent'
              ? 'Enviado'
              : quote.status === 'approved'
                ? 'Aprovado'
                : quote.status,
        issuedOn: '2026-08-21' as const,
        validUntil: quote.validUntil as `${number}-${number}-${number}`,
        currencyCode: 'BRL',
      },
      client: {
        legalName: 'Cliente Workflow Ltda.',
        tradeName: null,
        taxId: '00.000.000/0001-91',
        stateRegistration: null,
        contactName: null,
        email: null,
        phone: null,
        addressLines: ['Avenida Workflow, 100 — Recife/PE'],
      },
      representative: {
        name: 'Carolina Weyne',
        role: 'Representação comercial',
        email: null,
        phone: null,
      },
      industry: null,
      terms: {
        validityLabel: 'Proposta válida por 15 dias corridos',
        paymentTerms: '28 dias',
        freightTerms: 'CIF — incluso no total informado',
        carrierName: null,
        deliveryEstimate: null,
      },
      items: lines,
      totals: {
        grossItemsAmount: totals.grossItemsAmount ?? totals.merchandiseGross ?? '0.00',
        lineDiscountAmount: totals.perItemDiscountAmount ?? '0.00',
        netAfterLineDiscountAmount: totals.netItemsAmount ?? totals.merchandiseNet ?? '0.00',
        overallDiscountAmount: totals.generalDiscountAmount ?? '0.00',
        netMerchandiseAmount: totals.netAfterDiscountsAmount ?? totals.merchandiseNet ?? '0.00',
        taxTotals: [
          {
            code: 'ipi',
            label: 'IPI',
            basisAmount: totals.netAfterDiscountsAmount ?? '0.00',
            amount: totals.ipiAmount ?? '0.00',
            includedInGrandTotal: true,
          },
        ],
        freightAmount: totals.freightAmount ?? '0.00',
        grandTotalAmount: totals.grandTotalAmount ?? totals.total ?? '0.00',
      },
      notes: 'Documento gerado pelo fluxo de aceitação do orçamento.',
      signatures: [
        { label: 'Representante', name: 'Carolina Weyne', role: 'Representação comercial' },
        { label: 'Aceite do cliente', name: null, role: null },
      ],
      branding: {
        companyName: 'Weyne Representações',
        companyLogo: null,
        industryLogo: null,
      },
    } satisfies QuotePdfSnapshot,
  }

  const existing = await sql<{ version: number }[]>`
    SELECT version FROM quote_snapshots
    WHERE quote_id = ${quoteId}::uuid ORDER BY version DESC LIMIT 1
  `
  const version = (existing[0]?.version ?? 0) + 1
  const snapshotId = randomUUID()
  const sourceChecksum = createQuotePdfSnapshotChecksum({
    id: snapshotId,
    version,
    payload: snapshotPayload,
    images: [],
  })
  await sql`
    INSERT INTO quote_snapshots (id, quote_id, version, payload, source_checksum, captured_by)
    VALUES (
      ${snapshotId}::uuid, ${quoteId}::uuid, ${version},
      ${JSON.stringify(snapshotPayload)}::text::jsonb, ${sourceChecksum}, 'workflow-suite'
    )
  `
  return { snapshotId, snapshotVersion: version }
}

// Each Playwright invocation owns a disposable database. Reset and seed it
// before publishing the health endpoint so browser requests always observe
// the deterministic catalog rather than an empty migrated schema.
await resetSeed()
await ensureMasterData()

server.listen(PORT, '127.0.0.1', () => {
  console.log(`workflow api on http://127.0.0.1:${PORT}`)
})
