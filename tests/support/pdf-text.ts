import type { TextItem } from 'pdfjs-dist/types/src/display/api'

export interface PdfPageText {
  readonly pageNumber: number
  /** All text runs joined with single spaces, in layout order. */
  readonly text: string
  /** Bottom-anchored footer band text (the fixed footer renders near y≈25pt). */
  readonly footerText: string
}

/**
 * Extracts per-page text from a rendered PDF buffer with pdf.js. Runs fully
 * under Node — no browser, no canvas — so it can back deterministic unit
 * assertions about what a generated document actually displays.
 */
export async function extractPdfPages(buffer: Uint8Array): Promise<PdfPageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    // pdf.js 6 removed `isEvalSupported` from DocumentInitParameters.
  } as Parameters<typeof pdfjs.getDocument>[0]).promise

  const pages: PdfPageText[] = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    let text = ''
    let footerText = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      const run = item as TextItem
      if (run.str.length === 0) continue
      text += `${run.str} `
      // The fixed footer band sits below y≈40pt in the 842pt A4 page.
      if (item.transform[5] < 40) footerText += `${run.str} `
    }
    pages.push({
      pageNumber,
      // Collapse the whitespace runs pdf.js emits so assertions can match on
      // natural single-space phrases.
      text: text.replace(/\s+/g, ' ').trim(),
      footerText: footerText.replace(/\s+/g, ' ').trim(),
    })
  }
  await doc.cleanup()
  return pages
}
