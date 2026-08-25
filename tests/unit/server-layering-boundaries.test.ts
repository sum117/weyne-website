import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Executable guard for the layering contract documented in
 * `docs/domain/server-function-domain-service-conventions.md`.
 *
 * The conventions card (t_88281189) requires that modules obey
 * routes -> features -> domain/data. Prose and review cannot enforce that
 * across the downstream cards built on this pattern, so the rules are asserted
 * here against the real source tree.
 */

const SOURCE_ROOT = resolve(process.cwd(), 'src')

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g

type SourceFile = Readonly<{
  path: string
  relativePath: string
  source: string
  imports: readonly string[]
}>

async function collectSourceFiles(directory: string): Promise<SourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: SourceFile[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)))
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (entry.name === 'routeTree.gen.ts') continue

    const source = await readFile(entryPath, 'utf8')
    const imports = [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1]!)
    files.push({
      path: entryPath,
      relativePath: relative(SOURCE_ROOT, entryPath).replaceAll('\\', '/'),
      source,
      imports,
    })
  }

  return files
}

const sourceFiles = await collectSourceFiles(SOURCE_ROOT)

function filesUnder(prefix: string): SourceFile[] {
  return sourceFiles.filter((file) => file.relativePath.startsWith(prefix))
}

function violations(
  files: readonly SourceFile[],
  isViolation: (specifier: string, file: SourceFile) => boolean,
): string[] {
  return files.flatMap((file) =>
    file.imports
      .filter((specifier) => isViolation(specifier, file))
      .map((specifier) => `${file.relativePath} -> ${specifier}`),
  )
}

const PERSISTENCE_SPECIFIER =
  /^(?:drizzle-orm|postgres$|@\/lib\/db(?:\/|$))|\.repository\.server$|\/repository\.server$/

describe('server-function and domain-service layering', () => {
  it('finds the source tree it is supposed to guard', () => {
    expect(sourceFiles.length).toBeGreaterThan(50)
    expect(filesUnder('routes/').length).toBeGreaterThan(0)
    expect(filesUnder('features/').length).toBeGreaterThan(0)
  })

  it('keeps routes free of Drizzle, the database handle, and repositories', () => {
    expect(
      violations(filesUnder('routes/'), (specifier) =>
        PERSISTENCE_SPECIFIER.test(specifier),
      ),
    ).toEqual([])
  })

  it('keeps persistence out of every .tsx component module', () => {
    const componentFiles = sourceFiles.filter(
      (file) => file.relativePath.endsWith('.tsx') && !file.relativePath.includes('.server.'),
    )
    expect(
      violations(componentFiles, (specifier) => PERSISTENCE_SPECIFIER.test(specifier)),
    ).toEqual([])
  })

  it('never lets shared infrastructure import upward into features or routes', () => {
    const infrastructure = [...filesUnder('lib/'), ...filesUnder('domain/')]
    expect(
      violations(infrastructure, (specifier) =>
        specifier.startsWith('@/features') || specifier.startsWith('@/routes'),
      ),
    ).toEqual([])
  })

  it('routes every LIKE filter through the shared escaping helper', () => {
    const offenders = sourceFiles.filter((file) =>
      /i?like\(\s*[^,)]+,\s*`%\$\{/.test(file.source),
    )
    expect(offenders.map((file) => file.relativePath)).toEqual([])
  })

  it('does not add a second API framework alongside TanStack Start', () => {
    const forbidden = /^(?:hono|express|@hono\/|fastify|koa|graphql|@apollo\/)/
    expect(violations(sourceFiles, (specifier) => forbidden.test(specifier))).toEqual([])
  })

  it('keeps the reference implementation on the shared server primitives', () => {
    const referenceFiles = filesUnder('features/reference-record/')
    expect(referenceFiles.length).toBeGreaterThanOrEqual(5)

    const specifiers = new Set(referenceFiles.flatMap((file) => file.imports))
    for (const required of [
      '@/lib/domain/result',
      '@/lib/server/public-error',
      '@/lib/server/request.schema',
      '@/lib/server/cursor.server',
      '@/lib/server/serialization',
    ]) {
      expect(specifiers).toContain(required)
    }
  })
})
