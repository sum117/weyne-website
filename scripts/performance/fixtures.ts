export const PERFORMANCE_FIXTURE_PROFILES = Object.freeze({
  smoke: Object.freeze({
    tenants: 2,
    representatives: 8,
    clients: 200,
    industries: 12,
    products: 500,
    quotes: 1_000,
    linesPerQuote: 6,
    attachments: 250,
  }),
  standard: Object.freeze({
    tenants: 4,
    representatives: 40,
    clients: 5_000,
    industries: 40,
    products: 10_000,
    quotes: 25_000,
    linesPerQuote: 6,
    attachments: 5_000,
  }),
})

export type PerformanceFixtureProfile = keyof typeof PERFORMANCE_FIXTURE_PROFILES

type FixtureTenant = Readonly<{ id: string; name: string }>
type FixtureRepresentative = Readonly<{
  id: string
  tenantId: string
  name: string
}>
type FixtureClient = Readonly<{
  id: string
  tenantId: string
  legalName: string
  state: string
}>
type FixtureIndustry = Readonly<{
  id: string
  tenantId: string
  legalName: string
}>
type FixtureProduct = Readonly<{
  id: string
  tenantId: string
  industryId: string
  internalCode: string
  description: string
  category: string
  unitPriceCents: number
  active: boolean
}>
type FixtureQuote = Readonly<{
  id: string
  tenantId: string
  representativeId: string
  clientId: string
  number: string
  status: 'draft' | 'sent' | 'approved' | 'rejected' | 'expired' | 'converted' | 'cancelled'
  issuedOn: string
  totalCents: number
}>
type FixtureQuoteLine = Readonly<{
  id: string
  quoteId: string
  productId: string
  position: number
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}>
type FixtureAttachment = Readonly<{
  id: string
  productId: string
  objectKey: string
  mimeType: 'application/pdf' | 'image/webp'
  sizeBytes: number
}>

export type PerformanceFixture = Readonly<{
  metadata: Readonly<{
    profile: PerformanceFixtureProfile
    seed: number
    generatedAt: '2026-01-01T00:00:00.000Z'
  }>
  tenants: readonly FixtureTenant[]
  representatives: readonly FixtureRepresentative[]
  clients: readonly FixtureClient[]
  industries: readonly FixtureIndustry[]
  products: readonly FixtureProduct[]
  quotes: readonly FixtureQuote[]
  quoteLines: readonly FixtureQuoteLine[]
  attachments: readonly FixtureAttachment[]
}>

type FixtureCounts = Readonly<{
  tenants: number
  representatives: number
  clients: number
  industries: number
  products: number
  quotes: number
  quoteLines: number
  attachments: number
}>

const STATES = ['CE', 'PE', 'BA', 'RN', 'PB', 'AL', 'SE', 'PI', 'MA'] as const
const CATEGORIES = ['higiene', 'limpeza', 'descartaveis', 'lavanderia', 'cozinha'] as const
const QUOTE_STATUSES = [
  'draft',
  'sent',
  'approved',
  'rejected',
  'expired',
  'converted',
  'cancelled',
] as const

export function createPerformanceFixture(options: {
  readonly profile: PerformanceFixtureProfile
  readonly seed: number
}): PerformanceFixture {
  const profile = PERFORMANCE_FIXTURE_PROFILES[options.profile]
  if (!profile) {
    throw new Error(`Unknown performance fixture profile: ${String(options.profile)}`)
  }
  if (!Number.isSafeInteger(options.seed)) {
    throw new Error('Performance fixture seed must be a safe integer')
  }

  const random = createRandom(options.seed)
  const tenants = createDistributed(profile.tenants, profile.tenants, (index) => ({
    id: deterministicUuid('tenant', index),
    name: `Conta sintética ${String(index + 1).padStart(2, '0')}`,
  }))
  const representatives = createDistributed(
    profile.representatives,
    profile.tenants,
    (index, tenantIndex) => ({
      id: deterministicUuid('representative', index),
      tenantId: tenants[tenantIndex]!.id,
      name: `Representante sintético ${String(index + 1).padStart(3, '0')}`,
    }),
  )
  const clients = createDistributed(profile.clients, profile.tenants, (index, tenantIndex) => ({
    id: deterministicUuid('client', index),
    tenantId: tenants[tenantIndex]!.id,
    legalName: `Cliente sintético ${String(index + 1).padStart(5, '0')} Ltda.`,
    state: STATES[index % STATES.length]!,
  }))
  const industries = createDistributed(
    profile.industries,
    profile.tenants,
    (index, tenantIndex) => ({
      id: deterministicUuid('industry', index),
      tenantId: tenants[tenantIndex]!.id,
      legalName: `Indústria sintética ${String(index + 1).padStart(3, '0')} S.A.`,
    }),
  )
  const industryRanges = rangesByTenant(industries)
  const products = createDistributed(profile.products, profile.tenants, (index, tenantIndex) => {
    const industryRange = industryRanges[tenantIndex]!
    return {
      id: deterministicUuid('product', index),
      tenantId: tenants[tenantIndex]!.id,
      industryId: industries[pickInRange(random, industryRange)]!.id,
      internalCode: `SYN-${String(index + 1).padStart(6, '0')}`,
      description: `Produto sintético para carga ${String(index + 1).padStart(6, '0')}`,
      category: CATEGORIES[index % CATEGORIES.length]!,
      unitPriceCents: 500 + Math.floor(random() * 99_500),
      active: index % 23 !== 0,
    }
  })
  const representativeRanges = rangesByTenant(representatives)
  const clientRanges = rangesByTenant(clients)
  const productRanges = rangesByTenant(products)
  const quotes = createDistributed(profile.quotes, profile.tenants, (index, tenantIndex) => ({
    id: deterministicUuid('quote', index),
    tenantId: tenants[tenantIndex]!.id,
    representativeId:
      representatives[pickInRange(random, representativeRanges[tenantIndex]!)]!.id,
    clientId: clients[pickInRange(random, clientRanges[tenantIndex]!)]!.id,
    number: `ORC-2026-${String(index + 1).padStart(6, '0')}`,
    status: QUOTE_STATUSES[Math.floor(random() * QUOTE_STATUSES.length)]!,
    issuedOn: isoDateFromDay(index % 365),
    totalCents: 10_000 + Math.floor(random() * 990_000),
  }))
  const quoteLines: FixtureQuoteLine[] = new Array(profile.quotes * profile.linesPerQuote)
  let lineIndex = 0
  for (const quote of quotes) {
    const tenantIndex = tenants.findIndex(({ id }) => id === quote.tenantId)
    const productRange = productRanges[tenantIndex]!
    for (let position = 1; position <= profile.linesPerQuote; position += 1) {
      const product = products[pickInRange(random, productRange)]!
      const quantity = 1 + Math.floor(random() * 20)
      quoteLines[lineIndex] = {
        id: deterministicUuid('quote-line', lineIndex),
        quoteId: quote.id,
        productId: product.id,
        position,
        quantity,
        unitPriceCents: product.unitPriceCents,
        lineTotalCents: product.unitPriceCents * quantity,
      }
      lineIndex += 1
    }
  }
  const attachments = createDistributed(
    profile.attachments,
    profile.tenants,
    (index, tenantIndex) => {
      const product = products[pickInRange(random, productRanges[tenantIndex]!)]!
      const isPdf = index % 3 === 0
      return {
        id: deterministicUuid('attachment', index),
        productId: product.id,
        objectKey: `synthetic/${product.id}/${String(index + 1).padStart(6, '0')}.${isPdf ? 'pdf' : 'webp'}`,
        mimeType: isPdf
          ? ('application/pdf' as const)
          : ('image/webp' as const),
        sizeBytes: isPdf ? 64_000 + (index % 512) * 1_024 : 24_000 + (index % 128) * 512,
      }
    },
  )

  return {
    metadata: {
      profile: options.profile,
      seed: options.seed,
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
    tenants,
    representatives,
    clients,
    industries,
    products,
    quotes,
    quoteLines,
    attachments,
  }
}

export function summarizePerformanceFixture(fixture: PerformanceFixture): FixtureCounts {
  return {
    tenants: fixture.tenants.length,
    representatives: fixture.representatives.length,
    clients: fixture.clients.length,
    industries: fixture.industries.length,
    products: fixture.products.length,
    quotes: fixture.quotes.length,
    quoteLines: fixture.quoteLines.length,
    attachments: fixture.attachments.length,
  }
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function createDistributed<T>(
  count: number,
  tenantCount: number,
  factory: (index: number, tenantIndex: number) => T,
): T[] {
  const values: T[] = new Array(count)
  for (let index = 0; index < count; index += 1) {
    values[index] = factory(index, Math.min(tenantCount - 1, Math.floor((index * tenantCount) / count)))
  }
  return values
}

function rangesByTenant<T extends { tenantId: string }>(
  values: readonly T[],
): Array<Readonly<{ start: number; length: number }>> {
  const ranges: Array<{ start: number; length: number }> = []
  for (let index = 0; index < values.length; index += 1) {
    const previous = values[index - 1]
    if (!previous || previous.tenantId !== values[index]!.tenantId) {
      ranges.push({ start: index, length: 1 })
    } else {
      ranges[ranges.length - 1]!.length += 1
    }
  }
  return ranges
}

function pickInRange(
  random: () => number,
  range: Readonly<{ start: number; length: number }>,
): number {
  return range.start + Math.floor(random() * range.length)
}

function deterministicUuid(kind: string, index: number): string {
  const namespace = hash32(kind).toString(16).padStart(8, '0')
  const sequence = (index + 1).toString(16).padStart(12, '0')
  return `${namespace}-0000-4000-8000-${sequence}`
}

function hash32(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function isoDateFromDay(dayOffset: number): string {
  const date = new Date(Date.UTC(2025, 0, 1 + dayOffset))
  return date.toISOString().slice(0, 10)
}
