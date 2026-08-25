import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  buildReportFileName,
  generateReportWorkbook,
  sanitizeWorksheetName,
} from '@/lib/reports/workbook.server'

describe('report workbook names', () => {
  it('builds deterministic safe file and worksheet names', () => {
    expect(
      buildReportFileName(['Relatório de Vendas', '01/08/2026', '31/08/2026']),
    ).toBe('relatorio-de-vendas-01-08-2026-31-08-2026.xlsx')

    expect(sanitizeWorksheetName("  Vendas [Norte] / Agosto: 2026?*  ")).toBe(
      'Vendas Norte - Agosto 2026',
    )
    expect(sanitizeWorksheetName('a'.repeat(40))).toBe('a'.repeat(31))
  })
})

describe('report workbook generation', () => {
  it('writes metadata, typed cells, totals, and safe text without formulas', async () => {
    const issuedAt = new Date('2026-08-17T00:00:00.000Z')
    const result = await generateReportWorkbook({
      worksheetName: 'Vendas / Nordeste',
      filenameComponents: ['Vendas', '2026-08'],
      metadata: {
        title: 'Relatório de vendas',
        period: {
          start: new Date('2026-08-01T00:00:00.000Z'),
          end: new Date('2026-08-31T00:00:00.000Z'),
        },
        filters: [{ label: 'Cliente', value: '=HYPERLINK("bad")' }],
      },
      columns: [
        { key: 'client', header: 'Cliente', type: 'text', width: 24 },
        { key: 'issuedAt', header: 'Emissão', type: 'date' },
        { key: 'quantity', header: 'Quantidade', type: 'number' },
        { key: 'amount', header: 'Valor', type: 'currency' },
      ],
      rows: [
        {
          client: '+SUM(1,1)',
          issuedAt,
          quantity: 3,
          amount: 1250.5,
        },
        { client: '=1+1', issuedAt, quantity: 0, amount: 0 },
        { client: '-10+20', issuedAt, quantity: 0, amount: 0 },
        { client: '@SUM(1,1)', issuedAt, quantity: 0, amount: 0 },
      ],
      totals: {
        label: 'Total geral',
        values: { quantity: 3, amount: 1250.5 },
      },
    })

    expect(result.filename).toBe('vendas-2026-08.xlsx')
    expect(result.worksheetName).toBe('Vendas - Nordeste')
    expect(result.rowCount).toBe(4)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      result.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    )
    const sheet = workbook.getWorksheet(result.worksheetName)
    expect(sheet).toBeDefined()
    expect(sheet?.views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'frozen', ySplit: result.headerRow }),
      ]),
    )
    expect(sheet?.autoFilter).toBe(`A${result.headerRow}:D${result.headerRow}`)

    const dataRow = result.headerRow + 1
    expect(sheet?.getCell(dataRow, 1).value).toBe('+SUM(1,1)')
    expect(sheet?.getCell(dataRow, 1).type).toBe(ExcelJS.ValueType.String)
    expect(sheet?.getCell(dataRow, 2).value).toEqual(issuedAt)
    expect(sheet?.getCell(dataRow, 2).type).toBe(ExcelJS.ValueType.Date)
    expect(sheet?.getCell(dataRow, 3).value).toBe(3)
    expect(sheet?.getCell(dataRow, 3).type).toBe(ExcelJS.ValueType.Number)
    expect(sheet?.getCell(dataRow, 4).value).toBe(1250.5)
    expect(sheet?.getCell(dataRow, 4).numFmt).toContain('R$')
    expect(
      [0, 1, 2, 3].map((offset) => sheet?.getCell(dataRow + offset, 1).value),
    ).toEqual(['+SUM(1,1)', '=1+1', '-10+20', '@SUM(1,1)'])
    expect(sheet?.getCell(3, 2).value).toBe('=HYPERLINK("bad")')
    expect(sheet?.getCell(3, 2).type).toBe(ExcelJS.ValueType.String)

    const formulas: string[] = []
    sheet?.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.type === ExcelJS.ValueType.Formula) formulas.push(cell.address)
      })
    })
    expect(formulas).toEqual([])
  })

  it('stops async row generation at the configured row bound', async () => {
    async function* rows() {
      yield { name: 'Primeira' }
      yield { name: 'Segunda' }
    }

    await expect(
      generateReportWorkbook({
        worksheetName: 'Clientes',
        filenameComponents: ['clientes'],
        metadata: { title: 'Clientes' },
        columns: [{ key: 'name', header: 'Nome', type: 'text' }],
        rows: rows(),
        limits: { maxRows: 1 },
      }),
    ).rejects.toMatchObject({
      code: 'ROW_LIMIT_EXCEEDED',
    })
  })

  it('fails predictably when compressed output exceeds its byte bound', async () => {
    await expect(
      generateReportWorkbook({
        worksheetName: 'Clientes',
        filenameComponents: ['clientes'],
        metadata: { title: 'Clientes' },
        columns: [{ key: 'name', header: 'Nome', type: 'text' }],
        rows: [{ name: 'Cliente' }],
        limits: { maxOutputBytes: 1 },
      }),
    ).rejects.toMatchObject({
      code: 'OUTPUT_LIMIT_EXCEEDED',
    })
  })

  it('rejects non-string text values instead of accepting formula objects', async () => {
    await expect(
      generateReportWorkbook({
        worksheetName: 'Clientes',
        filenameComponents: ['clientes'],
        metadata: { title: 'Clientes' },
        columns: [{ key: 'name', header: 'Nome', type: 'text' }],
        rows: [{ name: { formula: '1+1' } }],
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_CELL_VALUE',
    })
  })

  it('terminates delayed generation at the configured time bound', async () => {
    async function* delayedRows() {
      await new Promise((resolve) => setTimeout(resolve, 10))
      yield { name: 'Tarde demais' }
    }

    await expect(
      generateReportWorkbook({
        worksheetName: 'Clientes',
        filenameComponents: ['clientes'],
        metadata: { title: 'Clientes' },
        columns: [{ key: 'name', header: 'Nome', type: 'text' }],
        rows: delayedRows(),
        limits: { maxDurationMs: 1 },
      }),
    ).rejects.toMatchObject({
      code: 'TIME_LIMIT_EXCEEDED',
    })
  })
})
