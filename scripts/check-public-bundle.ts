import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

export type PublicBundleBudgets = {
  documentBytes: number
  javascriptBytes: number
  javascriptGzipBytes: number
  stylesheetBytes: number
  stylesheetGzipBytes: number
  totalCodeGzipBytes: number
}

export const PUBLIC_BUNDLE_BUDGETS: PublicBundleBudgets = {
  documentBytes: 90_000,
  javascriptBytes: 735_000,
  javascriptGzipBytes: 225_000,
  stylesheetBytes: 105_000,
  stylesheetGzipBytes: 20_000,
  totalCodeGzipBytes: 245_000,
}

const FORBIDDEN_PUBLIC_MARKERS = [
  '@react-pdf',
  '@aws-sdk',
  'drizzle-orm',
  'exceljs',
  'recharts',
  'Carregando produtos',
  'A estrutura está pronta para receber os módulos autenticados',
] as const

type AssetMeasurement = {
  path: string
  bytes: number
  gzipBytes: number
}

export type PublicBundleMeasurement = {
  document: AssetMeasurement
  javascript: AssetMeasurement[]
  stylesheets: AssetMeasurement[]
  totals: {
    javascriptBytes: number
    javascriptGzipBytes: number
    stylesheetBytes: number
    stylesheetGzipBytes: number
    totalCodeGzipBytes: number
  }
  violations: string[]
}

function referencedAssets(html: string, extension: '.js' | '.css'): string[] {
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value?.startsWith('/assets/')))
    .filter((value) => value.endsWith(extension))
  return [...new Set(references)]
}

function sum(items: AssetMeasurement[], key: 'bytes' | 'gzipBytes'): number {
  return items.reduce((total, item) => total + item[key], 0)
}

export async function measurePublicBundle(
  clientRoot = resolve(process.cwd(), 'dist/client'),
  budgets: PublicBundleBudgets = PUBLIC_BUNDLE_BUDGETS,
): Promise<PublicBundleMeasurement> {
  const htmlPath = resolve(clientRoot, 'index.html')
  const html = await readFile(htmlPath)
  const htmlText = html.toString('utf8')

  async function measure(assetPath: string): Promise<AssetMeasurement> {
    const contents = await readFile(resolve(clientRoot, assetPath.slice(1)))
    return {
      path: assetPath,
      bytes: contents.byteLength,
      gzipBytes: gzipSync(contents).byteLength,
    }
  }

  const javascript = await Promise.all(
    referencedAssets(htmlText, '.js').map(measure),
  )
  const stylesheets = await Promise.all(
    referencedAssets(htmlText, '.css').map(measure),
  )
  const totals = {
    javascriptBytes: sum(javascript, 'bytes'),
    javascriptGzipBytes: sum(javascript, 'gzipBytes'),
    stylesheetBytes: sum(stylesheets, 'bytes'),
    stylesheetGzipBytes: sum(stylesheets, 'gzipBytes'),
    totalCodeGzipBytes:
      sum(javascript, 'gzipBytes') + sum(stylesheets, 'gzipBytes'),
  }
  const violations: string[] = []

  const checks: Array<[string, number, number]> = [
    ['document bytes', html.byteLength, budgets.documentBytes],
    ['initial JavaScript bytes', totals.javascriptBytes, budgets.javascriptBytes],
    [
      'initial JavaScript gzip bytes',
      totals.javascriptGzipBytes,
      budgets.javascriptGzipBytes,
    ],
    ['initial CSS bytes', totals.stylesheetBytes, budgets.stylesheetBytes],
    [
      'initial CSS gzip bytes',
      totals.stylesheetGzipBytes,
      budgets.stylesheetGzipBytes,
    ],
    [
      'initial JS + CSS gzip bytes',
      totals.totalCodeGzipBytes,
      budgets.totalCodeGzipBytes,
    ],
  ]

  for (const [label, actual, budget] of checks) {
    if (actual > budget) {
      violations.push(`${label}: ${actual} exceeds budget ${budget}`)
    }
  }

  for (const asset of javascript) {
    const source = await readFile(resolve(clientRoot, asset.path.slice(1)), 'utf8')
    for (const marker of FORBIDDEN_PUBLIC_MARKERS) {
      if (source.includes(marker)) {
        violations.push(`${asset.path} contains application-only marker ${marker}`)
      }
    }
  }

  return {
    document: {
      path: '/index.html',
      bytes: html.byteLength,
      gzipBytes: gzipSync(html).byteLength,
    },
    javascript,
    stylesheets,
    totals,
    violations,
  }
}

async function run(): Promise<void> {
  const measurement = await measurePublicBundle()
  console.log(JSON.stringify(measurement, null, 2))
  if (measurement.violations.length > 0) process.exitCode = 1
}

const invokedPath = process.argv[1]
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  await run()
}
