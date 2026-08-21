import {
  buildReportFileName,
  type ReportColumn,
  type ReportWorkbookTotals,
} from '@/lib/reports/workbook.server'
import type { SalesReportPage, SalesReportGrouping } from './report-page'
import type { CommissionPage } from './commission-report'

/**
 * Pure export contracts for the approved `/app/relatorios` reports.
 *
 * Every workbook definition consumes the exact canonical projections the
 * on-screen pages render — `SalesReportPage` from `buildSalesReportPage` over
 * the canonical metric snapshot, and `CommissionPage` from
 * `loadCommissionPage`. No grouping, total, or filter meaning is redefined
 * here: an export is a byte-level rendering of the same server-evaluated data
 * under the same actor scope and filters.
 *
 * Exports ignore pagination on purpose: the canonical snapshot already bounds
 * the source (MAX_METRIC_SOURCE_ORDERS), and the workbook generator enforces
 * row/column/byte/time bounds with stable errors and cleanup.
 */

export const EXPORTABLE_REPORT_IDS = [
  'clientes',
  'produtos',
  'industrias',
  'comissoes',
] as const

export type ExportableReportId = (typeof EXPORTABLE_REPORT_IDS)[number]

export function isExportableReportId(value: string): value is ExportableReportId {
  return (EXPORTABLE_REPORT_IDS as readonly string[]).includes(value)
}

const REPORT_TITLES: Record<ExportableReportId, string> = {
  clientes: 'Vendas por cliente',
  produtos: 'Vendas por produto',
  industrias: 'Vendas por indústria',
  comissoes: 'Comissões',
}

export function reportExportTitle(reportId: ExportableReportId): string {
  return REPORT_TITLES[reportId]
}

/**
 * Deterministic download name derived ONLY from the report identifier and the
 * period identifiers — both validated before this runs. No user text, no
 * representative names, no free-form values reach the filename.
 */
export function buildReportExportFileName(
  reportId: ExportableReportId,
  period: Readonly<{ from: string; to: string }>,
): string {
  return buildReportFileName([reportId, period.from, period.to])
}

export type ReportExportFilterMetadata = readonly Readonly<{
  label: string
  value: string
}>[]

/**
 * Normalized filter metadata for the workbook header. Labels are fixed;
 * values are bounded, single-line renderings of already-validated inputs —
 * never raw row data.
 */
export function buildReportExportFilters(filters: Readonly<{
  statuses: readonly string[]
  representativeIds: readonly string[]
}>): ReportExportFilterMetadata {
  return [
    {
      label: 'Status',
      value:
        filters.statuses.length > 0 ? filters.statuses.join(', ') : 'Todos',
    },
    {
      label: 'Representantes',
      value:
        filters.representativeIds.length > 0
          ? `${filters.representativeIds.length} selecionado(s)`
          : 'Todos',
    },
  ]
}

function isoDateToUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

type SalesSheetRow = {
  [key: string]: unknown
  grupo: string
  quantidadePedidos: number | null
  quantidade: number | null
  moeda: string
  valor: number | null
}

type CommissionSheetRow = {
  [key: string]: unknown
  representante: string
  pedidos: number
  moeda: string
  vendas: number | null
  comissao: number | null
}

export type ReportWorkbookPlan<RowType extends Record<string, unknown>> = Readonly<{
  worksheetName: string
  filenameComponents: readonly string[]
  metadata: {
    title: string
    period?: Readonly<{ start: Date; end: Date }>
    filters?: readonly Readonly<{ label: string; value: string }>[]
  }
  columns: readonly Readonly<ReportColumn<RowType>>[]
  rows: readonly RowType[]
  totals?: Readonly<ReportWorkbookTotals<RowType>>
}>

const SALES_COLUMNS: readonly Readonly<ReportColumn<SalesSheetRow>>[] = Object.freeze([
  { key: 'grupo', header: 'Grupo', type: 'text', width: 32 },
  {
    key: 'quantidadePedidos',
    header: 'Pedidos',
    type: 'number',
    numberFormat: '#,##0',
  },
  { key: 'quantidade', header: 'Quantidade', type: 'number' },
  { key: 'moeda', header: 'Moeda', type: 'text', width: 8 },
  { key: 'valor', header: 'Valor', type: 'currency' },
])

const COMMISSION_COLUMNS: readonly Readonly<ReportColumn<CommissionSheetRow>>[] =
  Object.freeze([
    { key: 'representante', header: 'Representante', type: 'text', width: 32 },
    {
      key: 'pedidos',
      header: 'Pedidos',
      type: 'number',
      numberFormat: '#,##0',
    },
    { key: 'moeda', header: 'Moeda', type: 'text', width: 8 },
    { key: 'vendas', header: 'Vendas', type: 'currency' },
    { key: 'comissao', header: 'Comissão', type: 'currency' },
  ])

/**
 * Flattens the canonical sales report into typed sheet rows. Grouping
 * semantics come straight from `SalesReportRow`: orderCount is null for
 * produtos, quantity is null for clientes/industrias — exactly like the UI.
 * Multi-currency rows expand one line per currency, mirroring the UI's
 * ` · `-joined rendering.
 */
export function collectSalesReportRows(page: SalesReportPage): SalesSheetRow[] {
  const rows: SalesSheetRow[] = []
  for (const row of page.rows) {
    if (row.byCurrency.length === 0) {
      rows.push({
        grupo: row.label,
        quantidadePedidos: row.orderCount,
        quantidade: row.quantity === null ? null : Number(row.quantity),
        moeda: '',
        valor: null,
      })
      continue
    }
    for (const entry of row.byCurrency) {
      rows.push({
        grupo: row.label,
        quantidadePedidos: row.orderCount,
        quantidade: row.quantity === null ? null : Number(row.quantity),
        moeda: entry.currencyCode,
        valor: Number(entry.totalAmount),
      })
    }
  }
  return rows
}

/**
 * Builds the generator definition for a sales report export. The page must be
 * the canonical one (same scope + filters as the screen). Canonical period
 * totals (`overallTotals`) are appended one labeled row per currency after the
 * data rows — never summed across currencies.
 */
export function planSalesReportWorkbook(input: Readonly<{
  reportId: SalesReportGrouping
  page: SalesReportPage
  period: Readonly<{ from: string; to: string }>
  filters: ReportExportFilterMetadata
}>): ReportWorkbookPlan<SalesSheetRow> {
  const columns =
    input.reportId === 'produtos'
      ? SALES_COLUMNS.filter((column) => column.key !== 'quantidadePedidos')
      : SALES_COLUMNS.filter((column) => column.key !== 'quantidade')

  const project = (row: SalesSheetRow): SalesSheetRow => {
    const projected: Record<string, unknown> = {}
    for (const column of columns) projected[column.key] = row[column.key]
    return projected as SalesSheetRow
  }

  const rows = [
    ...collectSalesReportRows(input.page),
    ...input.page.overallTotals.map((total): SalesSheetRow => ({
      grupo: 'Total do período',
      quantidadePedidos: null,
      quantidade: null,
      moeda: total.currencyCode,
      valor: Number(total.totalAmount),
    })),
  ].map(project)

  return {
    worksheetName: reportExportTitle(input.reportId),
    filenameComponents: [input.reportId, input.period.from, input.period.to],
    metadata: {
      title: `${reportExportTitle(input.reportId)} — ${input.period.from} a ${input.period.to}`,
      period: {
        start: isoDateToUtcDate(input.period.from),
        end: isoDateToUtcDate(input.period.to),
      },
      filters: [...input.filters],
    },
    columns,
    rows,
  }
}

/**
 * Builds the generator definition for the commissions export. Commission
 * values appear only when the canonical projection carried them
 * (`canViewCommissions`); read-only exports render the same rows the tab
 * shows with commission cells withheld — never widened.
 */
export function planCommissionReportWorkbook(input: Readonly<{
  page: CommissionPage
  period: Readonly<{ from: string; to: string }>
  filters: ReportExportFilterMetadata
}>): ReportWorkbookPlan<CommissionSheetRow> {
  const canViewCommissions = input.page.canViewCommissions
  const rows: CommissionSheetRow[] = input.page.rows.map((row) => ({
    representante: row.representativeName || row.representativeId,
    pedidos: row.orderCount,
    moeda: row.currencyCode,
    vendas: Number(row.salesAmount),
    comissao: canViewCommissions ? Number(row.commissionAmount) : null,
  }))

  const totals: ReportWorkbookTotals<CommissionSheetRow> = {
    label: 'Total do período',
    values: {
      pedidos: input.page.overallTotals.orderCount,
      vendas: Number(input.page.overallTotals.salesAmount),
      comissao: canViewCommissions
        ? Number(input.page.overallTotals.commissionAmount)
        : null,
    },
  }

  return {
    worksheetName: reportExportTitle('comissoes'),
    filenameComponents: ['comissoes', input.period.from, input.period.to],
    metadata: {
      title: `${reportExportTitle('comissoes')} — ${input.period.from} a ${input.period.to}`,
      period: {
        start: isoDateToUtcDate(input.period.from),
        end: isoDateToUtcDate(input.period.to),
      },
      filters: [...input.filters],
    },
    columns: COMMISSION_COLUMNS,
    rows,
    totals,
  }
}

/** Stable public error codes for the export endpoints. */
export type ReportExportErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'EXPORT_LIMIT_EXCEEDED'
  | 'INTERNAL_ERROR'

export const REPORT_EXPORT_ERROR_STATUS: Readonly<
  Record<ReportExportErrorCode, number>
> = Object.freeze({
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION_FAILED: 400,
  EXPORT_LIMIT_EXCEEDED: 422,
  INTERNAL_ERROR: 500,
})

const ERROR_MESSAGE: Readonly<Record<ReportExportErrorCode, string>> =
  Object.freeze({
    UNAUTHENTICATED: 'Autenticação necessária.',
    FORBIDDEN: 'Você não tem permissão para exportar este relatório.',
    VALIDATION_FAILED: 'Os filtros de exportação são inválidos.',
    EXPORT_LIMIT_EXCEEDED:
      'A exportação excedeu os limites do relatório. Reduza o período ou os filtros e tente novamente.',
    INTERNAL_ERROR: 'Não foi possível concluir a exportação.',
  })

export type ReportExportPublicError = Readonly<{
  code: ReportExportErrorCode
  status: number
  message: string
}>

export function reportExportError(
  code: ReportExportErrorCode,
): ReportExportPublicError {
  return Object.freeze({
    code,
    status: REPORT_EXPORT_ERROR_STATUS[code],
    message: ERROR_MESSAGE[code],
  })
}

/** Workbook bound exceeded → stable 422; anything else stays internal. */
export function mapWorkbookFailure(code: string): ReportExportErrorCode {
  return code === 'ROW_LIMIT_EXCEEDED' ||
    code === 'COLUMN_LIMIT_EXCEEDED' ||
    code === 'OUTPUT_LIMIT_EXCEEDED' ||
    code === 'TIME_LIMIT_EXCEEDED'
    ? 'EXPORT_LIMIT_EXCEEDED'
    : 'INTERNAL_ERROR'
}
