/**
 * Renders representative pages of both required quote PDF variants to PNG
 * images with pdf.js (Node canvas) so a human or reviewer can visually audit
 * fonts, pagination, footer bands, and overflow without re-running generation.
 *
 * Usage: bun tests/visual/render-quote-pdf-pages.ts [outdir]
 * Output: <outdir>/<variant>-p<N>.png plus a manifest.json describing each
 * image. Deterministic inputs come from the shared seeded snapshots.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renderComercialQuotePdf, renderResumidaQuotePdf } from '../../src/lib/pdf'
import {
  comercialSnapshot,
  multiPageSnapshot,
  representativeSnapshot,
} from '../unit/quote-pdf-snapshots'

const outDir = path.resolve(process.argv[2] ?? '.hermes/artifacts/quote-pdf-review')

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true })
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // pdf.js's Node path creates its own canvases via @napi-rs/canvas; use the
  // same library here so the render target type matches what it draws into.
  const { createCanvas } = await import('@napi-rs/canvas')

  const variants = [
    { name: 'resumida', render: renderResumidaQuotePdf, snapshot: representativeSnapshot },
    { name: 'comercial', render: renderComercialQuotePdf, snapshot: comercialSnapshot },
    // Multi-page variant exercises pagination, footers, and long content flow.
    { name: 'resumida-multipage', render: renderResumidaQuotePdf, snapshot: multiPageSnapshot() },
    { name: 'comercial-multipage', render: renderComercialQuotePdf, snapshot: multiPageSnapshot() },
  ] as const

  const SCALE = 2 // 144 dpi — enough to judge kerning and hairline rules.
  const MAX_PAGES_PER_VARIANT = Number(process.env.PDF_REVIEW_MAX_PAGES ?? 4)

  const manifest: Array<{
    file: string
    variant: string
    page: number
    totalPages: number
    widthPx: number
    heightPx: number
  }> = []

  for (const variant of variants) {
    const bytes = await variant.render(variant.snapshot)
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useWorkerFetch: false,
      isEvalSupported: false,
    } as Parameters<typeof pdfjs.getDocument>[0]).promise

    const pageLimit = Math.min(doc.numPages, MAX_PAGES_PER_VARIANT)
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: SCALE })
      const canvas = createCanvas(viewport.width, viewport.height)
      const context = canvas.getContext('2d')
      // pdf.js paints on white by default only where content exists; seed the
      // background so paper color reads correctly in review tools.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, viewport.width, viewport.height)
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport,
      }).promise

      const file = `${variant.name}-p${pageNumber}.png`
      await writeFile(path.join(outDir, file), canvas.toBuffer('image/png'))
      manifest.push({
        file,
        variant: variant.name,
        page: pageNumber,
        totalPages: doc.numPages,
        widthPx: Math.round(viewport.width),
        heightPx: Math.round(viewport.height),
      })
      page.cleanup()
    }
    await doc.cleanup()
    console.log(`rendered ${variant.name}: ${pageLimit}/${doc.numPages} pages`)
  }

  await writeFile(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  console.log(`manifest written to ${path.join(outDir, 'manifest.json')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
