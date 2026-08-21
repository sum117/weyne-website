import { logUnexpectedError } from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import type { CommercialActor } from '@/lib/orders/security-policy.server'
import {
  CommissionRequestError,
  normalizeCommissionRequest,
  type CommissionPage,
} from './commission-report'

/**
 * Authorized commissions report endpoint for `/app/relatorios?tab=comissoes`.
 *
 * Authorization is re-evaluated server-side on every call; the UI never
 * decides it. Authentication fails closed until the authenticated app session
 * adapter is connected (same posture as the order/carrier functions). The
 * request is bounded by `normalizeCommissionRequest` — a caller cannot ask
 * for the full dataset.
 *
 * All server-only work stays lexically inside the `.handler` callback so the
 * TanStack Start compiler can strip it from the client bundle (RPC bridge);
 * importing `.server` modules outside the handler breaks the client build.
 */

export type CommissionReportError =
  | Readonly<{ code: 'UNAUTHENTICATED'; status: 401; message: 'Autenticação necessária.' }>
  | Readonly<{ code: 'FORBIDDEN'; status: 403; message: 'Você não tem permissão para acessar este relatório.' }>
  | Readonly<{ code: 'VALIDATION_FAILED'; status: 400; message: 'Os filtros do relatório são inválidos.' }>
  | Readonly<{ code: 'INTERNAL_ERROR'; status: 500; message: 'Não foi possível concluir a operação.' }>

export type CommissionReportResult =
  | Readonly<{ ok: true; data: CommissionPage }>
  | Readonly<{ ok: false; error: CommissionReportError }>

/**
 * Role projection for the report request. Mirrors the canonical metric owner
 * predicate: representatives see their own quotes; read-only users see only
 * explicitly assigned representatives and never commission values.
 */
export function projectReportRequest(actor: CommercialActor): Readonly<{
  role: 'admin' | 'representative' | 'read_only'
  actorRepresentativeId: string | null
  explicitlyAssignedRepresentativeIds: readonly string[]
}> {
  if (actor.role === 'admin') {
    return {
      role: 'admin',
      actorRepresentativeId: null,
      explicitlyAssignedRepresentativeIds: [],
    }
  }
  if (actor.role === 'representative') {
    return {
      role: 'representative',
      actorRepresentativeId: actor.id,
      explicitlyAssignedRepresentativeIds: [],
    }
  }
  return {
    role: 'read_only',
    actorRepresentativeId: null,
    // Assignment resolution joins the shared commercial RBAC surface at the
    // call site once the session adapter lands; until then read-only actors
    // resolve to an empty scope (no rows, no unauthorized data).
    explicitlyAssignedRepresentativeIds: [],
  }
}

/** Fails closed until the authenticated session adapter exists. */
function authenticate(): CommercialActor | null {
  return null
}

const acceptUnknownInput = (input: unknown) => input

export const getCommissionReport = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }): Promise<CommissionReportResult> => {
    // Server-only imports live here, inside the handler, so the client
    // bundle never pulls the database or the SQL layer.
    const { getDatabase } = await import('@/lib/db/database.server')
    const { loadCommissionPage } = await import('./commission-report.server')

    const actor = authenticate()
    if (!actor) {
      return {
        ok: false,
        error: { code: 'UNAUTHENTICATED', status: 401, message: 'Autenticação necessária.' },
      }
    }

    try {
      const raw = (data ?? {}) as Record<string, unknown>
      const projected = projectReportRequest(actor)
      const request = normalizeCommissionRequest({
        offset: Number(raw.offset ?? 0),
        limit: Number(raw.limit ?? 20),
        sort: (raw.sort ?? null) as Parameters<typeof normalizeCommissionRequest>[0]['sort'],
        from: String(raw.from ?? ''),
        to: String(raw.to ?? ''),
        timeZone: String(raw.timeZone ?? 'America/Fortaleza'),
        statuses: Array.isArray(raw.statuses) ? (raw.statuses as string[]) : [],
        representativeIds: Array.isArray(raw.representativeIds)
          ? (raw.representativeIds as string[])
          : [],
        role: projected.role,
        actorRepresentativeId: projected.actorRepresentativeId,
        explicitlyAssignedRepresentativeIds: [
          ...projected.explicitlyAssignedRepresentativeIds,
        ],
      })
      const database = await getDatabase()
      const pageData = await loadCommissionPage(database, request)
      return { ok: true, data: pageData }
    } catch (cause) {
      if (cause instanceof CommissionRequestError) {
        return {
          ok: false,
          error: {
            code: 'VALIDATION_FAILED',
            status: 400,
            message: 'Os filtros do relatório são inválidos.',
          },
        }
      }
      logUnexpectedError('commission-report', cause)
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          status: 500,
          message: 'Não foi possível concluir a operação.',
        },
      }
    }
  })
