/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Fragment, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AuditActivityViewer } from '@/features/app/audit/audit-activity-viewer'
import type { AuditActivityItem } from '@/features/app/audit/audit-activity.functions'
import {
  buildAuditPageRequest,
  parseAuditSearch,
  serializeAuditSearch,
  validateAuditFilters,
} from '@/features/app/audit/audit-activity-state'

const mocks = vi.hoisted(() => ({
  getAuditActivity: vi.fn(),
}))

vi.mock('@/features/app/audit/audit-activity.functions', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAuditActivity: mocks.getAuditActivity,
}))

// The viewer only needs a link element from the router package; the real
// provider pulls in the whole routeTree, which is unnecessary for component
// tests and cannot run more than one navigation per jsdom environment.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children: React.ReactNode
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(() => {
  cleanup()
  mocks.getAuditActivity.mockReset()
})

// jsdom does not implement matchMedia; the viewer uses it to pick the sheet
// side once on mount.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) =>
      ({
        matches: query.includes('min-width'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  })
})

const authorizedEntity: AuditActivityItem['entity'] = {
  type: 'quote',
  id: '10000000-0000-4000-8000-000000000001',
  displayName: 'ORC-2026-000001',
  href: '/app/orcamentos/10000000-0000-4000-8000-000000000001',
}

const unauthorizedEntity: AuditActivityItem['entity'] = {
  type: 'quote',
  id: '20000000-0000-4000-8000-000000000002',
}

function event(overrides: Partial<AuditActivityItem> = {}): AuditActivityItem {
  return {
    id: '30000000-0000-4000-8000-000000000003',
    occurredAt: '2026-08-17T12:00:00.000Z',
    correlationId: 'request-3',
    action: 'update',
    description: 'Ana Admin atualizou o orçamento ORC-2026-000001.',
    actor: { id: 'admin-1', displayName: 'Ana Admin' },
    entity: authorizedEntity,
    before: { status: 'draft', password: '[REDACTED]' },
    after: { status: 'sent' },
    ...overrides,
  }
}

function page(items: readonly AuditActivityItem[], nextCursor: string | null = null) {
  return {
    ok: true as const,
    data: { items, nextCursor },
  }
}

/**
 * Renders the viewer against an in-memory search state. Navigation commits
 * through the same `search` updater contract the route passes from TanStack
 * Router, so URL-owned behavior is exercised without a live router.
 */
async function renderViewer(search: Record<string, unknown> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  function Harness() {
    const [current, setCurrent] = useState<Record<string, unknown>>(search)
    return (
      <QueryClientProvider client={client}>
        <Fragment>
          <AuditActivityViewer
            search={current}
            navigate={(options) =>
              setCurrent((previous) => options.search(previous))
            }
            today="2026-08-21"
          />
        </Fragment>
      </QueryClientProvider>
    )
  }

  render(<Harness />)
}

describe('audit activity URL state', () => {
  it('round-trips filters through the URL with defaults omitted', () => {
    const state = parseAuditSearch({
      actor: ' admin-1 ',
      action: 'update',
      entity: '10000000-0000-4000-8000-000000000001',
      from: '2026-08-01',
      to: '2026-08-15',
      correlation: 'request-9',
      pageSize: 50,
      cursor: 'abc',
      page: 2,
    })
    expect(state.filters).toEqual({
      actorId: 'admin-1',
      action: 'update',
      entityId: '10000000-0000-4000-8000-000000000001',
      occurredFrom: '2026-08-01',
      occurredTo: '2026-08-15',
      correlationId: 'request-9',
    })
    expect(state.pageSize).toBe(50)
    expect(state.cursor).toBe('abc')
    expect(state.page).toBe(2)

    const serialized = serializeAuditSearch(state)
    expect(serialized.pageSize).toBe(50)
    expect(serialized.actor).toBe('admin-1')

    // Defaults disappear from the URL.
    const defaults = serializeAuditSearch(parseAuditSearch({}))
    expect(defaults).toEqual({})
  })

  it('rejects unknown actions, malformed dates and UUIDs when parsing', () => {
    const state = parseAuditSearch({
      action: 'delete',
      from: '17/08/2026',
      entity: 'not-a-uuid',
      pageSize: 999,
      cursor: '',
    })
    expect(state.filters.action).toBe('')
    expect(state.filters.occurredFrom).toBe('')
    expect(state.filters.entityId).toBe('')
    expect(state.pageSize).toBe(25)
    expect(state.cursor).toBeUndefined()
  })

  it('mirrors the server bounds for date range and entity UUID shape', () => {
    const tooWide = validateAuditFilters({
      actorId: '',
      action: '',
      entityId: '',
      correlationId: '',
      occurredFrom: '2026-01-01',
      occurredTo: '2026-06-01',
    })
    expect(tooWide.map((issue) => issue.field)).toContain('occurredTo')

    const reversed = validateAuditFilters({
      actorId: '',
      action: '',
      entityId: '',
      correlationId: '',
      occurredFrom: '2026-08-10',
      occurredTo: '2026-08-01',
    })
    expect(reversed.length).toBeGreaterThan(0)

    const badUuid = validateAuditFilters({
      actorId: '',
      action: '',
      entityId: 'quote-1',
      correlationId: '',
      occurredFrom: '',
      occurredTo: '',
    })
    expect(badUuid.map((issue) => issue.field)).toContain('entityId')
  })

  it('builds a bounded server request with half-open local-day instants', () => {
    const request = buildAuditPageRequest(
      parseAuditSearch({ from: '2026-08-01', to: '2026-08-03', action: 'create' }),
    )
    expect(request.limit).toBe(25)
    expect(request.filters.action).toBe('create')
    expect(request.filters.entityType).toBe('quote')
    expect(request.filters.occurredFrom).toBe('2026-08-01T00:00:00.000-03:00')
    expect(request.filters.occurredTo).toBe('2026-08-03T23:59:59.999-03:00')
  })
})

describe('AuditActivityViewer', () => {
  it('renders the event table with authorized links only and no mutation controls', async () => {
    mocks.getAuditActivity.mockResolvedValue(
      page([
        event(),
        event({
          id: '50000000-0000-4000-8000-000000000005',
          entity: unauthorizedEntity,
        }),
      ]),
    )

    await renderViewer()

    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: /ORC-2026-000001/ }).length).toBeGreaterThan(0),
    )
    // Wide table and narrow card list both render; jsdom keeps CSS-hidden
    // markup in the tree.
    const tables = screen.getAllByRole('region', { name: 'Atividade de auditoria' })
    expect(within(tables[0]!).getAllByRole('row')).toHaveLength(3)

    // Unauthorized entity renders as an opaque id, never a link.
    expect(screen.queryByRole('link', { name: /20000000/ })).not.toBeInTheDocument()

    // Read-only surface: no edit/delete vocabulary anywhere.
    expect(screen.queryByText(/excluir|editar|remover/i)).not.toBeInTheDocument()
  })

  it('sends the bounded server request derived from the URL', async () => {
    mocks.getAuditActivity.mockResolvedValue(page([]))

    await renderViewer({
      actor: 'admin-1',
      action: 'update',
      from: '2026-08-01',
      to: '2026-08-03',
      pageSize: 10,
    })

    await waitFor(() => expect(mocks.getAuditActivity).toHaveBeenCalled())
    const call = mocks.getAuditActivity.mock.calls[0]?.[0] as { data?: Record<string, unknown> }
    expect(call.data).toMatchObject({
      limit: 10,
      filters: {
        actorId: 'admin-1',
        action: 'update',
        entityType: 'quote',
        occurredFrom: '2026-08-01T00:00:00.000-03:00',
        occurredTo: '2026-08-03T23:59:59.999-03:00',
      },
    })
  })

  it('shows the empty-no-events and empty-no-results states distinctly', async () => {
    mocks.getAuditActivity.mockResolvedValue(page([]))

    await renderViewer()
    await waitFor(() =>
      expect(screen.getByText('Nenhum evento registrado')).toBeInTheDocument(),
    )
  })

  it('shows the filtered empty state when active filters return nothing', async () => {
    mocks.getAuditActivity.mockResolvedValue(page([]))

    await renderViewer({ action: 'duplicate' })
    await waitFor(() =>
      expect(
        screen.getByText('Nenhum evento corresponde aos filtros'),
      ).toBeInTheDocument(),
    )
  })

  it('blocks invalid filter submissions locally and shows the issues', async () => {
    mocks.getAuditActivity.mockResolvedValue(page([]))

    await renderViewer()

    fireEvent.change(screen.getByLabelText('Data inicial'), {
      target: { value: '2026-08-10' },
    })
    fireEvent.change(screen.getByLabelText('Data final'), {
      target: { value: '2026-08-01' },
    })
    fireEvent.submit(screen.getByRole('search'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A data final deve ser igual ou posterior à data inicial.',
    )
    expect(mocks.getAuditActivity).toHaveBeenCalledTimes(1)

    // Fixing the range and resubmitting clears the alert.
    fireEvent.change(screen.getByLabelText('Data final'), {
      target: { value: '2026-08-11' },
    })
    fireEvent.submit(screen.getByRole('search'))
    await waitFor(() => expect(mocks.getAuditActivity).toHaveBeenCalledTimes(2))
  })

  it('renders the unauthorized state from the server FORBIDDEN result', async () => {
    mocks.getAuditActivity.mockResolvedValue({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        status: 403,
        message: 'Apenas administradores podem consultar a auditoria.',
      },
    })

    await renderViewer()
    expect(await screen.findByText('Acesso restrito')).toBeInTheDocument()
  })

  it('renders recoverable errors with a working retry control', async () => {
    mocks.getAuditActivity.mockRejectedValueOnce(new TypeError('network down'))
    mocks.getAuditActivity.mockResolvedValue(page([event()]))

    await renderViewer()
    expect(
      await screen.findByText('Não foi possível carregar a atividade de auditoria.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Atividade de auditoria' })).toBeInTheDocument(),
    )
  })

  it('opens the accessible detail sheet with redacted summaries and closes it', async () => {
    mocks.getAuditActivity.mockResolvedValue(page([event()]))

    await renderViewer()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Detalhes' }))[0]!)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Antes da alteração')).toBeInTheDocument()
    expect(within(dialog).getByText('[REDACTED]')).toBeInTheDocument()
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('paginates forward through the server cursor and back again', async () => {
    const firstPage = page([event()], 'cursor-page-2')
    const secondPage = page([
      event({ id: '40000000-0000-4000-8000-000000000004', correlationId: 'request-4' }),
    ])
    mocks.getAuditActivity
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage)
      .mockResolvedValueOnce(firstPage)

    await renderViewer()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Próxima página' })).toBeEnabled(),
    )
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }))
    await waitFor(() => expect(screen.getByText(/Página 2/)).toBeInTheDocument())
    await waitFor(() => expect(mocks.getAuditActivity).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }))
    await waitFor(() => expect(mocks.getAuditActivity).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByText(/Página 1/)).toBeInTheDocument())
  })

  it('keeps the loading state visible while the first page is in flight', async () => {
    mocks.getAuditActivity.mockReturnValue(new Promise(() => undefined))

    await renderViewer()
    expect(screen.getByText('Carregando eventos…')).toBeInTheDocument()
  })
})
