import { describe, expect, it } from 'vitest'
import { renderComercialQuotePdf, renderResumidaQuotePdf, type QuotePdfSnapshot } from '@/lib/pdf'
import { extractPdfPages } from '../support/pdf-text'
import {
  comercialSnapshot,
  multiPageSnapshot,
  representativeSnapshot,
} from './quote-pdf-snapshots'

/**
 * Text-extraction acceptance for both required PDF variants: every generated
 * page is parsed with pdf.js and the displayed values must agree with the
 * independently asserted snapshot totals (the same seeded scenario covered by
 * tests/integration/quote-pricing.test.ts), including the fixed footer on
 * every page.
 */

const expected = {
  gross: 'R$ 1.506,00',
  lineDiscount: '75,30',
  overallDiscountAllocation: 'R$ 35,77',
  netMerchandise: '1.394,93',
  ipi: 'IPI 5% · R$ 69,75',
  freight: '25,00',
  grandTotal: 'Total do orçamento R$ 1.489,68',
  company: 'Weyne Representações',
}

const variantCases = [
  { variant: 'resumida', render: renderResumidaQuotePdf, snapshot: representativeSnapshot },
  { variant: 'comercial', render: renderComercialQuotePdf, snapshot: comercialSnapshot },
] as const

async function pagesFor(
  render: (snapshot: QuotePdfSnapshot) => Promise<Buffer>,
  snapshot: QuotePdfSnapshot,
) {
  return extractPdfPages(await render(snapshot))
}

describe.each(variantCases)('$variant PDF text extraction', ({ render, snapshot }) => {
  it('displays quote identity, customer, product, taxes, freight, and totals matching the asserted values', async () => {
    const pages = await pagesFor(render, snapshot)

    expect(pages.length).toBeGreaterThanOrEqual(1)
    const allText = pages.map((page) => page.text).join(' ')

    const documentFields = [
      snapshot.document.quoteNumber,
      `Revisão ${snapshot.document.revision}`,
      snapshot.document.statusLabel,
      snapshot.client.legalName,
      snapshot.items[0].internalCode,
    ]
    const monetaryFields = [
      expected.gross,
      expected.lineDiscount,
      expected.overallDiscountAllocation,
      expected.netMerchandise,
      expected.ipi,
      expected.freight,
      expected.grandTotal,
    ]

    for (const needle of [...documentFields, ...monetaryFields, expected.company]) {
      expect(allText.includes(needle), `missing extracted field: ${needle}`).toBe(true)
    }
  }, 30_000)

  it('renders the company footer with correct pagination on every page', async () => {
    const long = multiPageSnapshot()
    const pages = await pagesFor(render, long)
    expect(pages.length).toBeGreaterThan(1)

    for (const page of pages) {
      expect(page.footerText).toContain(expected.company)
      expect(page.footerText).toContain(long.document.quoteNumber)
      expect(page.footerText).toContain(`Página ${page.pageNumber} de ${pages.length}`)
    }

    // The footer band must stay confined to the fixed footer, never duplicated
    // inside the flowing body.
    for (const page of pages) {
      const bodyBand = page.text.replace(page.footerText, '').trim()
      expect(bodyBand).not.toContain(`Página ${page.pageNumber} de ${pages.length}`)
    }
  }, 45_000)

  it('keeps long responsive content flowing without clipping the footer band', async () => {
    const base = multiPageSnapshot()
    const long: QuotePdfSnapshot = {
      ...base,
      items: base.items.map((item, index) => ({
        ...item,
        description:
          index % 2 === 0
            ? `${item.description} — higienização`
            : `${item.description} — desinfectanteenzimáticoparainstrumentalcirúrgicodelicado`,
      })),
    }

    const pages = await pagesFor(render, long)
    for (const page of pages) {
      // An intact footer band on each page proves the fixed subtree was not
      // pushed out of the clipped area by overflowing content.
      expect(page.footerText).toContain(`Página ${page.pageNumber} de ${pages.length}`)
      expect(page.text.length).toBeGreaterThan(page.footerText.length)
    }
  }, 45_000)
})
