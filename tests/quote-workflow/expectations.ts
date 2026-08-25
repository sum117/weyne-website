/**
 * Independently defined deterministic expectations for the quote workflow
 * acceptance suite (kanban t_391798ac).
 *
 * Every number here is hand-calculated from the seeded master data and the
 * published rounding contract (money at 2dp, ROUND_HALF_UP, largest-remainder
 * allocation for the general discount). Nothing is derived from client state
 * or from other test runs; tests/integration/quote-pricing.test.ts proves the
 * same scenario against the server engine.
 */

/** Canonical price-list identities seeded by drizzle/0001_catalog_pricing.sql. */
export const PRICE_LISTS = {
  price1: {
    id: '00000000-0000-4000-8000-000000000001',
    key: 'PRICE_1',
    displayName: 'Preço 1',
  },
  price2: {
    id: '00000000-0000-4000-8000-000000000002',
    key: 'PRICE_2',
    displayName: 'Preço 2',
  },
} as const

export const CUSTOMER_ID = '10000000-0000-4000-8000-000000000001'
export const INDUSTRY_ID = '10000000-0000-4000-8000-000000000002'

export const PRODUCTS = {
  a: { id: '10000000-0000-4000-8000-000000000003', internalCode: 'QUOTE-A', description: 'Produto sintético A' },
  b: { id: '10000000-0000-4000-8000-000000000004', internalCode: 'QUOTE-B', description: 'Produto sintético B' },
  c: { id: '10000000-0000-4000-8000-000000000005', internalCode: 'QUOTE-C', description: 'Produto sintético C' },
} as const

/** Seeded prices per list (six-place Decimal strings). */
export const SEEDED_PRICES = {
  price1: { [PRODUCTS.a.id]: '12.000000', [PRODUCTS.b.id]: '21.500000', [PRODUCTS.c.id]: '27.250000' },
  price2: { [PRODUCTS.a.id]: '10.005000', [PRODUCTS.b.id]: '19.990000', [PRODUCTS.c.id]: '25.000000' },
} as const

/** The workflow order applied through the UI. */
export const WORKFLOW_ORDER = {
  priceListId: PRICE_LISTS.price2.id,
  generalDiscountRate: '7.5',
  freightAmount: '12.345',
  lines: [
    { productId: PRODUCTS.a.id, quantity: '3', lineDiscountRate: '5' },
    { productId: PRODUCTS.b.id, quantity: '2.5', lineDiscountRate: '10' },
    { productId: PRODUCTS.c.id, quantity: '1', lineDiscountRate: '0' },
  ],
} as const

/** Header totals for WORKFLOW_ORDER — hand-calculated, server-authoritative. */
export const EXPECTED_TOTALS = {
  grossItemsAmount: '105.00',
  perItemDiscountAmount: '6.50',
  netItemsAmount: '98.50',
  generalDiscountAmount: '7.39',
  netAfterDiscountsAmount: '91.11',
  ipiAmount: '2.18',
  configuredTaxAmount: '9.74',
  freightAmount: '12.35',
  grandTotalAmount: '103.46',
} as const

/** Per-line expectations keyed by product id (order-independent). */
export const EXPECTED_LINES = {
  [PRODUCTS.a.id]: {
    unitPrice: '10.005000',
    gross: '30.02',
    lineDiscount: '1.50',
    generalDiscount: '2.14',
    merchandise: '26.38',
    ipi: '1.35',
    configuredTax: '4.75',
  },
  [PRODUCTS.b.id]: {
    unitPrice: '19.990000',
    gross: '49.98',
    lineDiscount: '5.00',
    generalDiscount: '3.37',
    merchandise: '41.61',
    ipi: '0.83',
    configuredTax: '4.99',
  },
  [PRODUCTS.c.id]: {
    unitPrice: '25.000000',
    gross: '25.00',
    lineDiscount: '0.00',
    generalDiscount: '1.88',
    merchandise: '23.12',
    ipi: '0.00',
    configuredTax: '0.00',
  },
} as const

/** pt-BR rendering of the authoritative grand total, as the UI must show it. */
export const EXPECTED_GRAND_TOTAL_PTBR = 'R$ 103,46'

export const ACTORS = {
  owner: { id: 'representative-1', role: 'representative' },
  admin: { id: 'admin-1', role: 'admin' },
  readOnly: { id: 'auditor-1', role: 'read_only' },
  outsider: { id: 'representative-9', role: 'representative' },
} as const

/** Fixed template identities used by the two PDF variants. */
export const PDF_TEMPLATES = {
  summary: { id: '30000000-0000-4000-8000-000000000001', version: 1 },
  commercial: { id: '30000000-0000-4000-8000-000000000002', version: 1 },
} as const

export function formatPtBr(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value
  const [integer = '', fraction = ''] = value.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const padded = fraction.padEnd(2, '0')
  return `${grouped},${padded}`
}
