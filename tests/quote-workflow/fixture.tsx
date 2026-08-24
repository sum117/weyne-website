import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { QuoteCatalogPicker } from '@/features/app/quotes/quote-catalog-picker'
import {
  QuoteLineItemEditor,
} from '@/features/app/quotes/quote-line-item-editor'
import {
  QuoteDataError,
  mergeSavedLineWithCurrentSource,
  type QuoteDataService,
  type QuotePricingModel,
  type CatalogSearchResponse,
  type CatalogProduct,
  type NewQuoteLineSnapshot,
  type QuoteLineWithCurrentSource,
} from '@/features/app/quotes/quote-data'
import '@/styles/app.css'

/**
 * Quote workflow fixture workspace over REAL backend boundaries.
 *
 * The workspace talks HTTP to tests/quote-workflow/api-server.ts, which
 * composes the production PostgreSQL-backed services. No quote behavior is
 * implemented here; this is only routing, state projection, and a thin fetch
 * adapter implementing the QuoteDataService port.
 */

const API = import.meta.env.VITE_WORKFLOW_API_URL
const PRICE_LIST_ID = '00000000-0000-4000-8000-000000000002'
const GENERAL_DISCOUNT_RATE = '7.5'
const FREIGHT_AMOUNT = '12.345'

type Actor = { id: string; role: 'admin' | 'representative' | 'read_only' }

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? 'POST' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? '{}' : JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ error: response.statusText })) as {
      error?: string
      code?: string
      currentVersion?: string
    }
    const message = detail.error ?? 'workflow request failed'
    if (detail.code === 'CONCURRENT_MODIFICATION') {
      throw new QuoteDataError({
        code: 'CONFLICT',
        status: response.status,
        message,
        currentVersion: detail.currentVersion,
      })
    }
    throw new Error(message)
  }
  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// QuoteDataService backed by the workflow API + PostgreSQL catalog tables
// ---------------------------------------------------------------------------

interface WorkflowState {
  id: string
  quoteNumber: string
  version: number
  status: string
  lines: Array<Record<string, string>>
}

/** Monotonic per-page counter for client-generated line identifiers. */
let nextLocalLineNumber = 1

function makeDataService(): QuoteDataService {
  return {
    async searchCatalog(request) {
      const rows = await api<{
        items: Array<{
          id: string
          internalCode: string
          description: string
          unit: string
          brand: string | null
          category: string | null
          amount: string | null
        }>
      }>('/api/catalog/search', { priceListId: request.priceListId })
      const items: CatalogProduct[] = rows.items.map((row) => ({
        id: row.id,
        internalCode: row.internalCode,
        manufacturerCode: null,
        description: row.description,
        unit: row.unit,
        industryId: '10000000-0000-4000-8000-000000000002',
        industryName: 'Indústria Workflow',
        brand: row.brand,
        category: row.category,
        thumbnailUrl: null,
        archived: false,
        selectedPrice:
          row.amount === null
            ? null
            : {
                productPriceId: `pp-${row.id}`,
                priceListId: request.priceListId,
                version: '1',
                amount: row.amount,
                currencyCode: 'BRL',
              },
      }))
      const response: CatalogSearchResponse = {
        items,
        facets: { industries: [], brands: [], categories: [] },
        pageInfo: { nextCursor: null, hasNextPage: false },
        selectedPriceList: {
          id: PRICE_LIST_ID,
          key: 'PRICE_2',
          displayName: 'Preço 2',
        },
        availablePriceLists: [
          { id: PRICE_LIST_ID, key: 'PRICE_2', displayName: 'Preço 2' },
        ],
        defaultPriceListId: PRICE_LIST_ID,
      }
      return response
    },

    async loadQuotePricing(quoteId) {
      const state = await api<WorkflowState>('/api/quote/state', { id: quoteId })
      const priceList = { id: PRICE_LIST_ID, key: 'PRICE_2' as const, displayName: 'Preço 2' }
      return {
        quoteId,
        version: String(state.version),
        selectedPriceList: priceList,
        lines: state.lines.map((line) => ({
          saved: {
            lineId: String(
              line.lineId ?? `local-${nextLocalLineNumber++}`,
            ),
            productId: String(line.productId ?? ''),
            descriptionSnapshot: String(line.description ?? ''),
            unitSnapshot: String(line.unit ?? 'UN'),
            quantitySnapshot: String(line.quantity ?? '0'),
            productPriceIdSnapshot: String(line.productPriceId ?? `pp-${line.productId}`),
            priceListIdSnapshot: String(line.priceListId ?? PRICE_LIST_ID),
            productPriceVersionSnapshot: String(line.productPriceVersion ?? '1'),
            unitPriceSnapshot: String(line.unitPrice ?? '0'),
            discountRateSnapshot: String(line.lineDiscountRate ?? '0'),
            taxSnapshots: [],
          },
          current: null,
        })),
      }
    },

    async recalculateQuote(input) {
      // The server prices from PostgreSQL and persists authoritative totals;
      // clientTotals are ignored by contract — a tampered value proves it.
      // The snapshot-lines table keys lines by UUID, so the fixture maps the
      // editor's per-page line ids to deterministic seeded line UUIDs (same
      // mapping as tests/integration/quote-pricing.test.ts).
      const result = await api<{
        id: string
        version: number
        totals: Record<string, string>
      }>('/api/quote/pricing', {
        quoteId: input.quoteId,
        expectedVersion: input.expectedVersion,
        customerId: '10000000-0000-4000-8000-000000000001',
        priceListId: input.selectedPriceListId,
        generalDiscountRate: input.generalDiscountRate,
        freightAmount: input.freightAmount,
        clientTotals: { grandTotalAmount: '999999.99' },
        lines: input.lines.map((line, index) => ({
          // Every pricing snapshot line is globally identified in PostgreSQL;
          // a later recalculation must never reuse an earlier snapshot's ID.
          lineId: crypto.randomUUID(),
          productId: window.__workflowLines?.[index] ?? '',
          quantity: line.quantity,
          lineDiscountRate: line.discountRate,
        })),
      })
      const totals = result.totals
      return {
        quoteId: input.quoteId,
        version: String(result.version),
        lines: input.lines.map((line) => ({ lineId: line.lineId, grossAmount: '0' })),
        totals: {
          subtotalAmount: String(totals.grossItemsAmount),
          discountAmount: String(totals.perItemDiscountAmount),
          taxAmount: String(totals.ipiAmount),
          freightAmount: String(totals.freightAmount),
          grandTotalAmount: String(totals.grandTotalAmount),
        },
      }
    },
  }
}

function lineFromSelection(snapshot: NewQuoteLineSnapshot): QuoteLineWithCurrentSource {
  const saved = {
    lineId: `workflow-line-${nextLocalLineNumber++}`,
    productId: snapshot.productId,
    descriptionSnapshot: snapshot.descriptionSnapshot,
    unitSnapshot: snapshot.unitSnapshot,
    quantitySnapshot: '1',
    productPriceIdSnapshot: snapshot.productPriceId,
    priceListIdSnapshot: snapshot.priceListId,
    productPriceVersionSnapshot: snapshot.productPriceVersion,
    unitPriceSnapshot: snapshot.unitPriceSnapshot,
    discountRateSnapshot: '0',
    taxSnapshots: [],
  }
  return {
    saved,
    current: {
      productId: snapshot.productId,
      description: snapshot.descriptionSnapshot,
      unit: snapshot.unitSnapshot,
      archived: false,
      price: {
        productPriceId: snapshot.productPriceId,
        priceListId: snapshot.priceListId,
        version: snapshot.productPriceVersion,
        amount: snapshot.unitPriceSnapshot,
        currencyCode: snapshot.currencyCode,
      },
    },
    sourceStatus: 'current',
    changes: [],
    eligibleForNewSelection: true,
  }
}

declare global {
  interface Window {
    __workflowLines?: string[]
    __workflowQuoteId?: string
    __workspace: WorkflowControls
  }
}

interface WorkflowControls {
  setActor(role: Actor['role'] | 'owner'): void
  getQuoteState(): Promise<WorkflowState | null>
  saveDraft(input: {
    quoteId: string
    expectedVersion: number
    commercialSnapshot: Record<string, unknown>
  }): Promise<WorkflowState>
  conflictProbe(quoteId: string): Promise<{ kind: string; message?: string }>
  transition(request: {
    quoteId: string
    command: string
    reason?: string
  }): Promise<Record<string, unknown>>
  duplicate(quoteId: string): Promise<Record<string, unknown>>
  captureSnapshot(quoteId: string): Promise<{ snapshotId: string; snapshotVersion: number }>
  generatePdf(
    identity: Record<string, unknown>,
    variant: string,
  ): Promise<Record<string, unknown>>
  deliverPdf(
    identity: Record<string, unknown>,
    actAs?: Actor,
  ): Promise<{ ok: boolean; bytes?: string; filename?: string; error?: string }>
  history(quoteId: string): Promise<Record<string, unknown>>
  auditEvents(): Promise<Array<Record<string, unknown>>>
}

const TENANT_ID = '00000000-0000-4000-8000-0000000000aa'
let currentActor: Actor = { id: 'representative-1', role: 'representative' }

// ---------------------------------------------------------------------------
// Workspace app: editor surface over the API + scripted controls for specs
// ---------------------------------------------------------------------------

function WorkspaceApp() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
    [],
  )
  const [actorTick, setActorTick] = useState(0)

  useEffect(() => {
    document.documentElement.setAttribute('data-workspace-ready', '')
    window.__workflowLines = []
    window.__workspace = {
      setActor(role) {
        const resolved: Actor =
          role === 'owner'
            ? { id: 'representative-1', role: 'representative' }
            : role === 'admin'
              ? { id: 'admin-1', role: 'admin' }
              : role === 'representative'
                ? { id: 'representative-9', role: 'representative' }
                : { id: 'auditor-1', role: 'read_only' }
        currentActor = resolved
        setActorTick((tick) => tick + 1)
      },
      async getQuoteState() {
        const quoteId = window.__workflowQuoteId
        if (!quoteId) return null
        return api<WorkflowState>('/api/quote/state', { id: quoteId })
      },
      async saveDraft(input) {
        return api<WorkflowState>('/api/quote/update-draft', {
          id: input.quoteId,
          expectedVersion: input.expectedVersion,
          commercialSnapshot: input.commercialSnapshot,
          actor: currentActor,
        })
      },
      async conflictProbe(quoteId) {
        try {
          const state = await window.__workspace.getQuoteState()
          if (!state) throw new Error('workflow quote is unavailable')
          // Use a version below the persisted one, regardless of how many
          // preceding workflow mutations have run.
          const staleVersion = Math.max(0, state.version - 1)
          await api('/api/quote/update-draft', {
            id: quoteId,
            expectedVersion: staleVersion,
            commercialSnapshot: {
              priceListKey: 'PRICE_2',
              generalDiscountRate: '99',
              freight: '999',
              lines: [
                {
                  productId: '10000000-0000-4000-8000-000000000003',
                  internalCode: 'QUOTE-A',
                  description: 'Produto sintético A',
                  unit: 'UN',
                  quantity: '999',
                  unitPrice: '10.005000',
                  lineDiscountRate: '0',
                },
              ],
              totals: {
                merchandiseGross: '9980.00',
                merchandiseNet: '9980.00',
                total: '9980.00',
              },
            },
            actor: { id: 'admin-1', role: 'admin' },
          })
          return { kind: 'unexpected-success' }
        } catch (error) {
          return { kind: 'conflict', message: (error as Error).message }
        }
      },
      async transition(request) {
        return api('/api/quote/transition', {
          quoteId: request.quoteId,
          command: request.command,
          reason: request.reason,
          actor: currentActor,
        })
      },
      async duplicate(quoteId) {
        return api('/api/quote/duplicate', {
          sourceQuoteId: quoteId,
          actor: currentActor,
        })
      },
      async captureSnapshot(quoteId) {
        return api('/api/quote/snapshot', { quoteId })
      },
      async generatePdf(identity, variant) {
        return api('/api/quote/pdf/generate', {
          identity,
          variant,
          actor: { ...currentActor, tenantId: TENANT_ID },
        })
      },
      async deliverPdf(identity, actAs) {
        const response = await fetch(`${API}/api/quote/pdf/deliver`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            identity,
            disposition: 'attachment',
            actor: { id: 'representative-1', role: 'representative', tenantId: TENANT_ID },
            ...(actAs ? { actAs } : {}),
          }),
        })
        if (!response.ok) {
          const detail = await response.json().catch(() => ({ error: 'delivery failed' }))
          return { ok: false, error: String((detail as { error?: string }).error) }
        }
        const contentDisposition = response.headers.get('content-disposition') ?? ''
        const encodedFilename = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
        const filename = encodedFilename
          ? decodeURIComponent(encodedFilename)
          : contentDisposition.match(/filename="([^"]+)"/)?.[1] ?? 'orcamento.pdf'
        const buffer = await response.arrayBuffer()
        let binary = ''
        const bytes = new Uint8Array(buffer)
        for (let index = 0; index < bytes.length; index += 1) {
          binary += String.fromCharCode(bytes[index]!)
        }
        return { ok: true, bytes: btoa(binary), filename }
      },
      async history(quoteId) {
        return api('/api/quote/history', { id: quoteId })
      },
      async auditEvents() {
        const response = await fetch(`${API}/api/audit/events`)
        if (!response.ok) throw new Error(`audit events request failed: ${response.status}`)
        return response.json() as Promise<Array<Record<string, unknown>>>
      },
    }
  }, [])

  void actorTick

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[96rem]">
          <header className="mb-6">
            <p className="text-xs font-semibold tracking-[0.16em] text-blue uppercase">
              Ambiente autenticado
            </p>
            <h1 className="mt-1 font-display text-4xl text-navy">
              Orçamentos — área de gestão
            </h1>
          </header>
          <EditorSurface />
        </div>
      </main>
    </QueryClientProvider>
  )
}

function EditorSurface() {
  const service = useMemo(makeDataService, [])
  const didInitializeQuote = useRef(false)
  const [model, setModel] = useState<QuotePricingModel | null>(null)
  const [totals, setTotals] = useState({
    subtotalAmount: '0.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    freightAmount: '0.00',
    grandTotalAmount: '0.00',
  })
  const [quoteId, setQuoteId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!quoteId) return
    const pricing = await service.loadQuotePricing(quoteId)
    setModel({
      quoteId: pricing.quoteId,
      version: pricing.version,
      selectedPriceList: pricing.selectedPriceList,
      lines: pricing.lines.map(({ saved, current }) =>
        mergeSavedLineWithCurrentSource(saved, current),
      ),
    })
  }, [quoteId, service])

  useEffect(() => {
    // React Strict Mode deliberately runs effects twice in development. Quote
    // initialization creates durable state, so a second run must not create a
    // competing quote or overwrite the page-global test handle mid-workflow.
    if (didInitializeQuote.current) return
    didInitializeQuote.current = true
    void (async () => {
      const existingQuoteId = new URLSearchParams(window.location.search).get('quoteId')
      if (existingQuoteId) {
        window.__workflowQuoteId = existingQuoteId
        setQuoteId(existingQuoteId)
        return
      }
      const created = await api<WorkflowState>('/api/quote/create')
      window.__workflowQuoteId = created.id
      setQuoteId(created.id)
    })()
  }, [])

  useEffect(() => {
    if (quoteId) void reload()
  }, [quoteId, reload])

  if (!model || !quoteId) {
    return <p aria-busy="true">Carregando orçamento…</p>
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2" data-testid="editor-surface">
      <section aria-label="Montagem do orçamento">
        <QuoteCatalogPicker
          service={service}
          defaultPriceListId={PRICE_LIST_ID}
          onSelect={(snapshot) => {
            window.__workflowLines = [...(window.__workflowLines ?? []), snapshot.productId]
            setModel((current) =>
              current === null
                ? current
                : { ...current, lines: [...current.lines, lineFromSelection(snapshot)] },
            )
          }}
        />
      </section>
      <div className="space-y-6">
        <QuoteLineItemEditor
          model={model}
          authoritativeTotals={totals}
          generalDiscountRate={GENERAL_DISCOUNT_RATE}
          freightAmount={FREIGHT_AMOUNT}
          onRecalculate={async (input) => {
            const result = await service.recalculateQuote(input)
            setTotals(result.totals)
            await reload()
            return result
          }}
          onUpdateSourcePrice={() => undefined}
          onDraftChange={() => undefined}
          onReloadConflict={() => void reload()}
        />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceApp />
  </StrictMode>,
)
