import {
  logStructuredEvent,
  logUnexpectedError,
} from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDatabase } from '@/lib/db/database.server'
import { parseRequest } from '@/lib/server/request.schema'
import {
  DENIAL_MESSAGES,
  ForbiddenError,
  UnauthenticatedError,
} from '@/lib/auth/authorization.server'
import { requireCommercialContext } from '@/lib/auth/commercial-scope.server'
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
 * Every call re-derives the session server-side through the centralized
 * capability matrix. PHASE 1 POSTURE: `export.customers` / `export.quotes` /
 * `export.orders` are cataloged but granted to NOBODY (matrix §11), so every
 * authenticated caller receives the fixed pt-BR FORBIDDEN denial and
 * anonymous callers receive UNAUTHENTICATED. The endpoints exist as the
 * single sanctioned surface for the Phase 2 grant; the request contract
 * accepts only canonical identifiers — report id enum, ISO dates, status
 * enum, representative UUIDs.
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

/**
 * Resolves the caller from the request cookie. Returns null for anonymous
 * callers (→ public UNAUTHENTICATED). The capability check happens in the
 * handlers via `requireExportCapability`, which currently denies every role
 * because Phase 1 grants no export capability.
 */
async function authenticate(): Promise<(ReportActorScope & { id: string }) | null> {
  try {
    const context = await requireCommercialContext('order', 'order.view')
    return {
      id: context.session.id,
      role: context.session.role,
      actorRepresentativeId:
        context.session.role === 'representative' ? context.session.id : null,
      readableRepresentativeIds: [],
    }
  } catch (cause) {
    if (cause instanceof ForbiddenError || cause instanceof UnauthenticatedError) {
      return null
    }
    throw cause
  }
}

/**
 * Export capabilities are cataloged but granted to nobody in Phase 1, so
 * this throws ForbiddenError (fixed pt-BR) for every authenticated caller.
 * When Phase 2 grants exports, flip the capability here — nowhere else.
 */
async function requireExportCapability(
  _capability: 'export.customers' | 'export.quotes' | 'export.orders',
): Promise<never> {
  // Kept symbolic: authorize(role, 'export.*') is false for all roles today.
  void _capability
  throw new ForbiddenError()
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
  // The export operations' own authenticate seam: the Phase 1 capability
  // denial above means this is never reached with a live scope, but it stays
  // wired so the Phase 2 grant flips on in exactly one place.
  authenticate: () => null,
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

    const scope = await authenticate()
    if (!scope) {
      return {
        ok: false,
        error: { code: 'UNAUTHENTICATED', status: 401, message: 'Autenticação necessária.' },
      }
    }

    // Phase 1: no role holds an export capability — always denied (fixed pt-BR).
    try {
      await requireExportCapability('export.orders')
    } catch (cause) {
      if (cause instanceof ForbiddenError) {
        logStructuredEvent({
          kind: 'audit',
          action: 'report.export.denied',
          actorId: scope.id,
          reportId: parsed.data.reportId,
          outcome: 'forbidden',
          occurredAt: new Date().toISOString(),
        })
        return {
          ok: false,
          error: { code: 'FORBIDDEN', status: 403, message: DENIAL_MESSAGES.FORBIDDEN },
        }
      }
      throw cause
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

    const scope = await authenticate()
    if (!scope) {
      return {
        ok: false,
        error: { code: 'UNAUTHENTICATED', status: 401, message: 'Autenticação necessária.' },
      }
    }

    // Phase 1: no role holds an export capability — always denied (fixed pt-BR).
    try {
      await requireExportCapability('export.quotes')
    } catch (cause) {
      if (cause instanceof ForbiddenError) {
        logStructuredEvent({
          kind: 'audit',
          action: 'report.export.denied',
          actorId: scope.id,
          reportId: 'comissoes',
          outcome: 'forbidden',
          occurredAt: new Date().toISOString(),
        })
        return {
          ok: false,
          error: { code: 'FORBIDDEN', status: 403, message: DENIAL_MESSAGES.FORBIDDEN },
        }
      }
      throw cause
    }

    return exportOperations.exportCommissionsReport(scope, parsed.data)
  })

export { REPORT_EXPORT_MIME_TYPE }
