import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  QuotePdfFoundationDocument,
  formatPtBrCurrency,
  formatPtBrDate,
  formatPtBrDecimal,
  getBundledPdfAssets,
  renderQuotePdfToBuffer,
  resolvePdfImageSource,
  type QuotePdfSnapshot,
} from '@/lib/pdf'

const minimalSnapshot = {
  document: {
    quoteId: 'quote-1',
    quoteNumber: 'ORC-2026-000001',
    revision: 2,
    statusLabel: 'Enviado',
    issuedOn: '2026-08-17',
    validUntil: '2026-08-31',
    currencyCode: 'BRL',
  },
  client: {
    legalName: 'Hospital São José Ltda.',
    tradeName: 'Hospital São José',
    taxId: '12.345.678/0001-90',
    stateRegistration: null,
    contactName: 'Ana Beatriz',
    email: 'compras@example.com',
    phone: null,
    addressLines: ['Rua do Sol, 123', 'Recife · PE · 50000-000'],
  },
  representative: {
    name: 'Carolina Weyne',
    role: 'Representante comercial',
    email: null,
    phone: null,
  },
  industry: null,
  terms: {
    validityLabel: 'Válida até 31/08/2026',
    paymentTerms: '28 dias',
    freightTerms: 'CIF',
    carrierName: null,
    deliveryEstimate: null,
  },
  items: [
    {
      lineId: 'line-1',
      position: 1,
      internalCode: 'PROD-001',
      manufacturerCode: null,
      description: 'Detergente neutro concentrado',
      brand: null,
      unit: 'CX',
      packaging: '4 × 5 L',
      quantity: '2.000000',
      unitPriceAmount: '125.500000',
      grossAmount: '251.00',
      lineDiscountRate: '5.000000',
      lineDiscountAmount: '12.55',
      overallDiscountAllocationAmount: '2.38',
      netMerchandiseAmount: '236.07',
      taxLines: [
        {
          code: 'ipi',
          label: 'IPI',
          rate: '5.000000',
          basisAmount: '236.07',
          amount: '11.80',
          includedInGrandTotal: false,
        },
      ],
      lineTotalAmount: '236.07',
      image: null,
    },
  ],
  totals: {
    grossItemsAmount: '251.00',
    lineDiscountAmount: '12.55',
    netAfterLineDiscountAmount: '238.45',
    overallDiscountAmount: '2.38',
    netMerchandiseAmount: '236.07',
    taxTotals: [
      {
        code: 'ipi',
        label: 'IPI',
        basisAmount: '236.07',
        amount: '11.80',
        includedInGrandTotal: false,
      },
    ],
    freightAmount: '0.00',
    grandTotalAmount: '236.07',
  },
  notes: null,
  signatures: [
    { label: 'Representante', name: 'Carolina Weyne', role: null },
    { label: 'Cliente', name: null, role: null },
  ],
  branding: {
    companyName: 'Weyne Representações',
    companyLogo: null,
    industryLogo: null,
  },
} as const satisfies QuotePdfSnapshot

describe('shared quote PDF foundation', () => {
  it('formats supplied snapshot strings deterministically for pt-BR', () => {
    expect(formatPtBrDate('2026-08-17')).toBe('17/08/2026')
    expect(formatPtBrDecimal('1234567.500000', { maximumFractionDigits: 6 })).toBe(
      '1.234.567,5',
    )
    expect(formatPtBrDecimal('2.000000', { maximumFractionDigits: 6 })).toBe('2')
    expect(formatPtBrCurrency('1234567.50')).toBe('R$ 1.234.567,50')
    expect(formatPtBrCurrency('10.005000')).toBe('R$ 10,005')
    expect(formatPtBrCurrency('0.00')).toBe('R$ 0,00')
    expect(() => formatPtBrCurrency('10.0050001')).toThrow('fraction digits')
  })

  it('models every rendered value as an immutable supplied snapshot', () => {
    expectTypeOf(minimalSnapshot).toMatchTypeOf<QuotePdfSnapshot>()
    expect(minimalSnapshot.totals.grandTotalAmount).toBe('236.07')
    expect(minimalSnapshot.items[0].lineTotalAmount).toBe('236.07')
  })

  it('renders under Node when every optional image is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const buffer = await renderQuotePdfToBuffer(
      <QuotePdfFoundationDocument snapshot={minimalSnapshot} />,
    )

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(buffer.byteLength).toBeGreaterThan(2_000)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('resolves all foundation assets from local files', () => {
    const assets = getBundledPdfAssets()

    expect(assets.companyLogo).not.toMatch(/^https?:/)
    expect(assets.fonts.jostRegular).not.toMatch(/^https?:/)
    expect(assets.fonts.newsreaderRegular).not.toMatch(/^https?:/)
    expect(readFileSync(assets.companyLogo).byteLength).toBeGreaterThan(100)
    expect(readFileSync(assets.fonts.jostRegular).byteLength).toBeGreaterThan(100)
    expect(readFileSync(assets.fonts.newsreaderRegular).byteLength).toBeGreaterThan(100)
  })

  it('refuses remote, data, and blob URI image sources instead of fetching them', () => {
    const hostilePaths = [
      'https://evil.example/logo.png',
      'http://evil.example/logo.png',
      'data:image/png;base64,aGVsbG8=',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://evil.example/1234',
      'file://C:/Windows/win.ini',
      '\\\\server\\share\\logo.png',
    ]
    for (const path of hostilePaths) {
      expect(
        resolvePdfImageSource({ kind: 'local-path', path }),
        `expected ${path} to be rejected`,
      ).toBeNull()
    }

    // Legitimate inline bytes still render.
    expect(
      resolvePdfImageSource({ kind: 'bytes', data: new Uint8Array([1, 2, 3]) }),
    ).not.toBeNull()
  })

  it('keeps rendering free of browser APIs, remote assets, and financial engines', () => {
    const source = [
      'src/lib/pdf/components.tsx',
      'src/lib/pdf/render.server.tsx',
    ]
      .map((path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))
      .join('\n')

    expect(source).not.toMatch(/\b(?:window\.|globalThis\.document|HTMLElement|fetch\s*\()/)
    expect(source).not.toMatch(/https?:\/\//)
    expect(source).not.toMatch(/decimal\.js|quote-engine|calculate/i)
  })
})
