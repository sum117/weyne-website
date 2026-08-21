import {
  generateReportWorkbook,
  ReportWorkbookError,
  type GeneratedReportWorkbook,
} from '@/lib/reports/workbook.server'
import { loadCommissionPage } from './commission-report.server'
import { normalizeCommissionRequest } from './commission-report'
import type { CommissionPage } from './commission-report'
import type { Database } from '@/lib/db/database.server'
import {
  buildMetricRequest,
  narrowReportScope,
  resolveRequestedRepresentatives,
  type ReportActorScope,
  type ReportPageServiceInput,
} from './report.functions'
import { loadPostgresReportMetrics } from './report-metrics.server'
import {
  buildSalesReportPage,
  type SalesReportGrouping,
  type SalesReportPage,
} from './report-page'
import { MAX_REPORT_PAGE_SIZE } from './report-state'
import {
  buildReportExportFileName,
  buildReportExportFilters,
  mapWorkbookFailure,
  planCommissionReportWorkbook,
  planSalesReportWorkbook,
  reportExportError,
  type ExportableReportId,
  type ReportExportPublicError,
} from './report-export'

/**
 * Server-side export operations for the approved `/app/relatorios` reports.
 *
 * Authorization is re-derived on every call from the actor scope (role +
 * representative allowlist) using the exact helpers the on-screen page uses;
 * a direct endpoint call can never widen what the screen would render. The
 * data path is the canonical one: `loadPostgresReportMetrics` →
 * `buildSalesReportPage` for sales reports, `loadCommissionPage` for
 * commissions. Only then is the workbook generated through the bounded
 * generator (`workbook.server.ts`), which owns row/column/byte/time limits
 * and partial-resource cleanup.
 *
 * Audit: every attempt (success or failure) records actor, report id,
 * normalized filters/period, timestamp, and outcome via the audit sink. No
 * sensitive row data ever reaches the audit payload.
 */

export type ReportExportOutcome =
  | Readonly<{
      ok: true
      file: Readonly<{
        base64: string
        filename: string
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        rowCount: number
      }>
    }>
  | Readonly<{ ok: false; error: ReportExportPublicError }>

export interface ReportExportAuditSink {
  append(event: ReportExportAuditEvent): Promise<void>
}

export type ReportExportAuditEvent = Readonly<{
  action: 'report.export'
  /** Actor id when authenticated; 'anonymous' records rejected attempts. */
  actorId: string
  reportId: ExportableReportId | string
  period: Readonly<{ from: string; to: string }> | null
  filters: Readonly<{
    statuses: readonly string[]
    representativeIds: readonly string[]
  }> | null
  occurredAt: Date
  outcome:
    | 'succeeded'
    | 'forbidden'
    | 'unauthenticated'
    | 'validation_failed'
    | 'limit_exceeded'
    | 'failed'
  detail?: string
}>

export type ReportExportDependencies = Readonly<{
  getDatabase: () => Promise<Database>
  authenticate: () => ReportActorScope & { id: string } | null
  generateWorkbook?: typeof generateReportWorkbook
  audit: ReportExportAuditSink
  logUnexpectedError: (cause: unknown) => void
  now?: () => Date
}>

export const REPORT_EXPORT_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' as const

type SalesExportRequest = Readonly<{
  reportId: SalesReportGrouping
  filters: ReportPageServiceInput['filters']
}>

type CommissionExportRequest = Readonly<{
  filters: Omit<ReportPageServiceInput['filters'], 'statuses'> & {
    statuses: readonly string[]
  }
  sort: { id: string; direction: 'asc' | 'desc' } | null
}>

/** Mutable accumulator for canonical sales rows inside the export walker. */
type SalesSheetRowSource = SalesReportPage['rows'][number]

/**
 * Walks the canonical projection page by page under the same scope and
 * filters as the screen until exhausted. Each page goes through
 * `buildSalesReportPage`, so ordering and row meaning are byte-identical to
 * the UI; the loop is bounded by the snapshot's own source cap
 * (MAX_METRIC_SOURCE_ORDERS) plus the workbook's row limit.
 */
async function loadAllSalesRows(
  database: Database,
  scope: ReportActorScope,
  request: SalesExportRequest,
): Promise<SalesSheetRowSource[]> {
  const narrowed = narrowReportScope(scope, request.filters.representativeIds)
  if (narrowed.role === 'read_only' && narrowed.readableRepresentativeIds.length === 0) {
    return []
  }
  const filters = {
    from: request.filters.from,
    to: request.filters.to,
    statuses: [...request.filters.statuses],
    representativeIds: [...request.filters.representativeIds],
  }
  // The canonical snapshot is deterministic for fixed filters, so loading it
  // once per page window is safe; pages advance by offset.
  let snapshot: Awaited<ReturnType<typeof loadPostgresReportMetrics>> | null = null
  const rows: SalesSheetRowSource[] = []
  for (let offset = 0; ; offset += MAX_REPORT_PAGE_SIZE) {
    if (!snapshot) {
      snapshot = await loadPostgresReportMetrics(database, {
        clients: [],
        request: buildMetricRequest(narrowed, request.filters),
      })
    }
    const page = buildSalesReportPage(snapshot, {
      grouping: request.reportId,
      offset,
      limit: MAX_REPORT_PAGE_SIZE,
      sort: null,
      filters,
    })
    rows.push(...page.rows)
    if (rows.length >= page.rowCount || page.rows.length === 0) break
  }
  return rows
}

async function loadCommissionExportRows(
  database: Database,
  scope: ReportActorScope & { id: string },
  request: CommissionExportRequest,
): Promise<CommissionPage> {
  const normalized = normalizeCommissionRequest({
    offset: 0,
    limit: MAX_REPORT_PAGE_SIZE,
    sort: request.sort as Parameters<typeof normalizeCommissionRequest>[0]['sort'],
    from: request.filters.from,
    to: request.filters.to,
    timeZone: 'America/Fortaleza',
    statuses: [...request.filters.statuses],
    representativeIds: [...request.filters.representativeIds],
    role: scope.role,
    actorRepresentativeId:
      scope.role === 'representative' ? (scope.actorRepresentativeId ?? '') : null,
    explicitlyAssignedRepresentativeIds:
      scope.role === 'read_only' ? [...scope.readableRepresentativeIds] : [],
  })

  const firstPage = await loadCommissionPage(database, normalized)
  const rows = [...firstPage.rows]
  const totalRows = firstPage.totalRows
  for (
    let offset = normalized.limit;
    rows.length < totalRows;
    offset += normalized.limit
  ) {
    const nextPage = await loadCommissionPage(database, {
      ...normalized,
      offset,
    })
    rows.push(...nextPage.rows)
  }
  return { ...firstPage, rows }
}

async function audit(
  dependencies: ReportExportDependencies,
  event: ReportExportAuditEvent,
): Promise<void> {
  try {
    await dependencies.audit.append(event)
  } catch (cause) {
    dependencies.logUnexpectedError(cause)
  }
}

export function createReportExportOperations(dependencies: ReportExportDependencies) {
  const now = dependencies.now ?? (() => new Date())

  async function run(input: Readonly<{
    actorId: string | null
    scope: ReportActorScope | null
    reportId: ExportableReportId | string
    salesRequest?: SalesExportRequest
    commissionRequest?: CommissionExportRequest
  }>): Promise<ReportExportOutcome> {
    const filters = input.salesRequest?.filters ?? input.commissionRequest?.filters ?? null
    const auditBase = {
      action: 'report.export' as const,
      actorId: input.actorId ?? 'anonymous',
      reportId: input.reportId,
      period: filters ? { from: filters.from, to: filters.to } : null,
      filters: filters
        ? {
            statuses: [...filters.statuses],
            representativeIds: [...filters.representativeIds],
          }
        : null,
      occurredAt: now(),
    }

    if (!input.scope || !input.actorId) {
      await audit(dependencies, { ...auditBase, outcome: 'unauthenticated' })
      return { ok: false as const, error: reportExportError('UNAUTHENTICATED') }
    }

    const scope = input.scope
    const requested = filters?.representativeIds ?? []
    const representatives = resolveRequestedRepresentatives(scope, requested)
    if (!representatives.ok) {
      await audit(dependencies, { ...auditBase, outcome: 'forbidden' })
      return { ok: false as const, error: reportExportError('FORBIDDEN') }
    }

    try {
      const database = await dependencies.getDatabase()
      let plan
      if (input.salesRequest) {
        const rows = await loadAllSalesRows(database, scope, input.salesRequest)
        plan = planSalesReportWorkbook({
          reportId: input.salesRequest.reportId,
          page: {
            grouping: input.salesRequest.reportId,
            rows,
            rowCount: rows.length,
            pageSubtotals: [],
            overallTotals: [],
            overallCommissionTotals: null,
          },
          period: { from: input.salesRequest.filters.from, to: input.salesRequest.filters.to },
          filters: buildReportExportFilters({
            statuses: input.salesRequest.filters.statuses,
            representativeIds: representatives.data,
          }),
        })
      } else if (input.commissionRequest) {
        const page = await loadCommissionExportRows(
          database,
          { ...scope, id: input.actorId },
          input.commissionRequest,
        )
        plan = planCommissionReportWorkbook({
          page,
          period: {
            from: input.commissionRequest.filters.from,
            to: input.commissionRequest.filters.to,
          },
          filters: buildReportExportFilters({
            statuses: input.commissionRequest.filters.statuses,
            representativeIds: representatives.data,
          }),
        })
      } else {
        throw new TypeError('report export requires a request payload')
      }

      const generate = dependencies.generateWorkbook ?? generateReportWorkbook
      let workbook: GeneratedReportWorkbook
      try {
        // Each plan variant is independently a valid workbook definition; the
        // union only exists because this endpoint serves two report families.
        workbook = await generate(plan as Parameters<typeof generateReportWorkbook>[0])
      } catch (cause) {
        if (cause instanceof ReportWorkbookError) {
          await audit(dependencies, {
            ...auditBase,
            outcome: cause.code === 'INVALID_DEFINITION' || cause.code === 'INVALID_CELL_VALUE'
              ? 'failed'
              : 'limit_exceeded',
            detail: cause.code,
          })
          return {
            ok: false as const,
            error: reportExportError(mapWorkbookFailure(cause.code)),
          }
        }
        throw cause
      }

      await audit(dependencies, {
        ...auditBase,
        outcome: 'succeeded',
        detail: `rows=${workbook.rowCount};bytes=${workbook.buffer.byteLength}`,
      })

      return {
        ok: true as const,
        file: {
          base64: workbook.buffer.toString('base64'),
          filename: buildReportExportFileName(
            input.reportId as ExportableReportId,
            { from: filters!.from, to: filters!.to },
          ),
          contentType: REPORT_EXPORT_MIME_TYPE,
          rowCount: workbook.rowCount,
        },
      }
    } catch (cause) {
      dependencies.logUnexpectedError(cause)
      await audit(dependencies, { ...auditBase, outcome: 'failed' })
      return { ok: false as const, error: reportExportError('INTERNAL_ERROR') }
    }
  }

  return Object.freeze({
    exportSalesReport(
      scope: (ReportActorScope & { id: string }) | null,
      request: SalesExportRequest,
    ) {
      if (!scope) return run({ actorId: null, scope: null, reportId: request.reportId, salesRequest: request })
      return run({ actorId: scope.id, scope, reportId: request.reportId, salesRequest: request })
    },
    exportCommissionsReport(
      scope: (ReportActorScope & { id: string }) | null,
      request: CommissionExportRequest,
    ) {
      if (!scope) {
        return run({ actorId: null, scope: null, reportId: 'comissoes', commissionRequest: request })
      }
      return run({
        actorId: scope.id,
        scope,
        reportId: 'comissoes',
        commissionRequest: request,
      })
    },
  })
}
