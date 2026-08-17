import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Document, Page, StyleSheet, Text, renderToBuffer } from '@react-pdf/renderer'
import ExcelJS from 'exceljs'

const SERVER_ONLY_SENTINEL = 'WEYNE_EXPORT_SECRET_DO_NOT_BUNDLE'
const rows = [
  { customer: 'Mercado Sol', total: 1250 },
  { customer: 'Hotel Mar', total: 980 },
]
const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 12 },
  title: { fontSize: 20, marginBottom: 16 },
  row: { marginBottom: 8 },
})

function SalesDocument() {
  return (
    <Document title="Architecture spike sales report">
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Weyne — relatório de compatibilidade</Text>
        {rows.map((row) => (
          <Text key={row.customer} style={styles.row}>
            {row.customer}: R$ {row.total.toFixed(2)}
          </Text>
        ))}
      </Page>
    </Document>
  )
}

async function generatePdf(outputPath: string) {
  const buffer = await renderToBuffer(<SalesDocument />)
  await writeFile(outputPath, buffer)
}

async function generateWorkbook(outputPath: string) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Weyne architecture spike'
  const sheet = workbook.addWorksheet('Vendas')
  sheet.columns = [
    { header: 'Cliente', key: 'customer', width: 24 },
    { header: 'Total', key: 'total', width: 14 },
  ]
  rows.forEach((row) => sheet.addRow(row))
  sheet.getColumn('total').numFmt = 'R$ #,##0.00'
  await workbook.xlsx.writeFile(outputPath)
}

const outputDirectory = path.resolve(
  process.argv[2] ?? 'artifacts/architecture-spike',
)
await mkdir(outputDirectory, { recursive: true })

const pdfPath = path.join(outputDirectory, 'sales-report.pdf')
const workbookPath = path.join(outputDirectory, 'sales-report.xlsx')
await Promise.all([generatePdf(pdfPath), generateWorkbook(workbookPath)])

console.log(
  JSON.stringify({
    pdfPath,
    workbookPath,
    serverSentinelLength: SERVER_ONLY_SENTINEL.length,
  }),
)
