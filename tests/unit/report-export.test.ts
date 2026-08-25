import { describe, expect, it } from 'vitest'
import {
  buildReportExportFileName,
  buildReportExportFilters,
  collectSalesReportRows,
  isExportableReportId,
  mapWorkbookFailure,
  planCommissionReportWorkbook,
  planSalesReportWorkbook,
  reportExportError,
} from '@/features/app/reports/report-export'
import type { SalesReportPage } from '@/features/app/reports/report-page'
import type { CommissionPage } from '@/features/app/reports/commission-report'

const PERIOD = { from: '2026-08-01', to: '2026-08-31' }

const salesPage: SalesReportPage = {
  grouping: 'clientes',
  rows: [
    {
      id: 'client-1',
      label: 'Mercado Bom Preço',
      orderCount: 3,
      quantity: null,
      byCurrency: [{ currencyCode: 'BRL', totalAmount: '1250.500000' }],
    },
    {
      id: 'client-2',
      label: 'Distribuidora A',
      orderCount: 1,
      quantity: null,
      byCurrency: [
        { currencyCode: 'BRL', totalAmount: '300.000000' },
        { currencyCode: 'USD', totalAmount: '50.000000' },
      ],
    },
  ],
  rowCount: 2,
  pageSubtotals: [],
  overallTotals: [
    { currencyCode: 'BRL', orderCount: 4, quantity: null, totalAmount: '1550.500000' },
    { currencyCode: 'USD', orderCount: 1, quantity: null, totalAmount: '50.000000' },
  ],
  overallCommissionTotals: null,
}

const commissionPage: CommissionPage = {
  rows: [
    {
      representativeId: 'rep-1',
      representativeName: 'Ana',
      orderCount: 5,
      salesAmount: '900.000000',
      commissionAmount: '90.000000',
      currencyCode: 'BRL',
      sourceOrderIds: ['order-1'],
    },
    {
      representativeId: 'rep-2',
      representativeName: 'Bruno',
      orderCount: 2,
      salesAmount: '200.000000',
      commissionAmount: '0.000000',
      currencyCode: 'BRL',
      sourceOrderIds: null,
    },
  ],
  pageSubtotal: {
    orderCount: 7,
    salesAmount: '1100.000000',
    commissionAmount: '90.000000',
  },
  overallTotals: {
    orderCount: 7,
    salesAmount: '1100.000000',
    commissionAmount: '90.000000',
  },
  totalRows: 2,
  offset: 0,
  limit: 50,
  currencyCode: 'BRL',
  canViewCommissions: true,
  canDrillThrough: true,
}

describe('export identifiers and filenames', () => {
  it('accepts only the approved report ids', () => {
    expect(isExportableReportId('clientes')).toBe(true)
    expect(isExportableReportId('produtos')).toBe(true)
    expect(isExportableReportId('industrias')).toBe(true)
    expect(isExportableReportId('comissoes')).toBe(true)
    expect(isExportableReportId('inativos')).toBe(false)
    expect(isExportableReportId('../../etc/passwd')).toBe(false)
  })

  it('derives deterministic names only from report and period ids', () => {
    expect(buildReportExportFileName('clientes', PERIOD)).toBe(
      'clientes-2026-08-01-2026-08-31.xlsx',
    )
    expect(buildReportExportFileName('comissoes', PERIOD)).toBe(
      'comissoes-2026-08-01-2026-08-31.xlsx',
    )
    // Same inputs, same name — no timestamps, no user text.
    expect(buildReportExportFileName('produtos', PERIOD)).toBe(
      buildReportExportFileName('produtos', PERIOD),
    )
  })
})

describe('sales export plan', () => {
  const filters = buildReportExportFilters({
    statuses: ['confirmed', 'completed'],
    representativeIds: ['rep-1'],
  })

  it('expands multi-currency rows and appends per-currency canonical totals', () => {
    const plan = planSalesReportWorkbook({
      reportId: 'clientes',
      page: salesPage,
      period: PERIOD,
      filters,
    })

    expect(plan.worksheetName).toBe('Vendas por cliente')
    expect(plan.filenameComponents).toEqual(['clientes', ...Object.values(PERIOD)])
    expect(plan.columns.map((column) => column.key)).toEqual([
      'grupo',
      'quantidadePedidos',
      'moeda',
      'valor',
    ])

    const dataRows = plan.rows.filter((row) => row.grupo !== 'Total do período')
    expect(dataRows).toHaveLength(3)
    expect(dataRows[0]).toMatchObject({
      grupo: 'Mercado Bom Preço',
      quantidadePedidos: 3,
      moeda: 'BRL',
      valor: 1250.5,
    })

    const totals = plan.rows.filter((row) => row.grupo === 'Total do período')
    expect(totals).toHaveLength(2)
    expect(totals.map((row) => [row.moeda, row.valor])).toEqual([
      ['BRL', 1550.5],
      ['USD', 50],
    ])
  })

  it('drops the order-count column for produtos and keeps quantity', () => {
    const plan = planSalesReportWorkbook({
      reportId: 'produtos',
      page: { ...salesPage, grouping: 'produtos' },
      period: PERIOD,
      filters,
    })
    expect(plan.columns.map((column) => column.key)).not.toContain(
      'quantidadePedidos',
    )
    expect(plan.columns.map((column) => column.key)).toContain('quantidade')
  })

  it('drops the quantity column for clientes and industrias', () => {
    const plan = planSalesReportWorkbook({
      reportId: 'clientes',
      page: salesPage,
      period: PERIOD,
      filters,
    })
    expect(plan.columns.map((column) => column.key)).not.toContain('quantidade')
  })

  it('collects one row per currency without inventing values', () => {
    const rows = collectSalesReportRows(salesPage)
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => typeof row.grupo === 'string')).toBe(true)
  })
})

describe('commissions export plan', () => {
  const filters = buildReportExportFilters({ statuses: [], representativeIds: [] })

  it('carries canonical rows and totals when commissions are visible', () => {
    const plan = planCommissionReportWorkbook({
      page: commissionPage,
      period: PERIOD,
      filters,
    })
    expect(plan.worksheetName).toBe('Comissões')
    expect(plan.rows).toHaveLength(2)
    expect(plan.totals?.values).toEqual({
      pedidos: 7,
      vendas: 1100,
      comissao: 90,
    })
  })

  it('withholds commission cells for read-only projections', () => {
    const redacted = {
      ...commissionPage,
      canViewCommissions: false,
      canDrillThrough: false,
      rows: commissionPage.rows.map((row) => ({
        ...row,
        commissionAmount: '0.000000',
        sourceOrderIds: null,
      })),
    }
    const plan = planCommissionReportWorkbook({
      page: redacted,
      period: PERIOD,
      filters,
    })
    expect(plan.rows.every((row) => row.comissao === null)).toBe(true)
    expect(plan.totals?.values.comissao).toBeNull()
  })
})

describe('error mapping', () => {
  it('maps workbook bounds to a stable actionable code', () => {
    expect(mapWorkbookFailure('ROW_LIMIT_EXCEEDED')).toBe('EXPORT_LIMIT_EXCEEDED')
    expect(mapWorkbookFailure('TIME_LIMIT_EXCEEDED')).toBe('EXPORT_LIMIT_EXCEEDED')
    expect(mapWorkbookFailure('OUTPUT_LIMIT_EXCEEDED')).toBe('EXPORT_LIMIT_EXCEEDED')
    expect(mapWorkbookFailure('INVALID_CELL_VALUE')).toBe('INTERNAL_ERROR')
  })

  it('exposes stable status codes per error code', () => {
    expect(reportExportError('UNAUTHENTICATED').status).toBe(401)
    expect(reportExportError('FORBIDDEN').status).toBe(403)
    expect(reportExportError('EXPORT_LIMIT_EXCEEDED').status).toBe(422)
    expect(typeof reportExportError('FORBIDDEN').message).toBe('string')
  })
})
