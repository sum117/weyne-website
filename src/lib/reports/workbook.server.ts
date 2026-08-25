import { performance } from 'node:perf_hooks'
import { Writable } from 'node:stream'
import ExcelJS from 'exceljs'
import type { CellValue, Fill, Font, Row, Worksheet } from 'exceljs'

const WORKSHEET_NAME_MAX_LENGTH = 31
const FILE_NAME_MAX_LENGTH = 120
const EXCEL_TEXT_MAX_LENGTH = 32_767
const DEFAULT_LIMITS: ReportWorkbookLimits = Object.freeze({
  maxRows: 50_000,
  maxColumns: 50,
  maxMetadataEntries: 100,
  maxOutputBytes: 25 * 1024 * 1024,
  maxDurationMs: 30_000,
  maxTextLength: EXCEL_TEXT_MAX_LENGTH,
})

const HEADER_FILL: Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF123B63' },
}
const HEADER_FONT: Partial<Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
}
const CURRENCY_FORMAT = 'R$ #,##0.00;[Red]-R$ #,##0.00'
const NUMBER_FORMAT = '#,##0.00'
const DATE_FORMAT = 'dd/mm/yyyy'

export type ReportColumnType = 'text' | 'date' | 'number' | 'currency' | 'boolean'
export type ReportWorkbookErrorCode =
  | 'INVALID_DEFINITION'
  | 'INVALID_CELL_VALUE'
  | 'ROW_LIMIT_EXCEEDED'
  | 'COLUMN_LIMIT_EXCEEDED'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'TIME_LIMIT_EXCEEDED'

export interface ReportColumn<RowType extends Record<string, unknown>> {
  readonly key: Extract<keyof RowType, string>
  readonly header: string
  readonly type: ReportColumnType
  readonly width?: number
  readonly numberFormat?: string
}

export interface ReportFilterMetadata {
  readonly label: string
  readonly value: string
}

export interface ReportWorkbookMetadata {
  readonly title: string
  readonly period?: Readonly<{ start: Date; end: Date }>
  readonly filters?: readonly Readonly<ReportFilterMetadata>[]
}

export interface ReportWorkbookTotals<RowType extends Record<string, unknown>> {
  readonly label: string
  readonly values: Partial<Record<keyof RowType, unknown>>
}

export interface ReportWorkbookLimits {
  readonly maxRows: number
  readonly maxColumns: number
  readonly maxMetadataEntries: number
  readonly maxOutputBytes: number
  readonly maxDurationMs: number
  readonly maxTextLength: number
}

export interface ReportWorkbookDefinition<RowType extends Record<string, unknown>> {
  readonly worksheetName: string
  readonly filenameComponents: readonly string[]
  readonly metadata: Readonly<ReportWorkbookMetadata>
  readonly columns: readonly Readonly<ReportColumn<NoInfer<RowType>>>[]
  readonly rows: Iterable<Readonly<RowType>> | AsyncIterable<Readonly<RowType>>
  readonly totals?: Readonly<ReportWorkbookTotals<NoInfer<RowType>>>
  readonly limits?: Partial<ReportWorkbookLimits>
}

export interface GeneratedReportWorkbook {
  readonly buffer: Buffer
  readonly filename: string
  readonly worksheetName: string
  readonly headerRow: number
  readonly rowCount: number
}

export class ReportWorkbookError extends Error {
  readonly code: ReportWorkbookErrorCode

  constructor(code: ReportWorkbookErrorCode, message: string) {
    super(message)
    this.name = 'ReportWorkbookError'
    this.code = code
  }
}

class BoundedBufferWriter extends Writable {
  readonly chunks: Buffer[] = []
  size = 0

  constructor(private readonly maxBytes: number) {
    super()
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
    if (this.size + buffer.byteLength > this.maxBytes) {
      callback(
        new ReportWorkbookError(
          'OUTPUT_LIMIT_EXCEEDED',
          `Workbook output exceeds the ${this.maxBytes} byte limit.`,
        ),
      )
      return
    }

    this.chunks.push(buffer)
    this.size += buffer.byteLength
    callback()
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.size)
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function sanitizeWorksheetName(value: string): string {
  const sanitized = collapseWhitespace(
    value
      .normalize('NFC')
      .replace(/[*?:\\]/g, '')
      .replaceAll('[', '')
      .replaceAll(']', '')
      .replace(/\s*\/\s*/g, ' - ')
      .replace(/^'+|'+$/g, ''),
  )

  return (sanitized || 'Relatório').slice(0, WORKSHEET_NAME_MAX_LENGTH).trim()
}

export function buildReportFileName(components: readonly string[]): string {
  const stem = components
    .map((component) =>
      component
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-')
    .slice(0, FILE_NAME_MAX_LENGTH)
    .replace(/-+$/g, '')

  return `${stem || 'relatorio'}.xlsx`
}

function resolveLimits(overrides: Partial<ReportWorkbookLimits> | undefined) {
  const limits = { ...DEFAULT_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ReportWorkbookError(
        'INVALID_DEFINITION',
        `Workbook limit ${name} must be a positive safe integer.`,
      )
    }
  }
  return limits
}

function assertText(value: string, label: string, maxLength: number): string {
  if (value.length > maxLength) {
    throw new ReportWorkbookError(
      'INVALID_CELL_VALUE',
      `${label} exceeds the ${maxLength} character limit.`,
    )
  }
  return value
}

function assertDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ReportWorkbookError(
      'INVALID_CELL_VALUE',
      `${label} must be a valid Date.`,
    )
  }
  return new Date(value.getTime())
}

function toCellValue(
  value: unknown,
  column: Readonly<ReportColumn<Record<string, unknown>>>,
  maxTextLength: number,
): CellValue {
  if (value === null || value === undefined) return null

  switch (column.type) {
    case 'text':
      if (typeof value !== 'string') {
        throw new ReportWorkbookError(
          'INVALID_CELL_VALUE',
          `${column.key} must be text.`,
        )
      }
      return assertText(value, column.key, maxTextLength)
    case 'date':
      return assertDate(value, column.key)
    case 'number':
    case 'currency':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ReportWorkbookError(
          'INVALID_CELL_VALUE',
          `${column.key} must be a finite number.`,
        )
      }
      return value
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new ReportWorkbookError(
          'INVALID_CELL_VALUE',
          `${column.key} must be boolean.`,
        )
      }
      return value
  }
}

function applyColumnFormat(
  row: Row,
  columns: readonly Readonly<ReportColumn<Record<string, unknown>>>[],
): void {
  columns.forEach((column, index) => {
    const cell = row.getCell(index + 1)
    if (column.numberFormat) cell.numFmt = column.numberFormat
    else if (column.type === 'date') cell.numFmt = DATE_FORMAT
    else if (column.type === 'currency') cell.numFmt = CURRENCY_FORMAT
    else if (column.type === 'number') cell.numFmt = NUMBER_FORMAT
  })
}

function addMetadataRows(
  worksheet: Worksheet,
  metadata: Readonly<ReportWorkbookMetadata>,
  columnCount: number,
  maxTextLength: number,
): number {
  const title = worksheet.addRow([
    assertText(metadata.title, 'metadata title', maxTextLength),
  ])
  title.font = { bold: true, size: 16, color: { argb: 'FF123B63' } }
  if (columnCount > 1) worksheet.mergeCells(title.number, 1, title.number, columnCount)
  title.commit()

  if (metadata.period) {
    const period = worksheet.addRow([
      'Período',
      assertDate(metadata.period.start, 'period start'),
      'até',
      assertDate(metadata.period.end, 'period end'),
    ])
    period.getCell(2).numFmt = DATE_FORMAT
    period.getCell(4).numFmt = DATE_FORMAT
    period.commit()
  }

  for (const filter of metadata.filters ?? []) {
    const row = worksheet.addRow([
      assertText(filter.label, 'filter label', maxTextLength),
      assertText(filter.value, 'filter value', maxTextLength),
    ])
    row.commit()
  }

  const spacer = worksheet.addRow([])
  spacer.commit()
  return spacer.number + 1
}

function checkDeadline(deadline: number): void {
  if (performance.now() > deadline) {
    throw new ReportWorkbookError(
      'TIME_LIMIT_EXCEEDED',
      'Workbook generation exceeded its time limit.',
    )
  }
}

async function* toAsyncRows<RowType>(
  rows: Iterable<RowType> | AsyncIterable<RowType>,
): AsyncGenerator<RowType> {
  if (Symbol.asyncIterator in rows) {
    yield* rows
    return
  }
  yield* rows
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error('Workbook generation failed.')
}

export async function generateReportWorkbook<
  RowType extends Record<string, unknown>,
>(
  definition: Readonly<ReportWorkbookDefinition<RowType>>,
): Promise<GeneratedReportWorkbook> {
  const limits = resolveLimits(definition.limits)
  if (definition.columns.length === 0) {
    throw new ReportWorkbookError(
      'INVALID_DEFINITION',
      'A report workbook requires at least one column.',
    )
  }
  if (definition.columns.length > limits.maxColumns) {
    throw new ReportWorkbookError(
      'COLUMN_LIMIT_EXCEEDED',
      `Workbook has more than ${limits.maxColumns} columns.`,
    )
  }
  if ((definition.metadata.filters?.length ?? 0) > limits.maxMetadataEntries) {
    throw new ReportWorkbookError(
      'INVALID_DEFINITION',
      `Workbook has more than ${limits.maxMetadataEntries} filter entries.`,
    )
  }

  const columnKeys = new Set(definition.columns.map(({ key }) => key))
  if (columnKeys.size !== definition.columns.length) {
    throw new ReportWorkbookError('INVALID_DEFINITION', 'Column keys must be unique.')
  }

  const worksheetName = sanitizeWorksheetName(definition.worksheetName)
  const filename = buildReportFileName(definition.filenameComponents)
  const output = new BoundedBufferWriter(limits.maxOutputBytes)
  output.on('error', () => undefined)
  const expectedHeaderRow =
    3 +
    (definition.metadata.period ? 1 : 0) +
    (definition.metadata.filters?.length ?? 0)
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: true,
    useSharedStrings: false,
  })
  const worksheet = workbook.addWorksheet(worksheetName, {
    views: [{ state: 'frozen', ySplit: expectedHeaderRow }],
  })
  definition.columns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = column.width ?? 16
  })

  const deadline = performance.now() + limits.maxDurationMs
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const headerRow = addMetadataRows(
      worksheet,
      definition.metadata,
      definition.columns.length,
      limits.maxTextLength,
    )
    if (headerRow !== expectedHeaderRow) {
      throw new ReportWorkbookError(
        'INVALID_DEFINITION',
        'Workbook metadata produced an unstable header position.',
      )
    }
    worksheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow, column: definition.columns.length },
    }

    const header = worksheet.addRow(
      definition.columns.map(({ header: value }) =>
        assertText(value, 'column header', limits.maxTextLength),
      ),
    )
    header.fill = HEADER_FILL
    header.font = HEADER_FONT
    header.alignment = { vertical: 'middle' }
    header.commit()

    let rowCount = 0
    for await (const sourceRow of toAsyncRows(definition.rows)) {
      checkDeadline(deadline)
      rowCount += 1
      if (rowCount > limits.maxRows) {
        throw new ReportWorkbookError(
          'ROW_LIMIT_EXCEEDED',
          `Workbook has more than ${limits.maxRows} data rows.`,
        )
      }

      const row = worksheet.addRow(
        definition.columns.map((column) =>
          toCellValue(
            sourceRow[column.key],
            column as Readonly<ReportColumn<Record<string, unknown>>>,
            limits.maxTextLength,
          ),
        ),
      )
      applyColumnFormat(
        row,
        definition.columns as readonly Readonly<
          ReportColumn<Record<string, unknown>>
        >[],
      )
      row.commit()
    }

    if (definition.totals) {
      const totalRow = worksheet.addRow(
        definition.columns.map((column, index) => {
          if (index === 0) {
            return assertText(
              definition.totals?.label ?? 'Total',
              'totals label',
              limits.maxTextLength,
            )
          }
          return toCellValue(
            definition.totals?.values[column.key],
            column as Readonly<ReportColumn<Record<string, unknown>>>,
            limits.maxTextLength,
          )
        }),
      )
      totalRow.font = { bold: true }
      applyColumnFormat(
        totalRow,
        definition.columns as readonly Readonly<
          ReportColumn<Record<string, unknown>>
        >[],
      )
      totalRow.commit()
    }

    checkDeadline(deadline)
    worksheet.commit()
    const remainingMs = Math.max(1, deadline - performance.now())
    timeout = setTimeout(() => {
      output.destroy(
        new ReportWorkbookError(
          'TIME_LIMIT_EXCEEDED',
          'Workbook generation exceeded its time limit.',
        ),
      )
    }, remainingMs)
    await workbook.commit()
    clearTimeout(timeout)

    return {
      buffer: output.toBuffer(),
      filename,
      worksheetName,
      headerRow,
      rowCount,
    }
  } catch (error) {
    if (timeout) clearTimeout(timeout)
    output.destroy()
    throw normalizeError(error)
  } finally {
    output.chunks.length = 0
  }
}
