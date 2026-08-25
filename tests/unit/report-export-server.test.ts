import { describe, expect, it } from 'vitest'
import {
  createReportExportOperations,
  type ReportExportAuditEvent,
} from '@/features/app/reports/report-export.server'
import { ReportWorkbookError } from '@/lib/reports/workbook.server'
import type { ReportActorScope } from '@/features/app/reports/report.functions'
import type { Database } from '@/lib/db/database.server'

/**
 * The server operations are exercised with an injected workbook generator, so
 * the tests prove the authorization → canonical-load → generate → audit order
 * without touching PostgreSQL.
 */

const adminScope: ReportActorScope & { id: string } = {
  id: 'actor-1',
  role: 'admin',
  actorRepresentativeId: null,
  readableRepresentativeIds: [],
}

const salesRequest = {
  reportId: 'clientes' as const,
  filters: {
    from: '2026-08-01',
    to: '2026-08-31',
    statuses: ['confirmed'] as string[],
    representativeIds: [],
  },
}

function buildDependencies(overrides?: Partial<Parameters<
  typeof createReportExportOperations
>[0]>) {
  const auditEvents: ReportExportAuditEvent[] = []
  const dependencies = {
    getDatabase: (async () => ({}) as unknown as Database) as () => Promise<Database>,
    authenticate: (() => null) as () => (ReportActorScope & { id: string }) | null,
    audit: {
      append: async (event: ReportExportAuditEvent) => {
        auditEvents.push(event)
      },
    },
    logUnexpectedError: () => undefined,
    ...overrides,
  }
  return { dependencies, auditEvents }
}

describe('report export operations', () => {
  it('fails closed before any database access when unauthenticated', async () => {
    let queried = false
    const { dependencies, auditEvents } = buildDependencies({
      getDatabase: (async () => {
        queried = true
        return {} as unknown as Database
      }) as () => Promise<Database>,
    })
    const operations = createReportExportOperations(dependencies)

    // Direct call with no scope — the shape a forged endpoint call produces.
    const outcome = await operations.exportSalesReport(
      null as unknown as ReportActorScope & { id: string },
      salesRequest,
    )

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.code).toBe('UNAUTHENTICATED')
    expect(queried).toBe(false)
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0]).toMatchObject({
      action: 'report.export',
      actorId: 'anonymous',
      reportId: 'clientes',
      outcome: 'unauthenticated',
    })
  })

  it('rejects out-of-scope representative selection before querying', async () => {
    let queried = false
    const { dependencies, auditEvents } = buildDependencies({
      getDatabase: (async () => {
        queried = true
        return {} as unknown as Database
      }) as () => Promise<Database>,
    })
    const operations = createReportExportOperations(dependencies)
    const representativeScope: ReportActorScope & { id: string } = {
      id: 'rep-9',
      role: 'representative',
      actorRepresentativeId: 'rep-9',
      readableRepresentativeIds: [],
    }

    const outcome = await operations.exportSalesReport(representativeScope, {
      ...salesRequest,
      filters: {
        ...salesRequest.filters,
        representativeIds: ['someone-else'],
      },
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.code).toBe('FORBIDDEN')
    expect(queried).toBe(false)
    expect(auditEvents[0]).toMatchObject({ outcome: 'forbidden' })
  })

  it('generates the workbook from the canonical plan and audits success', async () => {
    const seenDefinitions: Array<Record<string, unknown>> = []
    const { dependencies, auditEvents } = buildDependencies({
      authenticate: (() => adminScope) as () => (ReportActorScope & { id: string }) | null,
      generateWorkbook: (async (definition: Record<string, unknown>) => {
        seenDefinitions.push(definition)
        return {
          buffer: Buffer.from('xlsx-bytes'),
          filename: 'clientes-2026-08-01-2026-08-31.xlsx',
          worksheetName: 'Vendas por cliente',
          headerRow: 5,
          rowCount: (definition.rows as unknown[]).length,
        }
      }) as never,
    })
    // Canonical loader is exercised indirectly; stub the metric loader path by
    // letting loadPostgresReportMetrics hit a fake execute that returns rows.
    const fakeDatabase = {
      execute: async () => [],
    } as unknown as Database
    const operations = createReportExportOperations({
      ...dependencies,
      getDatabase: (async () => fakeDatabase) as () => Promise<Database>,
    })

    const outcome = await operations.exportSalesReport(adminScope, salesRequest)

    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.file.filename).toBe('clientes-2026-08-01-2026-08-31.xlsx')
      expect(outcome.file.contentType).toContain('spreadsheetml')
    }
    expect(seenDefinitions[0]?.worksheetName).toBe('Vendas por cliente')
    expect(auditEvents.at(-1)).toMatchObject({ outcome: 'succeeded', reportId: 'clientes' })
    expect(JSON.stringify(auditEvents.at(-1))).not.toContain('Mercado')
  })

  it('maps workbook bound failures to the stable export error and audits them', async () => {
    const emptyDatabase = { execute: async () => [] } as unknown as Database
    const { dependencies, auditEvents } = buildDependencies({
      authenticate: (() => adminScope) as () => (ReportActorScope & { id: string }) | null,
      getDatabase: (async () => emptyDatabase) as () => Promise<Database>,
      generateWorkbook: (async () => {
        throw new ReportWorkbookError(
          'ROW_LIMIT_EXCEEDED',
          'row limit exceeded in test',
        )
      }) as never,
    })
    const operations = createReportExportOperations(dependencies)

    const outcome = await operations.exportSalesReport(adminScope, salesRequest)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('EXPORT_LIMIT_EXCEEDED')
      expect(outcome.error.status).toBe(422)
    }
    expect(auditEvents.at(-1)).toMatchObject({
      outcome: 'limit_exceeded',
      detail: 'ROW_LIMIT_EXCEEDED',
    })
  })
})
