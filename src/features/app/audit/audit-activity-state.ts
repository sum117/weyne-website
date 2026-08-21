/**
 * URL-owned filter/pagination state for `/app/configuracoes/auditoria`.
 *
 * Pure module (no React/DOM/server imports) so parsing and serialization stay
 * predictable and unit-testable. The URL is the single source of truth: the
 * viewer commits filter changes to the search string and every data request is
 * derived from the parsed state, never from ad-hoc component fields.
 *
 * Limits here mirror the server contract in
 * `src/lib/audit/activity.server.ts` (which re-validates everything); these
 * checks exist only to give faster feedback and can never widen what the
 * server accepts.
 */

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'transition',
  'duplicate',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  create: 'Criação',
  update: 'Atualização',
  transition: 'Mudança de status',
  duplicate: 'Duplicação',
}

export const AUDIT_PAGE_SIZES = [10, 25, 50] as const
export const AUDIT_DEFAULT_PAGE_SIZE = 25
export const AUDIT_MAX_DATE_RANGE_DAYS = 90
export const AUDIT_MAX_FILTER_LENGTH = 128
/** Business timezone (no DST) used to turn date-only filters into instants. */
export const AUDIT_BUSINESS_TIME_ZONE_OFFSET = '-03:00'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type AuditFiltersState = Readonly<{
  actorId: string
  action: AuditAction | ''
  entityId: string
  occurredFrom: string
  occurredTo: string
  correlationId: string
}>

export type AuditActivitySearchState = Readonly<{
  filters: AuditFiltersState
  pageSize: number
  /** Opaque keyset cursor for the current page; absent on the first page. */
  cursor?: string
  /** Cosmetic page counter kept in the URL alongside the cursor. */
  page: number
}>

export type AuditFilterIssue = Readonly<{
  field: keyof AuditFiltersState
  message: string
}>

export type AuditActivityPageRequest = Readonly<{
  limit: number
  cursor?: string
  filters: Readonly<{
    actorId?: string
    action?: AuditAction
    entityType?: 'quote'
    entityId?: string
    occurredFrom?: string
    occurredTo?: string
    correlationId?: string
  }>
}>

function boundedText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, AUDIT_MAX_FILTER_LENGTH)
}

function parseIsoDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !ISO_DATE_PATTERN.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    return ''
  }
  return value
}

function parsePageSize(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  return (AUDIT_PAGE_SIZES as readonly number[]).includes(parsed)
    ? parsed
    : AUDIT_DEFAULT_PAGE_SIZE
}

function parsePage(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  return Number.isSafeInteger(parsed) && parsed >= 1
    ? Math.min(parsed, 10_000)
    : 1
}

function parseCursor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= 512 ? trimmed : undefined
}

export function parseAuditSearch(
  search: Record<string, unknown>,
): AuditActivitySearchState {
  const rawAction = typeof search.action === 'string' ? search.action : ''
  return {
    filters: {
      actorId: boundedText(search.actor),
      action: (AUDIT_ACTIONS as readonly string[]).includes(rawAction)
        ? (rawAction as AuditAction)
        : '',
      entityId:
        typeof search.entity === 'string' && UUID_PATTERN.test(search.entity)
          ? search.entity
          : '',
      occurredFrom: parseIsoDate(search.from),
      occurredTo: parseIsoDate(search.to),
      correlationId: boundedText(search.correlation),
    },
    pageSize: parsePageSize(search.pageSize),
    cursor: parseCursor(search.cursor),
    page: parsePage(search.page),
  }
}

export function serializeAuditSearch(
  state: AuditActivitySearchState,
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  const { filters } = state
  if (filters.actorId) next.actor = filters.actorId
  if (filters.action) next.action = filters.action
  if (filters.entityId) next.entity = filters.entityId
  if (filters.occurredFrom) next.from = filters.occurredFrom
  if (filters.occurredTo) next.to = filters.occurredTo
  if (filters.correlationId) next.correlation = filters.correlationId
  if (state.pageSize !== AUDIT_DEFAULT_PAGE_SIZE) {
    next.pageSize = state.pageSize
  }
  if (state.cursor) next.cursor = state.cursor
  if (state.cursor && state.page > 1) next.page = state.page
  return next
}

export function hasActiveFilters(filters: AuditFiltersState): boolean {
  return Object.values(filters).some((value) => value !== '')
}

/**
 * Client-side mirror of the server's strict filter bounds. Issues block the
 * request locally for fast feedback; the server repeats every check.
 */
export function validateAuditFilters(
  filters: AuditFiltersState,
): readonly AuditFilterIssue[] {
  const issues: AuditFilterIssue[] = []
  if (filters.entityId && !UUID_PATTERN.test(filters.entityId)) {
    issues.push({
      field: 'entityId',
      message: 'Informe um identificador de orçamento válido (UUID).',
    })
  }
  if (filters.occurredFrom && filters.occurredTo) {
    const from = Date.parse(
      `${filters.occurredFrom}T00:00:00${AUDIT_BUSINESS_TIME_ZONE_OFFSET}`,
    )
    const to = Date.parse(
      `${filters.occurredTo}T00:00:00${AUDIT_BUSINESS_TIME_ZONE_OFFSET}`,
    )
    if (to < from) {
      issues.push({
        field: 'occurredTo',
        message: 'A data final deve ser igual ou posterior à data inicial.',
      })
    } else if (to - from > AUDIT_MAX_DATE_RANGE_DAYS * 86_400_000) {
      issues.push({
        field: 'occurredTo',
        message: `O período máximo é de ${AUDIT_MAX_DATE_RANGE_DAYS} dias.`,
      })
    }
  }
  return issues
}

function instantFrom(date: string, endOfDay: boolean): string {
  const time = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'
  return `${date}${time}${AUDIT_BUSINESS_TIME_ZONE_OFFSET}`
}

/** Builds the server request from committed URL state. Filters are stripped when empty. */
export function buildAuditPageRequest(
  state: AuditActivitySearchState,
): AuditActivityPageRequest {
  const { filters } = state
  return {
    limit: state.pageSize,
    ...(state.cursor ? { cursor: state.cursor } : {}),
    filters: {
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      entityType: 'quote',
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.occurredFrom
        ? { occurredFrom: instantFrom(filters.occurredFrom, false) }
        : {}),
      ...(filters.occurredTo
        ? { occurredTo: instantFrom(filters.occurredTo, true) }
        : {}),
      ...(filters.correlationId
        ? { correlationId: filters.correlationId }
        : {}),
    },
  }
}

export function formatAuditTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Fortaleza',
  }).format(date)
}
