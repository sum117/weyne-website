import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { QuotePdfFoundationDocument, renderQuotePdfToBuffer, type QuotePdfSnapshot } from '../../src/lib/pdf'
import {
  createPerformanceFixture,
  summarizePerformanceFixture,
  type PerformanceFixture,
  type PerformanceFixtureProfile,
} from './fixtures'

type ScenarioResult = Readonly<{
  samples: number
  p50Ms: number
  p95Ms: number
  throughputItemsPerSecond: number
  queryCount: 0
  heapDeltaBytes: number
  payloadBytes: number
}>

type Scenario = Readonly<{
  name: string
  samples: number
  itemsPerRun: number
  payloadBytes?: number
  run: () => Promise<unknown> | unknown
}>

const profile = parseProfile(process.argv[2])
const seed = parseSeed(process.argv[3])
const generationStarted = performance.now()
const fixture = createPerformanceFixture({ profile, seed })
const generationMs = performance.now() - generationStarted
const scenarios = createScenarios(fixture)
const scenarioResults: Record<string, ScenarioResult> = {}

for (const scenario of scenarios) {
  scenarioResults[scenario.name] = await measureScenario(scenario)
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: {
    runtime: `Bun ${process.versions.bun ?? 'unknown'}`,
    platform: `${process.platform}-${process.arch}`,
    cpuCount: navigator.hardwareConcurrency,
    profile,
    seed,
    coldWarmAssumptions: {
      fixtureGeneration: 'cold: generated once in a fresh process',
      scenarios: 'one unrecorded warm-up, then recorded sequential samples in one process',
      database: 'not used by this fixture baseline; queryCount is explicitly zero',
      network: 'excluded; upload measures bounded validation and SHA-256 only',
      pdf: 'bundled fonts are registered locally; no remote assets',
    },
  },
  fixture: {
    counts: summarizePerformanceFixture(fixture),
    generationMs: round(generationMs),
    digest: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
  },
  scenarios: scenarioResults,
  bundle: await measureClientBundle(path.resolve('dist/client')),
}

console.log(JSON.stringify(output, null, 2))

function createScenarios(fixture: PerformanceFixture): Scenario[] {
  const tenantId = fixture.tenants[0]!.id
  const productById = new Map(fixture.products.map((product) => [product.id, product]))
  const industryById = new Map(fixture.industries.map((industry) => [industry.id, industry]))
  const linesByQuote = new Map<string, typeof fixture.quoteLines>()
  for (const line of fixture.quoteLines) {
    const current = linesByQuote.get(line.quoteId) ?? []
    linesByQuote.set(line.quoteId, [...current, line])
  }
  const exportRows = fixture.quoteLines.slice(0, 10_000)
  const upload = new Uint8Array(5 * 1024 * 1024)
  for (let index = 0; index < upload.length; index += 4_096) upload[index] = index % 251
  const pdfSnapshot = createPdfSnapshot(fixture)

  return [
    {
      name: 'primaryProductList',
      samples: 15,
      itemsPerRun: fixture.products.length,
      run: () => {
        const page = fixture.products
          .filter(
            (product) =>
              product.tenantId === tenantId && product.active && product.category === 'higiene',
          )
          .toSorted((left, right) => left.description.localeCompare(right.description, 'pt-BR'))
          .slice(0, 100)
        return JSON.stringify(page)
      },
    },
    {
      name: 'dashboardAggregation',
      samples: 15,
      itemsPerRun: fixture.quotes.length,
      run: () => {
        const totals = new Map<string, { count: number; totalCents: number }>()
        for (const quote of fixture.quotes) {
          if (quote.tenantId !== tenantId) continue
          const current = totals.get(quote.status) ?? { count: 0, totalCents: 0 }
          current.count += 1
          current.totalCents += quote.totalCents
          totals.set(quote.status, current)
        }
        return JSON.stringify([...totals.entries()])
      },
    },
    {
      name: 'reportAggregation',
      samples: 10,
      itemsPerRun: fixture.quoteLines.length,
      run: () => {
        const totals = new Map<string, { lines: number; totalCents: number }>()
        for (const quote of fixture.quotes) {
          if (quote.tenantId !== tenantId || quote.issuedOn < '2025-07-01') continue
          for (const line of linesByQuote.get(quote.id) ?? []) {
            const product = productById.get(line.productId)!
            const industry = industryById.get(product.industryId)!
            const current = totals.get(industry.id) ?? { lines: 0, totalCents: 0 }
            current.lines += 1
            current.totalCents += line.lineTotalCents
            totals.set(industry.id, current)
          }
        }
        return JSON.stringify(
          [...totals.entries()]
            .map(([industryId, total]) => ({
              industry: industryById.get(industryId)!.legalName,
              ...total,
            }))
            .toSorted((left, right) => right.totalCents - left.totalCents),
        )
      },
    },
    {
      name: 'csvExport10k',
      samples: 7,
      itemsPerRun: exportRows.length,
      run: () => {
        const rows = ['quote_id,product_id,quantity,unit_price_cents,line_total_cents']
        for (const line of exportRows) {
          rows.push(
            `${line.quoteId},${line.productId},${line.quantity},${line.unitPriceCents},${line.lineTotalCents}`,
          )
        }
        return rows.join('\n')
      },
    },
    {
      name: 'pdf40Lines',
      samples: 3,
      itemsPerRun: pdfSnapshot.items.length,
      run: () => renderQuotePdfToBuffer(<QuotePdfFoundationDocument snapshot={pdfSnapshot} />),
    },
    {
      name: 'uploadValidation5MiB',
      samples: 7,
      itemsPerRun: upload.byteLength,
      payloadBytes: upload.byteLength,
      run: () => {
        if (upload.byteLength > 10 * 1024 * 1024) throw new Error('Synthetic upload exceeds limit')
        return createHash('sha256').update(upload).digest('hex')
      },
    },
  ]
}

async function measureScenario(scenario: Scenario): Promise<ScenarioResult> {
  await scenario.run()
  const durations: number[] = []
  let heapDeltaBytes = 0
  let payloadBytes = 0

  for (let index = 0; index < scenario.samples; index += 1) {
    const heapBefore = process.memoryUsage().heapUsed
    const started = performance.now()
    const result = await scenario.run()
    durations.push(performance.now() - started)
    heapDeltaBytes = Math.max(heapDeltaBytes, process.memoryUsage().heapUsed - heapBefore)
    payloadBytes = Math.max(payloadBytes, scenario.payloadBytes ?? byteLength(result))
  }

  const sorted = durations.toSorted((left, right) => left - right)
  const totalMs = durations.reduce((total, duration) => total + duration, 0)
  return {
    samples: scenario.samples,
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    throughputItemsPerSecond: round((scenario.itemsPerRun * scenario.samples * 1_000) / totalMs),
    queryCount: 0,
    heapDeltaBytes: Math.max(0, heapDeltaBytes),
    payloadBytes,
  }
}

function createPdfSnapshot(fixture: PerformanceFixture): QuotePdfSnapshot {
  const quote = fixture.quotes[0]!
  const representative = fixture.representatives.find(({ id }) => id === quote.representativeId)!
  const client = fixture.clients.find(({ id }) => id === quote.clientId)!
  const sourceLines = fixture.quoteLines.filter(({ quoteId }) => quoteId === quote.id)
  const repeatedLines = Array.from({ length: 40 }, (_, index) => sourceLines[index % sourceLines.length]!)
  const items = repeatedLines.map((line, index) => {
    const product = fixture.products.find(({ id }) => id === line.productId)!
    return {
      lineId: `${line.id}-${index}`,
      position: index + 1,
      internalCode: product.internalCode,
      manufacturerCode: null,
      description: product.description,
      brand: 'Marca sintética',
      unit: 'CX',
      packaging: '4 × 5 L',
      quantity: `${line.quantity}.000000`,
      unitPriceAmount: decimal(line.unitPriceCents),
      grossAmount: decimal(line.lineTotalCents),
      lineDiscountRate: '0.000000',
      lineDiscountAmount: '0.00',
      overallDiscountAllocationAmount: '0.00',
      netMerchandiseAmount: decimal(line.lineTotalCents),
      taxLines: [],
      lineTotalAmount: decimal(line.lineTotalCents),
      image: null,
    }
  })
  const grandTotalCents = items.reduce(
    (total, item) => total + Math.round(Number(item.lineTotalAmount) * 100),
    0,
  )
  return {
    document: {
      quoteId: quote.id,
      quoteNumber: quote.number,
      revision: 1,
      statusLabel: 'Sintético',
      issuedOn: quote.issuedOn as `${number}-${number}-${number}`,
      validUntil: '2026-01-31',
      currencyCode: 'BRL',
    },
    client: {
      legalName: client.legalName,
      tradeName: null,
      taxId: null,
      stateRegistration: null,
      contactName: 'Contato sintético',
      email: 'synthetic@example.invalid',
      phone: null,
      addressLines: ['Endereço sintético', `${client.state} · Brasil`],
    },
    representative: {
      name: representative.name,
      role: 'Representante sintético',
      email: null,
      phone: null,
    },
    industry: null,
    terms: {
      validityLabel: 'Cenário sintético',
      paymentTerms: '28 dias',
      freightTerms: 'CIF',
      carrierName: null,
      deliveryEstimate: null,
    },
    items,
    totals: {
      grossItemsAmount: decimal(grandTotalCents),
      lineDiscountAmount: '0.00',
      netAfterLineDiscountAmount: decimal(grandTotalCents),
      overallDiscountAmount: '0.00',
      netMerchandiseAmount: decimal(grandTotalCents),
      taxTotals: [],
      freightAmount: '0.00',
      grandTotalAmount: decimal(grandTotalCents),
    },
    notes: 'Documento gerado exclusivamente com dados sintéticos.',
    signatures: [
      { label: 'Representante', name: representative.name, role: null },
      { label: 'Cliente', name: null, role: null },
    ],
    branding: { companyName: 'Weyne Representações', companyLogo: null, industryLogo: null },
  }
}

async function measureClientBundle(directory: string) {
  try {
    const files = await walk(directory)
    const javascript = files.filter((file) => /\.(?:js|mjs)$/.test(file))
    let rawBytes = 0
    let gzipBytes = 0
    let largestChunkBytes = 0
    for (const file of javascript) {
      const bytes = await readFile(file)
      rawBytes += bytes.byteLength
      gzipBytes += gzipSync(bytes).byteLength
      largestChunkBytes = Math.max(largestChunkBytes, bytes.byteLength)
    }
    return { available: true, javascriptFiles: javascript.length, rawBytes, gzipBytes, largestChunkBytes }
  } catch {
    return {
      available: false,
      reason: 'dist/client was not present; run bun run build before the benchmark',
    }
  }
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory)
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(directory, entry)
    if ((await stat(fullPath)).isDirectory()) files.push(...(await walk(fullPath)))
    else files.push(fullPath)
  }
  return files
}

function byteLength(value: unknown): number {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value))
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!
}

function decimal(cents: number): string {
  return (cents / 100).toFixed(2)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function parseProfile(value: string | undefined): PerformanceFixtureProfile {
  if (value === undefined) return 'standard'
  if (value === 'smoke' || value === 'standard') return value
  throw new Error(`Unknown performance fixture profile: ${value}`)
}

function parseSeed(value: string | undefined): number {
  if (value === undefined) return 20_260_817
  const seed = Number(value)
  if (!Number.isSafeInteger(seed)) throw new Error(`Invalid performance fixture seed: ${value}`)
  return seed
}
