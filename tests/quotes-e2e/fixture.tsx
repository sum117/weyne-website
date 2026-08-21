import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { QuoteListView } from '@/features/app/quotes/quote-list'
import { QuoteDetailView } from '@/features/app/quotes/quote-detail'
import type {
  QuoteDetail,
  QuoteDetailLifecycleProps,
} from '@/features/app/quotes/quote-detail'
import type {
  QuoteDuplicationMutationResult,
  QuoteLifecycleCommandRequest,
  QuoteLifecycleMutationResult,
} from '@/features/app/quotes/quote-lifecycle'
import type { QuoteListItem } from '@/features/app/quotes/quote-list'
import {
  createQuoteLifecycleService,
  createInMemoryQuoteLifecycleStore,
  getEffectiveQuoteStatus,
  toQuoteListReadModel,
  QuoteLifecycleError,
  type QuoteLifecycleActor,
  type QuoteLifecycleRecord,
} from '@/lib/quotes/lifecycle.server'
import {
  createQuoteDuplicationService,
  createInMemoryQuoteDuplicationStore,
  QuoteDuplicationError,
  type DuplicableQuote,
} from '@/lib/quotes/duplication.server'
import '@/styles/app.css'

/**
 * Deterministic quote workspace for browser lifecycle coverage.
 *
 * The REAL production services run here (createQuoteLifecycleService +
 * createQuoteDuplicationService over their in-memory stores), so transitions,
 * authorization, reason rules, idempotency, and duplication semantics are the
 * shipped code paths. Persistence is sessionStorage-backed and rehydrated on
 * load, so "reload the page" is a real persistence check. A scripted
 * "second session" (window.quotesFixture) lets tests make the kind of
 * concurrent change another user's session would make.
 */

const BUSINESS_TODAY = '2026-08-17'
const ACTOR_ID = 'representative-1'

const actor: QuoteLifecycleActor = {
  id: ACTOR_ID,
  role: 'representative',
  permissions: [
    'quotes:send:own',
    'quotes:update:own',
    'quotes:decide:own',
    'quotes:cancel:own',
    'quotes:duplicate:own',
  ],
}

const readOnlyActor: QuoteLifecycleActor = {
  id: 'auditor-1',
  role: 'read_only',
  permissions: [],
}

interface StoredQuote {
  record: QuoteLifecycleRecord
  readonly number: string
  readonly customerName: string
}

interface FixtureState {
  quotes: StoredQuote[]
  history: Array<{
    id: string
    quoteId: string
    actorId: string
    actorRole: string
    occurredAt: string
    fromStatus: string
    toStatus: string
    reason: string | null
    command: string
  }>
  duplicates: Array<{
    id: string
    number: string
    sourceQuoteId: string
    lines: Array<{ id: string; description: string; quantity: string }>
  }>
  duplicateEvents: Array<{ id: string; sourceQuoteId: string; idempotencyKey: string }>
  duplicateKeys: string[]
  transitionKeys: string[]
}

const STORAGE_KEY = 'weyne-quote-fixture-v1'

/** Seeded history events that predate the lifecycle store (quote-37/33 sends). */
const SEED_HISTORY_EVENTS: FixtureState['history'] = [
  {
    id: 'event-seed-1',
    quoteId: 'quote-37',
    actorId: ACTOR_ID,
    actorRole: 'representative',
    occurredAt: '2026-08-15T13:00:00.000Z',
    fromStatus: 'draft',
    toStatus: 'sent',
    reason: null,
    command: 'sendQuote',
  },
  {
    id: 'event-seed-2',
    quoteId: 'quote-33',
    actorId: ACTOR_ID,
    actorRole: 'representative',
    occurredAt: '2026-08-14T13:00:00.000Z',
    fromStatus: 'draft',
    toStatus: 'sent',
    reason: null,
    command: 'sendQuote',
  },
]

function seedState(): FixtureState {
  return {
    quotes: [
      {
        number: 'ORC-2026-000041',
        customerName: 'Mercado São José',
        record: {
          id: 'quote-41',
          ownerUserId: ACTOR_ID,
          status: 'draft',
          validUntil: '2026-08-30',
          version: 3,
          revision: 0,
          readyToSend: true,
          customerSnapshot: { id: 'customer-1', legalName: 'Mercado São José' },
          commercialSnapshot: {
            priceListKey: 'PRICE_1',
            generalDiscountRate: '0',
            freight: '0',
            lines: [
              {
                productId: 'product-1',
                internalCode: 'DET-005',
                description: 'Detergente profissional 5 L',
                unit: 'UN',
                quantity: '10.000',
                unitPrice: '42.0000',
                lineDiscountRate: '0',
              },
            ],
            totals: {
              merchandiseGross: '420.00',
              merchandiseNet: '420.00',
              total: '420.00',
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
        },
      },
      {
        number: 'ORC-2026-000037',
        customerName: 'Hotel Horizonte',
        record: {
          id: 'quote-37',
          ownerUserId: ACTOR_ID,
          status: 'sent',
          validUntil: '2026-08-25',
          version: 2,
          revision: 1,
          readyToSend: true,
          customerSnapshot: { id: 'customer-2', legalName: 'Hotel Horizonte' },
          commercialSnapshot: {
            priceListKey: 'PRICE_1',
            generalDiscountRate: '0',
            freight: '0',
            lines: [
              {
                productId: 'product-2',
                internalCode: 'PAP-204',
                description: 'Papel toalha interfolhado premium',
                unit: 'CX',
                quantity: '20.000',
                unitPrice: '68.0000',
                lineDiscountRate: '0',
              },
            ],
            totals: {
              merchandiseGross: '1360.00',
              merchandiseNet: '1360.00',
              total: '1360.00',
            },
          },
          sentAt: new Date('2026-08-15T13:00:00.000Z'),
          approvedAt: null,
          approvedBy: null,
          rejectedAt: null,
          rejectedBy: null,
          rejectedReason: null,
          expiredAt: null,
          cancelledAt: null,
          cancelledBy: null,
          cancelledReason: null,
        },
      },
      {
        number: 'ORC-2026-000033',
        customerName: 'Clínica Bem Estar',
        record: {
          id: 'quote-33',
          ownerUserId: ACTOR_ID,
          status: 'sent',
          validUntil: '2026-08-25',
          version: 2,
          revision: 1,
          readyToSend: true,
          customerSnapshot: { id: 'customer-3', legalName: 'Clínica Bem Estar' },
          commercialSnapshot: {
            priceListKey: 'PRICE_1',
            generalDiscountRate: '0',
            freight: '0',
            lines: [
              {
                productId: 'product-3',
                internalCode: 'ALC-070',
                description: 'Álcool antisséptico 70%',
                unit: 'UN',
                quantity: '30.000',
                unitPrice: '12.5000',
                lineDiscountRate: '0',
              },
            ],
            totals: {
              merchandiseGross: '375.00',
              merchandiseNet: '375.00',
              total: '375.00',
            },
          },
          sentAt: new Date('2026-08-14T13:00:00.000Z'),
          approvedAt: null,
          approvedBy: null,
          rejectedAt: null,
          rejectedBy: null,
          rejectedReason: null,
          expiredAt: null,
          cancelledAt: null,
          cancelledBy: null,
          cancelledReason: null,
        },
      },
    ],
    history: SEED_HISTORY_EVENTS.map((event) => ({ ...event })),
    duplicates: [],
    duplicateEvents: [],
    duplicateKeys: [],
    transitionKeys: [],
  }
}

function loadState(): FixtureState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as FixtureState
  } catch {
    // fall through to seed on any storage failure
  }
  const seeded = seedState()
  saveState(seeded)
  return seeded
}

function saveState(state: FixtureState) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function resetState() {
  window.sessionStorage.removeItem(STORAGE_KEY)
}

// ---------------------------------------------------------------------------
// Workspace store: in-memory stores hydrated from the persisted fixture state,
// flushed back after every committed transaction.
// ---------------------------------------------------------------------------

function statusLabel(code: string): string {
  const labels: Record<string, string> = {
    draft: 'Rascunho',
    sent: 'Enviado',
    approved: 'Aprovado',
    rejected: 'Rejeitado',
    expired: 'Expirado',
    converted: 'Convertido',
    cancelled: 'Cancelado',
  }
  return labels[code] ?? code
}

function createWorkspace(state: FixtureState) {
  const lifecycleStore = createInMemoryQuoteLifecycleStore({
    quotes: state.quotes.map((entry) => entry.record),
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  })
  const lifecycle = createQuoteLifecycleService({
    store: lifecycleStore,
    businessDate: () => BUSINESS_TODAY,
  })

  const duplicableQuotes: DuplicableQuote[] = state.quotes.map((entry) => ({
    id: entry.record.id,
    number: entry.number,
    status: entry.record.status,
    ownerUserId: entry.record.ownerUserId,
    customer: { id: 'customer-x', active: true, legalName: entry.customerName },
    priceList: {
      id: 'price-list-1',
      active: true,
      key: 'PRICE_1',
      name: 'Preço 1',
    },
    validUntil: entry.record.validUntil,
    paymentTerms: '28 dias',
    notes: null,
    lifecycle: {},
    storageReferences: [],
    lines: [
      {
        id: `line-${entry.record.id}`,
        productId: 'product-1',
        position: 1,
        quantity: '10.000',
        discount: null,
        snapshot: {
          productCode: 'DET-005',
          description: 'Detergente profissional 5 L',
          unit: 'UN',
          industry: { id: 'industry-1', name: 'Total Clean' },
          price: {
            productPriceId: 'pp-1',
            unitPrice: '42.00',
            currencyCode: 'BRL',
          },
        },
        storageReferences: [],
      },
    ],
  }))
  const duplicationStore = createInMemoryQuoteDuplicationStore({
    quotes: duplicableQuotes,
    firstSequence: 43,
  })
  const duplication = createQuoteDuplicationService({
    store: duplicationStore,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
    refreshLine: async (line) => structuredClone(line.snapshot),
  })

  function flush() {
    const snapshot = lifecycleStore.snapshot()
    // Seeded history predates the store; store events are appended after it.
    state.history = [
      ...SEED_HISTORY_EVENTS,
      ...snapshot.history.map((event) => ({
        id: event.id,
        quoteId: event.quoteId,
        actorId: event.actorId,
        actorRole: event.actorRole,
        occurredAt: event.occurredAt.toISOString(),
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        reason: event.reason,
        command: event.command,
      })),
    ]
    state.transitionKeys = snapshot.commands.map(
      (command) => `${command.command}:${command.idempotencyKey}`,
    )

    const duplicationSnapshot = duplicationStore.snapshot()
    state.duplicates = duplicationSnapshot.quotes
      .filter((quote) => quote.duplicatedFromQuoteId)
      .map((quote) => ({
        id: quote.id,
        number: quote.number,
        sourceQuoteId: quote.duplicatedFromQuoteId!,
        lines: quote.lines.map((line) => ({
          id: line.id,
          description: line.snapshot.description,
          quantity: line.quantity,
        })),
      }))
    state.duplicateEvents = duplicationSnapshot.events.map((event) => ({
      id: event.id,
      sourceQuoteId: event.sourceQuoteId,
      idempotencyKey: event.idempotencyKey,
    }))
    state.duplicateKeys = duplicationSnapshot.commands.map(
      (command) => command.idempotencyKey,
    )
    for (const updated of snapshot.quotes) {
      const stored = state.quotes.find((entry) => entry.record.id === updated.id)
      if (stored) stored.record = updated
    }
    saveState(state)
  }

  return { lifecycle, duplication, flush }
}

let state = loadState()
let workspace = createWorkspace(state)

function errorKind(error: unknown): QuoteLifecycleMutationResult['kind'] {
  if (
    error instanceof QuoteLifecycleError ||
    error instanceof QuoteDuplicationError
  ) {
    switch (error.code) {
      case 'FORBIDDEN':
        return 'denied'
      case 'INVALID_STATE_TRANSITION':
        return 'illegal-state'
      case 'CONCURRENT_MODIFICATION':
        return 'stale'
      default:
        return 'failed'
    }
  }
  return 'failed'
}

const DENIAL_MESSAGE = 'Seu perfil não tem permissão para esta ação.'

async function transition(
  request: QuoteLifecycleCommandRequest,
): Promise<QuoteLifecycleMutationResult> {
  const actingAs =
    (window as unknown as { __fixtureActor?: QuoteLifecycleActor }).__fixtureActor ??
    actor
  try {
    const result = await workspace.lifecycle.transition({
      quoteId: request.quoteId,
      command: request.command,
      actor: actingAs,
      idempotencyKey: request.idempotencyKey,
      reason: request.reason,
    })
    workspace.flush()
    return {
      kind: 'success',
      quote: {
        id: result.quote.id,
        status: {
          code: getEffectiveQuoteStatus(result.quote, BUSINESS_TODAY),
          label: statusLabel(result.quote.status),
        },
        version: String(result.quote.version),
      },
      history: {
        id: result.history.id,
        actor: {
          id: result.history.actorId,
          name: result.history.actorId === ACTOR_ID ? 'Marina Lima' : null,
          role: result.history.actorRole,
        },
        occurredAt: result.history.occurredAt.toISOString(),
        fromStatus: {
          code: result.history.fromStatus,
          label: statusLabel(result.history.fromStatus),
        },
        toStatus: {
          code: result.history.toStatus,
          label: statusLabel(result.history.toStatus),
        },
        reason: result.history.reason,
        command: result.history.command as 'sendQuote',
      },
    }
  } catch (error) {
    if (error instanceof QuoteLifecycleError && error.code === 'FORBIDDEN') {
      return { kind: 'denied', message: DENIAL_MESSAGE }
    }
    return {
      kind: errorKind(error),
      message:
        error instanceof Error && error.message !== error.name
          ? error.message
          : 'Não foi possível concluir a ação. Tente novamente.',
    } as QuoteLifecycleMutationResult
  }
}

async function duplicate(request: {
  sourceQuoteId: string
  idempotencyKey: string
}): Promise<QuoteDuplicationMutationResult> {
  const actingAs =
    (window as unknown as { __fixtureActor?: QuoteLifecycleActor }).__fixtureActor ??
    actor
  try {
    const result = await workspace.duplication.duplicate({
      sourceQuoteId: request.sourceQuoteId,
      actor: actingAs,
      idempotencyKey: request.idempotencyKey,
    })
    workspace.flush()
    return {
      kind: 'success',
      quote: { id: result.quote.id, number: result.quote.number },
    }
  } catch (error) {
    if (error instanceof QuoteDuplicationError && error.code === 'FORBIDDEN') {
      return { kind: 'denied', message: DENIAL_MESSAGE }
    }
    return {
      kind: errorKind(error),
      message:
        error instanceof Error && error.message !== error.name
          ? error.message
          : 'Não foi possível concluir a ação. Tente novamente.',
    } as QuoteDuplicationMutationResult
  }
}

function listItems(): QuoteListItem[] {
  return state.quotes.map((entry) => {
    const model = toQuoteListReadModel(entry.record, BUSINESS_TODAY)
    return {
      id: entry.record.id,
      number: entry.number,
      customerName: entry.customerName,
      status: { code: model.status, label: statusLabel(model.status) },
      version: String(model.version),
      allowedActions: allowedActionsFor(entry),
      canDuplicate: canDuplicateFor(entry),
    }
  })
}

function allowedActionsFor(entry: StoredQuote): QuoteListItem['allowedActions'] {
  const effective = getEffectiveQuoteStatus(entry.record, BUSINESS_TODAY)
  const actions: string[] = []
  if (effective === 'draft') actions.push('sendQuote')
  if (effective === 'sent') {
    actions.push('approveQuote', 'rejectQuote', 'reopenQuote', 'cancelQuote')
  }
  if (effective === 'approved') actions.push('cancelQuote')
  return actions as QuoteListItem['allowedActions']
}

function canDuplicateFor(entry: StoredQuote): boolean {
  const effective = getEffectiveQuoteStatus(entry.record, BUSINESS_TODAY)
  return ['draft', 'sent', 'approved', 'rejected', 'expired'].includes(effective)
}

/** Projects a duplicated draft (duplication store) into the detail shape. */
function duplicateDetailFor(quoteId: string): QuoteDetail | null {
  const duplicate = state.duplicates.find((item) => item.id === quoteId)
  if (!duplicate) return null
  return {
    id: duplicate.id,
    number: duplicate.number,
    status: { code: 'draft', label: 'Rascunho' },
    issuedOn: '2026-08-17',
    validUntil: null,
    customer: { name: 'Mercado São José', document: '12.345.678/0001-90' },
    industry: { name: 'Total Clean' },
    representative: { name: 'Marina Lima' },
    paymentTerms: '28 dias',
    freight: { terms: 'CIF', amount: '120.00' },
    transporter: { name: 'Nordeste Cargas' },
    lines: duplicate.lines.map((line) => ({
      id: line.id,
      productCode: 'DET-005',
      description: line.description,
      quantity: line.quantity,
      unit: 'UN',
      unitPrice: '42.00',
      total: line.quantity,
    })),
    totals: {
      grossItems: '420.00',
      itemDiscounts: '0.00',
      generalDiscount: '0.00',
      freight: '120.00',
      total: '540.00',
    },
    capabilities: { canEdit: true },
    partialDataWarnings: [],
  }
}

function detailFor(quoteId: string): QuoteDetail | null {
  const entry = state.quotes.find((item) => item.record.id === quoteId)
  if (!entry) return null
  const effective = getEffectiveQuoteStatus(entry.record, BUSINESS_TODAY)
  return {
    id: entry.record.id,
    number: entry.number,
    status: { code: effective, label: statusLabel(effective) },
    issuedOn: '2026-08-12',
    validUntil: entry.record.validUntil,
    customer: { name: entry.customerName, document: '12.345.678/0001-90' },
    industry: { name: 'Total Clean' },
    representative: { name: 'Marina Lima' },
    paymentTerms: '28 dias',
    freight: { terms: 'CIF', amount: '120.00' },
    transporter: { name: 'Nordeste Cargas' },
    lines: [
      {
        id: `line-${entry.record.id}`,
        productCode: 'DET-005',
        description: 'Detergente profissional 5 L',
        quantity: '10',
        unit: 'UN',
        unitPrice: '42.00',
        total: '420.00',
      },
    ],
    totals: {
      grossItems: '420.00',
      itemDiscounts: '0.00',
      generalDiscount: '0.00',
      freight: '120.00',
      total: '540.00',
    },
    capabilities: { canEdit: effective === 'draft' },
    partialDataWarnings: [],
  }
}

function historyFor(quoteId: string): QuoteDetailLifecycleProps['history'] {
  return state.history
    .filter((event) => event.quoteId === quoteId)
    .map((event) => ({
      id: event.id,
      actor: {
        id: event.actorId,
        name: event.actorId === ACTOR_ID ? 'Marina Lima' : null,
        role: event.actorRole,
      },
      occurredAt: event.occurredAt,
      fromStatus: {
        code: event.fromStatus,
        label: statusLabel(event.fromStatus),
      },
      toStatus: { code: event.toStatus, label: statusLabel(event.toStatus) },
      reason: event.reason,
      command: event.command as QuoteDetailLifecycleProps['history'][number]['command'],
    }))
}

function lifecycleProps(quoteId: string): QuoteDetailLifecycleProps | undefined {
  const duplicatedDraft = state.duplicates.find((item) => item.id === quoteId)
  if (duplicatedDraft) {
    return {
      allowedActions: ['sendQuote'],
      canDuplicate: true,
      version: '1',
      history: [],
      onTransition: transition,
      onDuplicate: (request) => duplicate(request),
    }
  }
  const entry = state.quotes.find((item) => item.record.id === quoteId)
  if (!entry) return undefined
  return {
    allowedActions: allowedActionsFor(entry),
    canDuplicate: canDuplicateFor(entry),
    version: String(entry.record.version),
    history: historyFor(quoteId),
    onTransition: transition,
    onDuplicate: duplicate,
  }
}

// ---------------------------------------------------------------------------
// Router-less hash navigation between list and detail
// ---------------------------------------------------------------------------

function useHashRoute(): string {
  const compute = () => {
    // Production deep links (/app/orcamentos/<id>[/editar]) arrive as the
    // document path when the fixture serves them; fold them into the route
    // string the same way a '#'-prefixed hash would be.
    const { pathname, hash } = window.location
    if (hash) return hash.replace(/^#/, '')
    return /^\/(app\/)?orcamentos/.test(pathname)
      ? pathname
      : '/orcamentos'
  }
  const [hash, setHash] = useState(compute)
  useEffect(() => {
    const onChange = () => setHash(compute())
    window.addEventListener('hashchange', onChange)
    window.addEventListener('popstate', onChange)
    return () => {
      window.removeEventListener('hashchange', onChange)
      window.removeEventListener('popstate', onChange)
    }
  }, [])
  return hash || '/orcamentos'
}

function WorkspaceApp() {
  const route = useHashRoute()
  const queryClient = useMemo(() => new QueryClient(), [])
  // The duplicate's "Editar" link targets /app/orcamentos/<id>/editar; inside
  // the fixture workspace that maps to the hash detail route.
  const editMatch = /^\/app\/orcamentos\/([^/]+)\/editar$/.exec(route)
  const detailMatch =
    editMatch ??
    (/^\/app\/orcamentos\/([^/]+)$/.exec(route) ??
      /^\/orcamentos\/([^/]+)$/.exec(route))

  useEffect(() => {
    document.documentElement.setAttribute('data-workspace-ready', '')
  }, [])

  useEffect(() => {
    // Production components emit real app links (/app/orcamentos/...). Inside
    // the fixture workspace those map to hash routes instead of server pages.
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href || !href.startsWith('/app/orcamentos/')) return
      event.preventDefault()
      window.location.hash = `#${href}`
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    // When the workspace was loaded directly on a deep-link path, rewrite the
    // URL to its hash equivalent so later hash navigations stay consistent.
    if (window.location.hash || window.location.pathname === '/fixture.html') return
    window.history.replaceState(null, '', `/fixture.html#${window.location.pathname}`)
  }, [])

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
          {detailMatch ? (
            (() => {
              const quoteId = decodeURIComponent(detailMatch[1]!)
              const detail =
                detailFor(quoteId) ??
                // Duplicated drafts live in the duplication store, not the
                // seeded quote list; project them into the detail shape.
                duplicateDetailFor(quoteId)
              if (!detail) {
                return (
                  <section className="rounded-xl border bg-card p-6">
                    <p className="text-sm text-muted-foreground">
                      Orçamento não encontrado.
                    </p>
                    <a
                      href="#/orcamentos"
                      className="mt-4 inline-flex font-semibold text-blue underline"
                    >
                      Voltar para orçamentos
                    </a>
                  </section>
                )
              }
              return (
                <div data-testid="quote-detail-surface">
                  <QuoteDetailView
                    key={`${quoteId}:${state.quotes.find((q) => q.record.id === quoteId)?.record.version}`}
                    state={{ kind: 'ready', quote: detail }}
                    lifecycle={lifecycleProps(quoteId)}
                  />
                </div>
              )
            })()
          ) : (
            <div data-testid="quote-list-surface">
              <QuoteListView
                quotes={listItems()}
                onTransition={transition}
                onDuplicate={duplicate}
              />
            </div>
          )}
        </div>
      </main>
    </QueryClientProvider>
  )
}

// Scripted second-session controls used by stale/denied scenarios.
declare global {
  interface Window {
    quotesFixture: {
      secondSessionApproveSentQuote(quoteId: string): void
      deniedTransitionProbe(
        quoteId: string,
      ): Promise<QuoteLifecycleMutationResult>
      actAsReadOnly(): void
      actAsOwner(): void
      pendingTransitionCount(): number
      pendingDuplicateCount(): number
      auditEventCount(): number
      duplicateCount(): number
      reset(): void
    }
  }
}

window.quotesFixture = {
  secondSessionApproveSentQuote(quoteId: string) {
    void (async () => {
      await workspace.lifecycle.transition({
        quoteId,
        command: 'approveQuote',
        actor: {
          id: 'admin-9',
          role: 'admin',
          permissions: ['quotes:decide:any'],
        },
        idempotencyKey: `second-session-${quoteId}-${Date.now()}`,
      })
      workspace.flush()
    })()
  },
  /** Direct service-boundary denial probe for the read-only actor. */
  deniedTransitionProbe(quoteId: string) {
    const previous =
      (window as unknown as { __fixtureActor?: QuoteLifecycleActor }).__fixtureActor
    ;(window as unknown as { __fixtureActor?: QuoteLifecycleActor }).__fixtureActor =
      readOnlyActor
    const probe = transition({
      quoteId,
      command: 'sendQuote',
      idempotencyKey: `denied-probe-${quoteId}-${Date.now()}`,
    }).finally(() => {
      ;(window as unknown as { __fixtureActor?: QuoteLifecycleActor }).__fixtureActor =
        previous
    })
    return probe
  },
  actAsReadOnly() {
    ;(window as unknown as { __fixtureActor?: QuoteLifecycleActor }).__fixtureActor =
      readOnlyActor
  },
  actAsOwner() {
    delete (window as unknown as { __fixtureActor?: QuoteLifecycleActor })
      .__fixtureActor
  },
  pendingTransitionCount() {
    return state.transitionKeys.length
  },
  pendingDuplicateCount() {
    return state.duplicateKeys.length
  },
  auditEventCount() {
    return state.history.length + state.duplicateEvents.length
  },
  duplicateCount() {
    return state.duplicates.length
  },
  reset() {
    resetState()
    state = loadState()
    workspace = createWorkspace(state)
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceApp />
  </StrictMode>,
)
