import { logUnexpectedError } from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  ForbiddenError,
  UnauthenticatedError,
} from '@/lib/auth/authorization.server'
import { requireCommercialContext } from '@/lib/auth/commercial-scope.server'
import { getDatabase } from '@/lib/db/database.server'
import { parseRequest } from '@/lib/server/request.schema'
import {
  failure,
  success,
  type Result,
} from '@/lib/domain/result'
// Type-only: fully erased before the client bundle, so the TanStack Start
// import-protection plugin never sees this .server module.
import type { loadPostgresReportMetrics } from './report-metrics.server'
import { buildSalesReportPage, type SalesReportPage } from './report-page'

/**
 * Authorized sales-report page endpoint. The handler re-derives the actor's
 * session from the request cookie through the centralized matrix, then the
 * metric scope (role + representative allowlist) server-side, loads the
 * canonical snapshot through `loadPostgresReportMetrics`, and projects one
 * bounded page. The client never receives rows outside its scope and never
 * receives the full dataset: the request contract caps pages at
 * `MAX_REPORT_PAGE_SIZE` and the projection slices server-side.
 */

const groupingSchema = z.enum(['clientes', 'produtos', 'industrias'])

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const reportStatusSchema = z.enum([
  'open',
  'confirmed',
  'invoiced',
  'completed',
  'cancelled',
])

export const reportPageInputSchema = z.strictObject({
  grouping: groupingSchema,
  offset: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(50),
  sort: z
    .strictObject({ id: z.string().min(1).max(40), direction: z.enum(['asc', 'desc']) })
    .nullable(),
  filters: z.strictObject({
    from: isoDateSchema,
    to: isoDateSchema,
    statuses: z.array(reportStatusSchema),
    representativeIds: z.array(z.string().min(1)).max(50),
  }),
})

export type ReportPagePublicError =
  | Readonly<{
      code: 'VALIDATION_FAILED'
      status: 400
      message: 'Os dados informados são inválidos.'
      issues: ReadonlyArray<Readonly<{ path: readonly (string | number)[]; message: string }>>
    }>
  | Readonly<{ code: 'UNAUTHENTICATED'; status: 401; message: 'Autenticação necessária.' }>
  | Readonly<{ code: 'FORBIDDEN'; status: 403; message: 'Você não tem permissão para acessar este relatório.' }>
  | Readonly<{ code: 'INTERNAL_ERROR'; status: 500; message: 'Não foi possível concluir a operação.' }>

export type ReportPageResult = Result<SalesReportPage, ReportPagePublicError>

export type ReportActorScope = Readonly<{
  role: 'admin' | 'representative' | 'read_only'
  /** Representative id when the actor IS a representative. */
  actorRepresentativeId: string | null
  /**
   * Representatives whose data this actor may read. Empty for admins (all)
   * and representatives (implicit self-scope).
   */
  readableRepresentativeIds: readonly string[]
}>

export type ReportPageServiceInput = Readonly<{
  grouping: 'clientes' | 'produtos' | 'industrias'
  offset: number
  limit: number
  sort: { id: string; direction: 'asc' | 'desc' } | null
  filters: {
    from: string
    to: string
    statuses: readonly string[]
    representativeIds: readonly string[]
  }
}>

export type ReportDataServiceContract = Readonly<{
  loadPage: (
    scope: ReportActorScope,
    input: ReportPageServiceInput,
  ) => Promise<Result<SalesReportPage, ReportPagePublicError>>
}>

const BUSINESS_TIME_ZONE = 'America/Fortaleza'

export const REPORT_BUSINESS_TIME_ZONE = BUSINESS_TIME_ZONE

function forbidden(): ReportPagePublicError {
  return {
    code: 'FORBIDDEN',
    status: 403,
    message: 'Você não tem permissão para acessar este relatório.',
  }
}

/**
 * Validates the URL's representative selection against the actor scope before
 * any query runs. Admins may narrow freely; representatives may only select
 * themselves; read_only actors may only narrow inside their assigned set.
 */
export function resolveRequestedRepresentatives(
  scope: ReportActorScope,
  requested: readonly string[],
): Result<string[], ReportPagePublicError> {
  if (requested.length === 0) return success([])
  if (scope.role === 'representative') {
    const self = scope.actorRepresentativeId ?? ''
    return requested.every((id) => id === self)
      ? success([self])
      : failure(forbidden())
  }
  if (scope.role === 'read_only') {
    const allowed = new Set(scope.readableRepresentativeIds)
    return requested.every((id) => allowed.has(id))
      ? success([...requested])
      : failure(forbidden())
  }
  return success([...requested])
}

/**
 * Intersects the URL's representative selection into the actor's readable
 * scope. Export endpoints reuse this verbatim so a download can never widen
 * what the on-screen page would show.
 */
export function narrowReportScope(
  scope: ReportActorScope,
  representatives: readonly string[],
): ReportActorScope {
  if (representatives.length === 0 || scope.role === 'representative') return scope
  return {
    ...scope,
    readableRepresentativeIds:
      scope.role === 'admin'
        ? [...representatives]
        : scope.readableRepresentativeIds.filter((id) =>
            representatives.includes(id),
          ),
  }
}

export function buildMetricRequest(
  scope: ReportActorScope,
  filters: ReportPageServiceInput['filters'],
): Parameters<typeof loadPostgresReportMetrics>[1]['request'] {
  return {
    from: filters.from,
    to: filters.to,
    asOf: filters.to,
    inactiveDays: 1,
    timeZone: BUSINESS_TIME_ZONE,
    role: scope.role,
    actorRepresentativeId:
      scope.role === 'representative' ? scope.actorRepresentativeId : null,
    explicitlyAssignedRepresentativeIds:
      scope.role === 'read_only'
        ? [...scope.readableRepresentativeIds]
        : [],
    statuses: [...filters.statuses] as (
      | 'open'
      | 'confirmed'
      | 'invoiced'
      | 'completed'
      | 'cancelled'
    )[],
  }
}

export function createReportDataOperations(dependencies: Readonly<{
  getDatabase: () => Promise<Parameters<typeof loadPostgresReportMetrics>[0]>
  logUnexpectedError: (cause: unknown) => void
}>): ReportDataServiceContract {
  return Object.freeze({
    async loadPage(scope, input) {
      try {
        const representatives = resolveRequestedRepresentatives(
          scope,
          input.filters.representativeIds,
        )
        if (!representatives.ok) return representatives

        // Representative narrowing composes with the role scope by intersecting
        // the URL selection into the actor's readable set before any query.
        const narrowedScope = narrowReportScope(scope, representatives.data)

        if (
          narrowedScope.role === 'read_only' &&
          narrowedScope.readableRepresentativeIds.length === 0
        ) {
          return success({
            grouping: input.grouping,
            rows: [],
            rowCount: 0,
            pageSubtotals: [],
            overallTotals: [],
            overallCommissionTotals: null,
          })
        }

        const database = await dependencies.getDatabase()
        const { loadPostgresReportMetrics } = await import('./report-metrics.server')
        const snapshot = await loadPostgresReportMetrics(database, {
          clients: [],
          request: buildMetricRequest(narrowedScope, input.filters),
        })

        return success(
          buildSalesReportPage(snapshot, {
            grouping: input.grouping,
            offset: input.offset,
            limit: input.limit,
            sort: input.sort,
            filters: {
              from: input.filters.from,
              to: input.filters.to,
              statuses: [...input.filters.statuses],
              representativeIds: [...input.filters.representativeIds],
            },
          }),
        )
      } catch (cause) {
        dependencies.logUnexpectedError(cause)
        return failure<ReportPagePublicError>({
          code: 'INTERNAL_ERROR',
          status: 500,
          message: 'Não foi possível concluir a operação.',
        })
      }
    },
  })
}

async function getReportDatabase() {
  return getDatabase()
}

const reportOperations = createReportDataOperations({
  getDatabase: getReportDatabase,
  logUnexpectedError: (cause) => {
    logUnexpectedError('report.page', cause)
  },
})

const acceptUnknownInput = (input: unknown) => input

/**
 * Resolves the caller from the request cookie through the centralized
 * matrix. Reports are an order-domain read (`order.view`); per-role row
 * narrowing happens in `resolveRequestedRepresentatives` /
 * `narrowReportScope` before any query runs.
 */
async function authenticate(): Promise<ReportActorScope | null> {
  try {
    const context = await requireCommercialContext('order', 'order.view')
    return {
      role: context.session.role,
      actorRepresentativeId:
        context.session.role === 'representative' ? context.session.id : null,
      // read_only assignment resolution joins commercial_resource_assignments
      // at the metrics layer; empty here means "no rows", never "all rows".
      readableRepresentativeIds:
        context.session.role === 'read_only'
          ? await loadReadableReportRepresentatives(context)
          : [],
    }
  } catch (cause) {
    if (cause instanceof ForbiddenError || cause instanceof UnauthenticatedError) {
      return null
    }
    throw cause
  }
}

/** Explicit representative assignments for read_only actors. */
async function loadReadableReportRepresentatives(
  context: Awaited<ReturnType<typeof requireCommercialContext>>,
): Promise<readonly string[]> {
  const { getDatabase } = await import('@/lib/db/database.server')
  const { loadAssignedOrderOwners } = await import(
    '@/features/app/reports/report-assignments.server'
  )
  try {
    return await loadAssignedOrderOwners(await getDatabase(), context.session.id)
  } catch (cause) {
    logUnexpectedError('report.page', cause)
    return []
  }
}

export const loadReportPage = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }): Promise<ReportPageResult> => {
    const parsed = parseRequest(reportPageInputSchema, data)
    if (!parsed.ok) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          status: 400,
          message: 'Os dados informados são inválidos.',
          issues: parsed.error.issues.map(({ path, message }) => ({
            path,
            message,
          })),
        },
      }
    }

    const scope = await authenticate()
    if (!scope) {
      return {
        ok: false,
        error: {
          code: 'UNAUTHENTICATED',
          status: 401,
          message: 'Autenticação necessária.',
        },
      }
    }

    return reportOperations.loadPage(scope, parsed.data)
  })
