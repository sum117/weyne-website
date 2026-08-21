import type { QuotePdfSnapshot } from '@/lib/pdf'

/**
 * Deterministic seeded PDF snapshots shared by the variant suites and the
 * text-extraction acceptance suite. Monetary values are identical across
 * variants and match the independently asserted PRICE_2 scenario covered by
 * tests/integration/quote-pricing.test.ts.
 */

const resumidaSnapshot = {
  document: {
    quoteId: 'quote-resumida-1',
    quoteNumber: 'ORC-2026-000042',
    revision: 3,
    statusLabel: 'Aprovado',
    issuedOn: '2026-08-17',
    validUntil: '2026-09-01',
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
    name: 'Representante Weyne',
    role: 'Representação comercial',
    email: 'representante@example.invalid',
    phone: '(85) 99999-0000',
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
    { label: 'Representante', name: 'Representante Weyne', role: 'Representação comercial' },
    { label: 'Aceite do cliente', name: null, role: null },
  ],
  branding: {
    companyName: 'Weyne Representações',
    companyLogo: null,
    industryLogo: null,
  },
} as const satisfies QuotePdfSnapshot

/** Same seeded totals as `resumidaSnapshot`, different document identity. */
export const comercialSnapshot = {
  ...resumidaSnapshot,
  document: {
    ...resumidaSnapshot.document,
    quoteId: 'quote-comercial-1',
    quoteNumber: 'ORC-2026-000043',
    revision: 1,
    statusLabel: 'Enviado',
    issuedOn: '2026-08-21',
    validUntil: '2026-09-05',
  },
  representative: {
    ...resumidaSnapshot.representative,
    name: 'Carolina Weyne',
    email: 'carolina@weynerepresentacoes.example.invalid',
    phone: '(81) 99999-0101',
  },
  signatures: [
    { label: 'Representante', name: 'Carolina Weyne', role: 'Representação comercial' },
    { label: 'Aceite do cliente', name: null, role: null },
  ],
} as const satisfies QuotePdfSnapshot

export const representativeSnapshot = resumidaSnapshot

/**
 * Deterministic multi-page variant of the representative seeded snapshot:
 * 28 long pt-BR product rows plus extended notes force pagination in both
 * variants while keeping every monetary value identical to the independently
 * asserted seeded totals.
 */
export function multiPageSnapshot(): QuotePdfSnapshot {
  const items = Array.from({ length: 28 }, (_, index) => ({
    ...resumidaSnapshot.items[0],
    lineId: `line-${index + 1}`,
    position: index + 1,
    internalCode: `PROD-${String(index + 1).padStart(3, '0')}`,
    description: `${resumidaSnapshot.items[0].description} — variação ${index + 1} com conteúdo acentuado`,
  }))
  return {
    ...resumidaSnapshot,
    client: {
      ...resumidaSnapshot.client,
      legalName:
        'Cliente Demonstração com razão social extensa para validar quebra determinística de conteúdo',
    },
    items,
    notes: `${resumidaSnapshot.notes} `.repeat(8),
  }
}
