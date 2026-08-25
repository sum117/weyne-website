// Rasterize the review PDFs to PNG artifacts with pdf.js in headless Chromium.
// Usage: node scripts/rasterize-quote-pdf-review.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../docs/review/quote-pdf/', import.meta.url))
const pdfjsSource = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs'
const workerSource = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs'
const { chromium } = await import('playwright-core')

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1450 } })
  await page.setContent('<!doctype html><html><body style="margin:0"></body></html>')

  for (const name of readdirSync(dir).filter((f) => f.endsWith('.pdf'))) {
    const pdfBytes = Array.from(readFileSync(`${dir}${name}`))
    const pngs = await page.evaluate(
      async ({ pdfBytes, pdfjsSource, workerSource }) => {
        const module = await import(pdfjsSource)
        const pdfjs = module.default ?? module
        pdfjs.GlobalWorkerOptions.workerSrc = workerSource
        const doc = await pdfjs.getDocument({ data: pdfBytes }).promise
        const out = []
        for (let n = 1; n <= doc.numPages; n++) {
          const pdfPage = await doc.getPage(n)
          const viewport = pdfPage.getViewport({ scale: 2 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const context = canvas.getContext('2d')
          if (!context) throw new Error('canvas 2d context unavailable')
          await pdfPage.render({ canvasContext: context, viewport }).promise
          out.push({ pageNumber: n, dataUrl: canvas.toDataURL('image/png') })
        }
        return out
      },
      { pdfBytes, pdfjsSource, workerSource },
    )

    for (const png of pngs) {
      const base64 = png.dataUrl.replace(/^data:image\/png;base64,/, '')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(`${dir}${name.replace(/\.pdf$/, '')}-p${png.pageNumber}.png`, Buffer.from(base64, 'base64'))
    }
    console.log(`${name}: ${pngs.length} pages rasterized`)
  }
} finally {
  await browser.close()
}
process.exit(0)
