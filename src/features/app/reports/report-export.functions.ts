import {
  logStructuredEvent,
  logUnexpectedError,
} from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDatabase } from '@/lib/db/database.server'
import { parseRequest } from '@/lib/server/request.schema'
import {
  createReportExportOperations,
  REPORT_EXPORT_MIME_TYPE,
  type ReportExportOutcome,
} from './report-export.server'
import { isExportableReportId } from './report-export'
import type { ReportActorScope } from './report.functions'

/**
 * Authorized report export endpoints for `/app/relatorios`.
 *
 * One endpoint per approved report family (sales groupings + commissions).
 * Every call re-derives the actor scope server-side; the request contract
 * accepts only canonical identifiers — report id enum, ISO dates, status
 * enum, representative UUIDs. Authentication fails closed until the
 * authenticated app session adapter is connected, matching the established
 * posture of `report.functions.ts` and the quote PDF endpoints.
 */

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const salesReportExportInputSchema = z.strictObject({
  reportId: z.enum(['clientes', 'produtos', 'industrias']),
  filters: z.strictObject({
    from: isoDateSchema,
    to: isoDateSchema,
    statuses: z.array(
      z.enum(['open', 'confirmed', 'invoiced', 'completed', 'cancelled']),
    ),
    representativeIds: z.array(z.string().min(1)).max(50),
  }),
})

export const commissionsExportInputSchema = z.strictObject({
  sort: z
    .strictObject({
      id: z.enum(['representative', 'orders', 'sales', 'commission']),
      direction: z.enum(['asc', 'desc']),
    })
    .nullable(),
  filters: z.strictObject({
    from: isoDateSchema,
    to: isoDateSchema,
    statuses: z.array(
      z.enum(['open', 'confirmed', 'invoiced', 'completed', 'cancelled']),
    ),
    representativeIds: z.array(z.string().min(1)).max(50),
  }),
})

/** Fails closed until the authenticated session adapter exists. */
function authenticate(): (ReportActorScope & { id: string }) | null {
  return null
}

function consoleAuditSink() {
  return {
    async append(event: {
      action: string
      actorId: string
      reportId: string
      period: unknown
      filters: unknown
      occurredAt: Date
      outcome: string
      detail?: string
    }) {
      // Actor, report id, normalized filters/period, timestamp, outcome.
      // No row data, no customer names, no amounts.
      logStructuredEvent({
        kind: 'audit',
        action: event.action,
        actorId: event.actorId,
        reportId: event.reportId,
        period: event.period,
        filters: event.filters,
        outcome: event.outcome,
        ...(event.detail ? { detail: event.detail } : {}),
        occurredAt: event.occurredAt.toISOString(),
      })
    },
  }
}

const exportOperations = createReportExportOperations({
  getDatabase,
  authenticate,
  audit: consoleAuditSink(),
  logUnexpectedError: (cause) => {
    logUnexpectedError('report-export', cause)
  },
})

const acceptUnknownInput = (input: unknown) => input

type ExportValidationFailed = Readonly<{
  ok: false
  error: Readonly<{
    code: 'VALIDATION_FAILED'
    status: 400
    message: string
    issues: readonly Readonly<{ path: readonly (string | number)[]; message: string }>[]
  }>
}>

function validationError(issues: readonly Readonly<{
  path: readonly (string | number)[]
  message: string
}>[]): ExportValidationFailed {
  return {
    ok: false,
    error: {
      code: 'VALIDATION_FAILED',
      status: 400,
      message: 'Os filtros de exportação são inválidos.',
      issues,
    },
  }
}

export const exportSalesReport = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }): Promise<ReportExportOutcome | ExportValidationFailed> => {
    const parsed = parseRequest(salesReportExportInputSchema, data)
    if (!parsed.ok) {
      return validationError(
        parsed.error.issues.map(({ path, message }) => ({ path, message })),
      )
    }

    if (!isExportableReportId(parsed.data.reportId)) {
      return validationError([
        { path: ['reportId'], message: 'Relatório de exportação inválido.' },
      ])
    }

    const scope = authenticate()
    if (!scope) {
      return {
        ok: false,
        error: { code: 'UNAUTHENTICATED', status: 401, message: 'Autenticação necessária.' },
      }
    }

    return exportOperations.exportSalesReport(scope, parsed.data)
  })

export const exportCommissionsReport = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }): Promise<ReportExportOutcome | ExportValidationFailed> => {
    const parsed = parseRequest(commissionsExportInputSchema, data)
    if (!parsed.ok) {
      return validationError(
        parsed.error.issues.map(({ path, message }) => ({ path, message })),
      )
    }

    const scope = authenticate()
    if (!scope) {
      return {
        ok: false,
        error: { code: 'UNAUTHENTICATED', status: 401, message: 'Autenticação necessária.' },
      }
    }

    return exportOperations.exportCommissionsReport(scope, parsed.data)
  })

export { REPORT_EXPORT_MIME_TYPE }
