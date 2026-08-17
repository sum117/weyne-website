import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PUBLIC_BUNDLE_BUDGETS,
  measurePublicBundle,
  type PublicBundleBudgets,
} from '../../scripts/check-public-bundle'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })))
})

async function fixture(options: { javascript?: string; css?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'weyne-public-bundle-'))
  roots.push(root)
  await mkdir(join(root, 'assets'))
  await writeFile(
    join(root, 'index.html'),
    '<link rel="stylesheet" href="/assets/app.css"><script type="module" src="/assets/app.js"></script>',
  )
  await writeFile(join(root, 'assets/app.js'), options.javascript ?? 'export{}')
  await writeFile(join(root, 'assets/app.css'), options.css ?? 'body{}')
  return root
}

describe('public bundle budget', () => {
  it('deduplicates directly loaded assets and reports their gzip totals', async () => {
    const root = await fixture()
    await writeFile(
      join(root, 'index.html'),
      '<link rel="modulepreload" href="/assets/app.js"><script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">',
    )

    const result = await measurePublicBundle(root)

    expect(result.javascript).toHaveLength(1)
    expect(result.stylesheets).toHaveLength(1)
    expect(result.totals.totalCodeGzipBytes).toBeGreaterThan(0)
    expect(result.violations).toEqual([])
  })

  it('fails when an initial asset exceeds its configured budget', async () => {
    const root = await fixture({ javascript: 'const payload = "large"' })
    const budgets: PublicBundleBudgets = {
      ...PUBLIC_BUNDLE_BUDGETS,
      javascriptBytes: 1,
    }

    const result = await measurePublicBundle(root, budgets)

    expect(result.violations).toContainEqual(
      expect.stringContaining('initial JavaScript bytes'),
    )
  })

  it('rejects authenticated application modules in the public graph', async () => {
    const marker = 'A estrutura está pronta para receber os módulos autenticados'
    const root = await fixture({ javascript: `const heading = "${marker}"` })

    const result = await measurePublicBundle(root)

    expect(result.violations).toContainEqual(
      expect.stringContaining(`application-only marker ${marker}`),
    )
  })
})
