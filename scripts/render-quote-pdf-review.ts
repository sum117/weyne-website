// Render the representative quote PDF documents to disk for visual review.
// Usage: bun scripts/render-quote-pdf-review.ts
// Writes one PDF per variant/scenario under docs/review/quote-pdf/; the
// companion node script rasterizes them to PNG review artifacts.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderComercialQuotePdf, renderResumidaQuotePdf } from '../src/lib/pdf'
import {
  comercialSnapshot,
  multiPageSnapshot,
  representativeSnapshot,
} from '../tests/unit/quote-pdf-snapshots'

const outDir = fileURLToPath(new URL('../docs/review/quote-pdf/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const documents = [
  { name: 'resumida-representative', render: renderResumidaQuotePdf, snapshot: representativeSnapshot },
  { name: 'comercial-representative', render: renderComercialQuotePdf, snapshot: comercialSnapshot },
  { name: 'resumida-multipage', render: renderResumidaQuotePdf, snapshot: multiPageSnapshot() },
  { name: 'comercial-multipage', render: renderComercialQuotePdf, snapshot: multiPageSnapshot() },
] as const

for (const doc of documents) {
  const buffer = await doc.render(doc.snapshot)
  writeFileSync(`${outDir}${doc.name}.pdf`, buffer)
  console.log(`${doc.name}.pdf ${(buffer.byteLength / 1024).toFixed(0)}KiB`)
}
