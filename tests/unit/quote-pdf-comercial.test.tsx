import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  ComercialQuotePdfDocument,
  renderComercialQuotePdf,
  type QuotePdfSnapshot,
} from '@/lib/pdf'

const representativeSnapshot = {
  document: {
    quoteId: 'quote-comercial-1',
    quoteNumber: 'ORC-2026-000043',
    revision: 1,
    statusLabel: 'Enviado',
    issuedOn: '2026-08-21',
    validUntil: '2026-09-05',
    currencyCode: 'BRL',
  },
  client: {
    legalName: 'Cliente Demonstração Nordeste Ltda.',
    tradeName: 'Cliente Demonstração',
    taxId: '12.345.678/0001-90',
    stateRegistration: '123.456.789',
    contactName: 'Contato de Compras',
    email: 'compras@example.invalid',
    phone: '(81) 99999-0000',
    addressLines: ['Avenida de Exemplo, 1000', 'Recife · PE · 50000-000'],
  },
  representative: {
    name: 'Carolina Weyne',
    role: 'Representação comercial',
    email: 'carolina@weynerepresentacoes.example.invalid',
    phone: '(81) 99999-0101',
  },
  industry: {
    legalName: 'Indústria Demonstração S.A.',
    tradeName: 'Indústria Demonstração',
    taxId: '98.765.432/0001-10',
  },
  terms: {
    validityLabel: 'Proposta válida por 15 dias corridos',
    paymentTerms: '28 / 35 / 42 dias',
    freightTerms: 'CIF — incluso no total informado',
    carrierName: 'Transportadora Demonstração',
    deliveryEstimate: 'Até 10 dias úteis após confirmação',
  },
  items: [
    {
      lineId: 'line-1',
      position: 1,
      internalCode: 'PROD-001',
      manufacturerCode: 'FAB-9001',
      description:
        'Detergente neutro concentrado para higienização profissional de superfícies laváveis',
      brand: 'Marca Demonstração',
      unit: 'CX',
      packaging: '4 × 5 L',
      quantity: '12.000000',
      unitPriceAmount: '125.500000',
      grossAmount: '1506.00',
      lineDiscountRate: '5.000000',
      lineDiscountAmount: '75.30',
      overallDiscountAllocationAmount: '35.77',
      netMerchandiseAmount: '1394.93',
      taxLines: [
        {
          code: 'ipi',
          label: 'IPI',
          rate: '5.000000',
          basisAmount: '1394.93',
          amount: '69.75',
          includedInGrandTotal: true,
        },
      ],
      lineTotalAmount: '1464.68',
      image: null,
    },
  ],
  totals: {
    grossItemsAmount: '1506.00',
    lineDiscountAmount: '75.30',
    netAfterLineDiscountAmount: '1430.70',
    overallDiscountAmount: '35.77',
    netMerchandiseAmount: '1394.93',
    taxTotals: [
      {
        code: 'ipi',
        label: 'IPI',
        basisAmount: '1394.93',
        amount: '69.75',
        includedInGrandTotal: true,
      },
    ],
    freightAmount: '25.00',
    grandTotalAmount: '1489.68',
  },
  notes:
    'Valores e condições correspondem exclusivamente a esta revisão. Preservar acentos: higienização, condições, observações e aprovação.',
  signatures: [
    { label: 'Representante', name: 'Carolina Weyne', role: 'Representação comercial' },
    { label: 'Aceite do cliente', name: null, role: null },
  ],
  branding: {
    companyName: 'Weyne Representações',
    companyLogo: null,
    industryLogo: null,
  },
} as const satisfies QuotePdfSnapshot

const pageCount = (buffer: Buffer) =>
  Array.from(buffer.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)).length

describe('comercial premium quote PDF', () => {
  it('renders a valid premium PDF under Node with intentional image fallbacks', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const buffer = await renderComercialQuotePdf(representativeSnapshot)

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(buffer.byteLength).toBeGreaterThan(2_000)
    expect(pageCount(buffer)).toBeGreaterThanOrEqual(1)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('keeps many long pt-BR product rows and long notes flowing across pages', async () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      ...representativeSnapshot.items[0],
      lineId: `line-${index + 1}`,
      position: index + 1,
      internalCode: `PROD-${String(index + 1).padStart(3, '0')}`,
      description: `${representativeSnapshot.items[0].description} — variação ${index + 1} com conteúdo acentuado e descrição longa`,
    }))
    const snapshot: QuotePdfSnapshot = {
      ...representativeSnapshot,
      client: {
        ...representativeSnapshot.client,
        legalName:
          'Cliente Demonstração com razão social extensa para validar quebra determinística de conteúdo',
      },
      items,
      notes: `${representativeSnapshot.notes} `.repeat(10),
    }

    const buffer = await renderComercialQuotePdf(snapshot)

    expect(pageCount(buffer)).toBeGreaterThan(1)
  }, 15_000)

  it('renders intentionally when every optional section value is absent', async () => {
    const snapshot: QuotePdfSnapshot = {
      ...representativeSnapshot,
      client: {
        ...representativeSnapshot.client,
        tradeName: null,
        taxId: null,
        stateRegistration: null,
        contactName: null,
        email: null,
        phone: null,
        addressLines: [],
      },
      representative: {
        ...representativeSnapshot.representative,
        email: null,
        phone: null,
      },
      industry: null,
      terms: {
        ...representativeSnapshot.terms,
        carrierName: null,
        deliveryEstimate: null,
      },
      notes: null,
      signatures: [],
      branding: {
        ...representativeSnapshot.branding,
        industryLogo: null,
      },
    }

    const buffer = await renderComercialQuotePdf(snapshot)

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(pageCount(buffer)).toBeGreaterThanOrEqual(1)
  })

  it('uses no browser APIs, remote assets, or financial calculation engine', () => {
    expect(ComercialQuotePdfDocument).toBeTypeOf('function')
    const source = readFileSync(
      new URL('../../src/lib/pdf/comercial.server.tsx', import.meta.url),
      'utf8',
    )

    expect(source).not.toMatch(/\b(?:window\.|globalThis\.document|HTMLElement|fetch\s*\()/)
    expect(source).not.toMatch(/https?:\/\//)
    expect(source).not.toMatch(/decimal\.js|quote-engine|calculate/i)
  })
})
