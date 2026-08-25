import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { ReactElement } from 'react'
import { registerBundledPdfFonts } from './assets.server'

/** Internal Node-only renderer shared by the resumida and comercial templates. */
export async function renderQuotePdfToBuffer(
  pdf: ReactElement<DocumentProps>,
): Promise<Buffer> {
  registerBundledPdfFonts()
  const output = await renderToBuffer(pdf)
  return Buffer.isBuffer(output) ? output : Buffer.from(output)
}
