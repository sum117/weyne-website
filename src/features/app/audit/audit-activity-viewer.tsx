import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { MagnifyingGlass, X } from '@phosphor-icons/react/dist/ssr'
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_PAGE_SIZES,
  buildAuditPageRequest,
  formatAuditTimestamp,
  hasActiveFilters,
  parseAuditSearch,
  serializeAuditSearch,
  validateAuditFilters,
  type AuditAction,
  type AuditActivitySearchState,
} from './audit-activity-state'
import {
  getAuditActivity,
  type AuditActivityItem,
  type AuditSummaryValue,
} from './audit-activity.functions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/cn'

/**
 * Admin audit-activity viewer for `/app/configuracoes/auditoria`.
 *
 * Read-only surface over the authorized audit query: every filter, page size
 * and cursor goes through the server function, which re-authenticates and
 * re-validates each call — no client state can widen what comes back. There
 * are intentionally no edit or delete controls anywhere here.
 *
 * Layout contract: filter form commits to the URL (predictable shareable
 * state), results render as a table on wide screens and stacked cards on
 * narrow ones with the same essential fields, and event details open in a
 * Radix sheet (bottom on mobile, side on desktop) with full keyboard and
 * focus handling provided by the primitive.
 */

export const AUDIT_VIEWER_LABEL = 'Atividade de auditoria'

type AuditNavigate = (options: {
  search: (current: Record<string, unknown>) => Record<string, unknown>
  replace: boolean
}) => unknown

type AuditViewerProps = {
  search: Record<string, unknown>
  navigate: AuditNavigate
  /** ISO date (yyyy-mm-dd) bounding sensible date-filter defaults. */
  today?: string
}

type LoadState =
  | 'invalid'
  | 'loading'
  | 'unauthorized'
  | 'unauthenticated'
  | 'error'
  | 'empty-no-events'
  | 'empty-no-results'
  | 'ready'

const ACTION_BADGE_VARIANT: Readonly<
  Record<AuditAction, 'neutral' | 'info' | 'warning' | 'success'>
> = {
  create: 'success',
  update: 'info',
  transition: 'warning',
  duplicate: 'neutral',
}

function summaryMarker(value: string): boolean {
  return (
    value === '[REDACTED]' || value === '[TRUNCATED]' || value === '[OMITTED]'
  )
}

/** Renders the redacted, bounded before/after summaries returned by the API. */
function SummaryValue({ value }: { value: AuditSummaryValue }) {
  if (value === null || typeof value === 'boolean') {
    return <span className="text-sm text-muted">{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="font-sans text-sm text-ink">{value}</span>
  }
  if (typeof value === 'string') {
    return summaryMarker(value) ? (
      <Badge variant="neutral" size="compact">
        {value}
      </Badge>
    ) : (
      <span className="font-sans text-sm break-words text-ink">{value}</span>
    )
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-sm text-muted">[]</span>
    }
    return (
      <ul className="list-disc space-y-1 pl-5">
        {value.map((item, index) => (
          <li key={index}>
            <SummaryValue value={item} />
          </li>
        ))}
      </ul>
    )
  }
  const entries = Object.entries(value)
  if (entries.length === 0) {
    return <span className="text-sm text-muted">{'{}'}</span>
  }
  return (
    <dl className="space-y-1.5">
      {entries.map(([key, item]) => (
        <div key={key} className="min-w-0">
          <dt className="font-mono text-xs break-all text-muted">{key}</dt>
          <dd className="min-w-0 pl-3">
            <SummaryValue value={item} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function SummarySection({
  title,
  value,
}: {
  title: string
  value: AuditSummaryValue
}) {
  const isEmpty =
    value === null ||
    (typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  return (
    <section className="min-w-0 space-y-2 rounded-xl border border-border bg-paper p-4">
      <h3 className="text-sm font-semibold text-navy">{title}</h3>
      {isEmpty ? (
        <p className="text-sm text-muted">Sem alterações registradas.</p>
      ) : (
        <SummaryValue value={value} />
      )}
    </section>
  )
}

function EntityCell({
  entity,
}: {
  entity: AuditActivityItem['entity']
}) {
  if ('href' in entity && entity.href) {
    return (
      <Link
        to={entity.href}
        className="inline-flex min-h-6 items-center rounded-full border border-border px-2 text-xs font-medium text-blue underline-offset-2 hover:bg-paper focus-visible:ring-2 focus-visible:ring-blue focus-visible:outline-hidden"
        aria-label={`Abrir o orçamento ${entity.displayName}`}
      >
        {entity.displayName}
      </Link>
    )
  }
  return (
    <span
      className="font-mono text-xs text-muted"
      title={entity.id}
      aria-label={`Orçamento ${entity.id}`}
    >
      {entity.id.slice(0, 8)}…
    </span>
  )
}

function ActionBadge({ action }: { action: AuditActivityItem['action'] }) {
  return (
    <Badge variant={ACTION_BADGE_VARIANT[action]}>
      {AUDIT_ACTION_LABELS[action]}
    </Badge>
  )
}

/**
 * Bottom sheet on narrow screens, side sheet from `sm` up. Decided once on
 * mount so SSR markup stays stable; both sides keep the same content.
 */
function useSheetSide(): 'bottom' | 'right' {
  const [side, setSide] = useState<'bottom' | 'right'>('bottom')
  useEffect(() => {
    const query = window.matchMedia('(min-width: 640px)')
    const update = () => setSide(query.matches ? 'right' : 'bottom')
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return side
}

function EventDetailSheet({
  event,
  onClose,
}: {
  event: AuditActivityItem | null
  onClose: () => void
}) {
  const side = useSheetSide()
  return (
    <Sheet open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={side}
        aria-describedby={event ? 'audit-detail-description' : undefined}
        className={cn(
          'gap-0 overflow-y-auto',
          side === 'bottom' && 'max-h-[88dvh] rounded-t-2xl',
        )}
      >
        {event ? (
          <>
            <SheetHeader className="border-b border-line pb-4">
              <div className="flex items-start gap-2 pr-8">
                <ActionBadge action={event.action} />
              </div>
              <SheetTitle className="leading-snug">
                {event.description}
              </SheetTitle>
              <SheetDescription id="audit-detail-description">
                Evento registrado em {formatAuditTimestamp(event.occurredAt)}.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 overflow-y-auto p-4">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Responsável</dt>
                <dd className="break-words text-ink">
                  {event.actor.displayName}
                  <span className="ml-2 font-mono text-xs text-muted">
                    {event.actor.id}
                  </span>
                </dd>
                <dt className="text-muted">Correlação</dt>
                <dd className="font-mono text-xs break-all text-ink">
                  {event.correlationId}
                </dd>
                <dt className="text-muted">Orçamento</dt>
                <dd className="min-w-0">
                  <EntityCell entity={event.entity} />
                </dd>
              </dl>
              <SummarySection title="Antes da alteração" value={event.before} />
              <SummarySection title="Depois da alteração" value={event.after} />
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="w-full"
              >
                Fechar detalhes
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-1 rounded-xl border border-dashed border-border bg-white p-10 text-center"
    >
      <p className="font-semibold text-ink">{title}</p>
      <p className="text-sm text-muted">{description}</p>
    </div>
  )
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="space-y-3 rounded-xl border border-destructive-border bg-destructive-surface p-6 text-center"
    >
      <p className="text-sm font-medium text-destructive-surface-foreground">
        {message}
      </p>
      <Button type="button" variant="outline" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  )
}

export function AuditActivityViewer({
  search,
  navigate,
  today,
}: AuditViewerProps) {
  const committed = useMemo(() => parseAuditSearch(search), [search])
  const [draft, setDraft] = useState<AuditActivitySearchState>(committed)
  const [openEventId, setOpenEventId] = useState<string | null>(null)
  // Issues from the last rejected local submission; cleared on commit.
  const [submissionIssues, setSubmissionIssues] = useState<readonly string[]>([])
  // Cursor trail for stepping back through keyset pages within this visit.
  const cursorTrailRef = useRef<string[]>([])
  const lastCommittedRef = useRef(search)

  useEffect(() => {
    if (lastCommittedRef.current !== search) {
      lastCommittedRef.current = search
      setDraft(parseAuditSearch(search))
      setSubmissionIssues([])
    }
  }, [search])

  // Server-side validation failures land here as well, mapped to the same
  // invalid-filter presentation as local checks.
  const request = useMemo(() => buildAuditPageRequest(committed), [committed])
  const queryKey = useMemo(() => JSON.stringify(request), [request])
  const query = useQuery({
    queryKey: ['audit', 'activity', queryKey],
    queryFn: () => getAuditActivity({ data: { ...request, filters: { ...request.filters } } }),
    placeholderData: (previous) => previous,
  })

  const localIssues = validateAuditFilters(committed.filters)
  const serverError = query.data?.ok ? null : (query.data?.error ?? null)
  const serverIssues =
    serverError?.code === 'INVALID_FILTER' && serverError.issues
      ? serverError.issues.map((issue) => issue.message)
      : []

  const state: LoadState = query.isPending
    ? 'loading'
    : query.isError || (query.data && !query.data.ok && !serverError)
      ? 'error'
      : serverError?.code === 'FORBIDDEN'
        ? 'unauthorized'
        : serverError?.code === 'UNAUTHENTICATED'
          ? 'unauthenticated'
          : serverError
            ? 'error'
            : localIssues.length > 0 || serverIssues.length > 0
              ? 'invalid'
              : (() => {
                  const page = query.data?.ok ? query.data.data : null
                  if (!page) return 'loading'
                  if (page.items.length > 0) return 'ready'
                  return hasActiveFilters(committed.filters)
                    ? 'empty-no-results'
                    : 'empty-no-events'
                })()

  const page = query.data?.ok ? query.data.data : null

  const commit = (next: AuditActivitySearchState) => {
    cursorTrailRef.current = []
    setSubmissionIssues([])
    lastCommittedRef.current = serializeAuditSearch(next)
    void navigate({
      search: () => lastCommittedRef.current,
      replace: false,
    })
  }

  const applyFilters = () => {
    const issues = validateAuditFilters(draft.filters)
    if (issues.length > 0) {
      // Rejected locally: show the issues without navigating or querying.
      setSubmissionIssues(issues.map((issue) => issue.message))
      return
    }
    commit({
      ...draft,
      cursor: undefined,
      page: 1,
      pageSize: draft.pageSize || AUDIT_DEFAULT_PAGE_SIZE,
    })
  }

  const clearFilters = () => {
    const emptyFilters = {
      actorId: '',
      action: '',
      entityId: '',
      occurredFrom: '',
      occurredTo: '',
      correlationId: '',
    } as const
    setDraft({ ...committed, filters: { ...emptyFilters } })
    commit({
      ...committed,
      filters: { ...emptyFilters },
      cursor: undefined,
      page: 1,
    })
  }

  const goNext = () => {
    if (!page?.nextCursor) return
    if (committed.cursor) cursorTrailRef.current.push(committed.cursor)
    else cursorTrailRef.current = []
    commit({ ...committed, cursor: page.nextCursor, page: committed.page + 1 })
  }

  const goPrevious = () => {
    const trail = cursorTrailRef.current
    const previousCursor = trail.length > 0 ? trail.pop() : undefined
    commit({
      ...committed,
      cursor: previousCursor,
      page: Math.max(1, committed.page - 1),
    })
  }

  const openEvent = page?.items.find((item) => item.id === openEventId) ?? null
  const allIssues: readonly string[] = [
    ...submissionIssues,
    ...localIssues.map((issue) => issue.message),
    ...serverIssues,
  ]

  return (
    <div className="min-h-0 bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1200px] space-y-6">
        <header className="space-y-2">
          <nav aria-label="Navegação estrutural">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <li>
                <Link
                  to="/app"
                  className="rounded-sm hover:text-blue focus-visible:ring-2 focus-visible:ring-blue focus-visible:outline-hidden"
                >
                  Área de gestão
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <span>Configurações</span>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="font-medium text-foreground">
                Auditoria
              </li>
            </ol>
          </nav>
          <h1 className="font-display text-3xl text-navy sm:text-4xl">
            Auditoria de atividades
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted sm:text-base">
            Consulta somente leitura do histórico de ações sobre orçamentos. Os
            resultados são filtrados e paginados no servidor, com dados sensíveis
            sempre redigidos.
          </p>
        </header>

        <Card>
          <CardContent className="pt-6">
            <form
              role="search"
              aria-label="Filtros de auditoria"
              onSubmit={(event) => {
                event.preventDefault()
                applyFilters()
              }}
              className="space-y-4"
              noValidate
            >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-1.5 text-sm font-medium text-ink">
                  Responsável (ID)
                  <Input
                    type="text"
                    maxLength={128}
                    autoComplete="off"
                    value={draft.filters.actorId}
                    onChange={(event) => {
                      const { value } = event.currentTarget
                      setDraft((current) => ({
                        ...current,
                        filters: {
                          ...current.filters,
                          actorId: value,
                        },
                      }))
                    }}
                  />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-ink">
                  Ação
                  <select
                    aria-label="Ação"
                    value={draft.filters.action}
                    onChange={(event) => {
                      const { value } = event.currentTarget
                      setDraft((current) => ({
                        ...current,
                        filters: {
                          ...current.filters,
                          action: value as AuditAction | '',
                        },
                      }))
                    }}
                    className="min-h-12 w-full rounded-xl border border-input bg-white px-3 py-2 text-sm text-ink outline-hidden focus-visible:border-baltic focus-visible:ring-4 focus-visible:ring-baltic/15"
                  >
                    <option value="">Todas as ações</option>
                    {AUDIT_ACTIONS.map((action) => (
                      <option key={action} value={action}>
                        {AUDIT_ACTION_LABELS[action]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium text-ink">
                  Orçamento (ID UUID)
                  <Input
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    placeholder="00000000-0000-0000-0000-000000000000"
                    value={draft.filters.entityId}
                    onChange={(event) => {
                      const { value } = event.currentTarget
                      setDraft((current) => ({
                        ...current,
                        filters: {
                          ...current.filters,
                          entityId: value,
                        },
                      }))
                    }}
                  />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-ink">
                  Data inicial
                  <Input
                    type="date"
                    max={today}
                    value={draft.filters.occurredFrom}
                    onChange={(event) => {
                      const { value } = event.currentTarget
                      setDraft((current) => ({
                        ...current,
                        filters: {
                          ...current.filters,
                          occurredFrom: value,
                        },
                      }))
                    }}
                  />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-ink">
                  Data final
                  <Input
                    type="date"
                    max={today}
                    value={draft.filters.occurredTo}
                    onChange={(event) => {
                      const { value } = event.currentTarget
                      setDraft((current) => ({
                        ...current,
                        filters: {
                          ...current.filters,
                          occurredTo: value,
                        },
                      }))
                    }}
                  />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-ink">
                  Correlação (ID de comando)
                  <Input
                    type="text"
                    maxLength={128}
                    autoComplete="off"
                    value={draft.filters.correlationId}
                    onChange={(event) => {
                      const { value } = event.currentTarget
                      setDraft((current) => ({
                        ...current,
                        filters: {
                          ...current.filters,
                          correlationId: value,
                        },
                      }))
                    }}
                  />
                </label>
              </div>

              {allIssues.length > 0 ? (
                <div
                  role="alert"
                  className="rounded-xl border border-destructive-border bg-destructive-surface p-4"
                >
                  <p className="text-sm font-semibold text-destructive-surface-foreground">
                    Corrija os filtros para consultar a auditoria:
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-destructive-surface-foreground">
                    {allIssues.map((message, index) => (
                      <li key={index}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap items-end gap-3">
                <Button type="submit">
                  <MagnifyingGlass className="size-4" weight="light" />
                  Aplicar filtros
                </Button>
                {hasActiveFilters(committed.filters) ||
                hasActiveFilters(draft.filters) ? (
                  <Button type="button" variant="ghost" onClick={clearFilters}>
                    <X className="size-4" weight="light" />
                    Limpar filtros
                  </Button>
                ) : null}
                <label className="ml-auto flex items-center gap-2 text-sm text-muted">
                  Eventos por página
                  <select
                    aria-label="Eventos por página"
                    value={draft.pageSize}
                    onChange={(event) => {
                      const { value } = event.currentTarget
                      commit({
                        ...committed,
                        pageSize: Number(value),
                        cursor: undefined,
                        page: 1,
                      })
                    }}
                    className="min-h-9 rounded-lg border border-input bg-white px-2 py-1.5 text-sm text-ink outline-hidden focus-visible:border-baltic focus-visible:ring-2 focus-visible:ring-baltic/30"
                  >
                    {AUDIT_PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </form>
          </CardContent>
        </Card>

        {state === 'unauthorized' ? (
          <EmptyState
            title="Acesso restrito"
            description="Apenas administradores podem consultar a auditoria."
          />
        ) : state === 'unauthenticated' ? (
          <EmptyState
            title="Sessão necessária"
            description="Entre com sua conta para consultar a auditoria."
          />
        ) : state === 'invalid' ? null : state === 'error' ? (
          <ErrorPanel
            message={
              serverError?.message ??
              'Não foi possível carregar a atividade de auditoria.'
            }
            onRetry={() => void query.refetch()}
          />
        ) : state === 'loading' ? (
          <div
            role="status"
            aria-live="polite"
            aria-label="Carregando eventos de auditoria"
            className="rounded-xl border border-border bg-white p-10 text-center text-muted"
          >
            Carregando eventos…
          </div>
        ) : state === 'empty-no-events' ? (
          <EmptyState
            title="Nenhum evento registrado"
            description="Assim que ações forem realizadas nos orçamentos, elas aparecem aqui."
          />
        ) : state === 'empty-no-results' ? (
          <EmptyState
            title="Nenhum evento corresponde aos filtros"
            description="Amplie o período ou remova algum filtro para ver mais resultados."
          />
        ) : page ? (
          <>
            {/* Wide layout: semantic table */}
            <section
              role="region"
              aria-label={AUDIT_VIEWER_LABEL}
              aria-busy={query.isFetching}
              className="hidden md:block"
            >
              <div className="max-w-full overflow-x-auto rounded-xl border border-border bg-white">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <caption className="sr-only">
                    Eventos de auditoria em ordem decrescente de data
                  </caption>
                  <thead className="border-b border-line bg-paper">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold text-navy">Quando</th>
                      <th scope="col" className="px-4 py-3 font-semibold text-navy">Ação</th>
                      <th scope="col" className="px-4 py-3 font-semibold text-navy">Evento</th>
                      <th scope="col" className="px-4 py-3 font-semibold text-navy">Orçamento</th>
                      <th scope="col" className="px-4 py-3 font-semibold text-navy">
                        <span className="sr-only">Detalhes</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-line/60 align-top last:border-b-0"
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-muted">
                          <time dateTime={item.occurredAt}>
                            {formatAuditTimestamp(item.occurredAt)}
                          </time>
                        </td>
                        <td className="px-4 py-3">
                          <ActionBadge action={item.action} />
                        </td>
                        <td className="max-w-md min-w-0 px-4 py-3">
                          <p className="break-words text-ink">{item.description}</p>
                          <p className="mt-1 font-mono text-xs break-all text-muted">
                            {item.correlationId}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <EntityCell entity={item.entity} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-haspopup="dialog"
                            aria-expanded={openEventId === item.id}
                            onClick={() => setOpenEventId(item.id)}
                          >
                            Detalhes
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Narrow layout: stacked cards, same essential fields */}
            <section
              role="region"
              aria-label={`${AUDIT_VIEWER_LABEL} (lista)`}
              aria-busy={query.isFetching}
              className="space-y-3 md:hidden"
            >
              {page.items.map((item) => (
                <article
                  key={item.id}
                  className="space-y-3 rounded-xl border border-border bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <time
                      dateTime={item.occurredAt}
                      className="text-xs text-muted"
                    >
                      {formatAuditTimestamp(item.occurredAt)}
                    </time>
                    <ActionBadge action={item.action} />
                  </div>
                  <p className="text-sm leading-relaxed text-ink">
                    {item.description}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <EntityCell entity={item.entity} />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-haspopup="dialog"
                      aria-expanded={openEventId === item.id}
                      onClick={() => setOpenEventId(item.id)}
                    >
                      Detalhes
                    </Button>
                  </div>
                  <p className="font-mono text-xs break-all text-muted">
                    {item.correlationId}
                  </p>
                </article>
              ))}
            </section>

            <nav
              aria-label="Paginação de eventos"
              className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted"
            >
              <span aria-live="polite">
                Página {committed.page} ·{' '}
                {page.items.length}{' '}
                {page.items.length === 1 ? 'evento nesta página' : 'eventos nesta página'}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!committed.cursor || query.isFetching}
                  onClick={goPrevious}
                >
                  Página anterior
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!page.nextCursor || query.isFetching}
                  onClick={goNext}
                >
                  Próxima página
                </Button>
              </div>
            </nav>
          </>
        ) : null}
      </div>

      <EventDetailSheet
        event={openEvent}
        onClose={() => setOpenEventId(null)}
      />
    </div>
  )
}
