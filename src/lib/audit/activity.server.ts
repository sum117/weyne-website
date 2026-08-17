import { z } from 'zod'
import { createKeysetCursorCodec } from '@/lib/server/cursor.server'

export const AUDIT_ACTIVITY_LIMITS = {
  defaultPageSize: 25,
  maxPageSize: 100,
  maxDateRangeDays: 90,
  maxFilterLength: 128,
  maxCursorLength: 512,
} as const

const auditActionSchema = z.enum(['create', 'update', 'transition', 'duplicate'])
const auditEntityTypeSchema = z.literal('quote')
const boundedFilterSchema = z.string().trim().min(1).max(AUDIT_ACTIVITY_LIMITS.maxFilterLength)
const instantSchema = z.iso.datetime({ offset: true })

const auditFiltersSchema = z
  .strictObject({
    actorId: boundedFilterSchema.optional(),
    action: auditActionSchema.optional(),
    entityType: auditEntityTypeSchema.optional(),
    entityId: z.uuid().optional(),
    occurredFrom: instantSchema.optional(),
    occurredTo: instantSchema.optional(),
    correlationId: boundedFilterSchema.optional(),
  })
  .superRefine((filters, context) => {
    if (!filters.occurredFrom || !filters.occurredTo) return
    const from = Date.parse(filters.occurredFrom)
    const to = Date.parse(filters.occurredTo)
    const maximumRange = AUDIT_ACTIVITY_LIMITS.maxDateRangeDays * 86_400_000
    if (to < from) {
      context.addIssue({
        code: 'custom',
        path: ['occurredTo'],
        message: 'A data final deve ser igual ou posterior à data inicial.',
      })
    } else if (to - from > maximumRange) {
      context.addIssue({
        code: 'custom',
        path: ['occurredTo'],
        message: `O período máximo é de ${AUDIT_ACTIVITY_LIMITS.maxDateRangeDays} dias.`,
      })
    }
  })

export const auditActivityRequestSchema = z.strictObject({
  cursor: z.string().trim().min(1).max(AUDIT_ACTIVITY_LIMITS.maxCursorLength).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(AUDIT_ACTIVITY_LIMITS.maxPageSize)
    .default(AUDIT_ACTIVITY_LIMITS.defaultPageSize),
  filters: auditFiltersSchema.optional().transform((filters) => filters ?? {}),
})

const cursorCodec = createKeysetCursorCodec(
  z.strictObject({ occurredAt: instantSchema, id: z.uuid() }),
)

export type AuditRequester = Readonly<{
  id: string
  role: 'admin' | 'representative' | 'read_only'
  displayName: string
}>

export type AuditActivityError = Readonly<{
  code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_FILTER'
  status: 400 | 401 | 403
  message: string
  issues?: readonly Readonly<{ path: readonly (string | number)[]; message: string }>[]
}>

export type AuditEntityReference = Readonly<{
  type: 'quote'
  id: string
}>

export type AuditEventRow = Readonly<{
  id: string
  actorId: string
  action: z.output<typeof auditActionSchema>
  entity: AuditEntityReference
  occurredAt: Date
  correlationId: string
  before: unknown
  after: unknown
}>

export type AuditActivityRepositoryQuery = Readonly<{
  limit: number
  cursor: Readonly<{ occurredAt: string; id: string }> | null
  filters: z.output<typeof auditFiltersSchema>
  orderBy: readonly ['occurredAt:desc', 'id:desc']
}>

export type AuditActivityRepository = Readonly<{
  listEvents: (input: AuditActivityRepositoryQuery) => Promise<readonly AuditEventRow[]>
  loadActorMetadata: (actorIds: readonly string[]) => Promise<ReadonlyMap<string, string>>
  loadEntityMetadata: (
    entities: readonly AuditEntityReference[],
  ) => Promise<ReadonlyMap<string, string>>
}>

type QueryDependencies = Readonly<{
  authenticate: () => Promise<AuditRequester | null>
  repository: AuditActivityRepository
  authorizeEntities: (
    requester: AuditRequester,
    entities: readonly AuditEntityReference[],
  ) => Promise<ReadonlySet<string>>
}>

const SENSITIVE_KEY = /(?:password|passcode|secret|token|credential|authorization|cookie|session|hash|salt|private.?key|api.?key|auth.?subject|mfa|otp|email|phone|whatsapp|tax.?id|cnpj|cpf|state.?registration|address|postal.?code|cep|contact.?name|notes?|credit.?limit|bank|account|document)/i
const MAX_SUMMARY_DEPTH = 5
const MAX_OBJECT_FIELDS = 50
const MAX_ARRAY_ITEMS = 20
const MAX_STRING_LENGTH = 256

function redactSummary(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    return value.length <= MAX_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_STRING_LENGTH)}…`
  }
  if (depth >= MAX_SUMMARY_DEPTH) return '[TRUNCATED]'
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactSummary(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) items.push('[TRUNCATED]')
    return items
  }
  if (typeof value !== 'object') return '[OMITTED]'

  const output: Record<string, unknown> = {}
  const entries = Object.entries(value).slice(0, MAX_OBJECT_FIELDS)
  for (const [key, item] of entries) {
    output[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : redactSummary(item, depth + 1)
  }
  if (Object.keys(value).length > MAX_OBJECT_FIELDS) output._truncated = true
  return output
}

function entityKey(entity: AuditEntityReference): string {
  return `${entity.type}:${entity.id}`
}

function unique<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

const ACTION_DESCRIPTION: Readonly<Record<AuditEventRow['action'], string>> = {
  create: 'criou',
  update: 'atualizou',
  transition: 'alterou o status de',
  duplicate: 'duplicou',
}

function describeActivity(
  event: AuditEventRow,
  actorName: string,
  entityName: string | undefined,
): string {
  const target = entityName ? `o orçamento ${entityName}` : 'um orçamento'
  return `${actorName} ${ACTION_DESCRIPTION[event.action]} ${target}.`
}

function invalidFilter(error: z.ZodError): { ok: false; error: AuditActivityError } {
  return {
    ok: false,
    error: {
      code: 'INVALID_FILTER',
      status: 400,
      message: 'Os filtros de auditoria são inválidos.',
      issues: error.issues.map((issue) => ({
        path: issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)),
        message: issue.message,
      })),
    },
  }
}

export function createAuditActivityQuery(dependencies: QueryDependencies) {
  return async (input: unknown) => {
    // Authorization belongs to this callable boundary and runs on every invocation.
    const requester = await dependencies.authenticate()
    if (!requester) {
      return {
        ok: false as const,
        error: {
          code: 'UNAUTHENTICATED' as const,
          status: 401 as const,
          message: 'Autenticação necessária.',
        },
      }
    }
    if (requester.role !== 'admin') {
      return {
        ok: false as const,
        error: {
          code: 'FORBIDDEN' as const,
          status: 403 as const,
          message: 'Apenas administradores podem consultar a auditoria.',
        },
      }
    }

    const parsed = auditActivityRequestSchema.safeParse(input)
    if (!parsed.success) return invalidFilter(parsed.error)

    let cursor: AuditActivityRepositoryQuery['cursor'] = null
    if (parsed.data.cursor) {
      const decoded = cursorCodec.decode(parsed.data.cursor)
      if (!decoded.ok) {
        return invalidFilter(
          new z.ZodError([
            { code: 'custom', path: ['cursor'], message: 'Cursor de auditoria inválido.' },
          ]),
        )
      }
      cursor = decoded.data
    }

    const rows = await dependencies.repository.listEvents({
      limit: parsed.data.limit + 1,
      cursor,
      filters: parsed.data.filters,
      orderBy: ['occurredAt:desc', 'id:desc'],
    })
    const page = rows.slice(0, parsed.data.limit)
    const actorIds = [...new Set(page.map((event) => event.actorId))]
    const entities = unique(page.map((event) => event.entity), entityKey)

    // These fixed-count batch calls prevent per-event actor/entity lookups.
    const [actors, authorizedEntityKeys] = await Promise.all([
      dependencies.repository.loadActorMetadata(actorIds),
      dependencies.authorizeEntities(requester, entities),
    ])
    const authorizedEntities = entities.filter((entity) =>
      authorizedEntityKeys.has(entityKey(entity)),
    )
    const entityMetadata = await dependencies.repository.loadEntityMetadata(authorizedEntities)

    const items = page.map((event) => {
      const key = entityKey(event.entity)
      const actorName = actors.get(event.actorId) ?? 'Usuário do sistema'
      const displayName = authorizedEntityKeys.has(key)
        ? entityMetadata.get(key)
        : undefined
      const entity = displayName
        ? {
            ...event.entity,
            displayName,
            href: `/app/orcamentos/${event.entity.id}`,
          }
        : event.entity

      return {
        id: event.id,
        occurredAt: event.occurredAt.toISOString(),
        correlationId: event.correlationId,
        action: event.action,
        actor: { id: event.actorId, displayName: actorName },
        entity,
        description: describeActivity(event, actorName, displayName),
        before: redactSummary(event.before),
        after: redactSummary(event.after),
      }
    })
    const last = page.at(-1)
    const nextCursor = rows.length > parsed.data.limit && last
      ? cursorCodec.encode({ occurredAt: last.occurredAt.toISOString(), id: last.id })
      : null

    return { ok: true as const, data: { items, nextCursor } }
  }
}