// Secret and synthetic-fixture scan (threat model T10/T18, LGPD §5).
//
// Scans application source, committed fixtures/snapshots, and (after a build)
// the public bundle for credential-shaped strings and real-looking personal
// data. Findings are heuristics: a match is a review prompt, not proof of a
// leak. Exits nonzero when a high-confidence finding appears outside an
// explicitly allowed path.
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(process.cwd())

const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.sql',
  '.css',
  '.html',
  '.md',
])

// Directories never scanned: vendored code, build output, generated files,
// design-handoff media, and throwaway local scratch.
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.output',
  '.tanStack'.toLowerCase(),
  'playwright-report',
  'test-results',
  'docs/design-handoff',
  'artifacts',
  'coverage',
])

type Finding = Readonly<{
  file: string
  line: number
  rule: string
  sample: string
}>

type ScanRule = Readonly<{
  id: string
  pattern: RegExp
  severity: 'error' | 'warning'
  /** Paths where this rule is tolerated (relative, forward slashes). */
  allowedIn?: readonly string[]
}>

type BundleScanResult = Readonly<{
  scanned: boolean
  findings: readonly Finding[]
}>

const RULES: readonly ScanRule[] = [
  {
    id: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    severity: 'error',
  },
  {
    id: 'assigned-secret-literal',
    // Assignments/env reads of high-credential names with a literal value.
    pattern:
      /(?:password|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    severity: 'error',
    // Test fixtures may embed obviously fake credentials; still reviewed.
    allowedIn: ['tests/', 'scripts/spikes/', 'spikes/'],
  },
  {
    id: 'database-url-with-credentials',
    // A literal connection URL carrying userinfo credentials.
    pattern:
      /['"`](?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)s?:\/\/[^\s/:@'"`]+:[^\s@/'"`]+@[^\s'"`]+['"`]/i,
    severity: 'error',
    allowedIn: ['tests/', 'scripts/', 'docs/', 'spikes/'],
  },
  {
    id: 'aws-access-key-id',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    severity: 'error',
  },
  {
    id: 'slack-token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    severity: 'error',
  },
  {
    id: 'github-pat',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    severity: 'error',
  },
  {
    id: 'google-api-key',
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/,
    severity: 'error',
  },
  {
    id: 'bearer-literal-in-source',
    pattern: /[Aa]uthorization['"]?\s*[:=]\s*['"`]Bearer\s+[A-Za-z0-9._-]{10,}/,
    severity: 'error',
    allowedIn: ['tests/', 'scripts/', 'spikes/'],
  },
  {
    id: 'real-cnpj-digits',
    // CNPJ with separators; synthetic fixtures use .invalid markers or masks.
    pattern: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
    severity: 'warning',
    allowedIn: ['tests/', 'docs/', 'scripts/', 'spikes/'],
  },
  {
    id: 'real-cpf-digits',
    pattern: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
    severity: 'warning',
    allowedIn: ['tests/', 'docs/', 'scripts/', 'spikes/'],
  },
  {
    id: 'brazilian-mobile-intl',
    // Full international mobile numbers suggest captured real contacts.
    pattern: /\+55\s?\(?\d{2}\)?\s?9\d{4}-?\d{4}\b/,
    severity: 'warning',
    allowedIn: ['tests/', 'docs/', 'src/features/landing/', 'scripts/', 'spikes/'],
  },
]

function isAllowed(relativePath: string, rule: ScanRule): boolean {
  return (rule.allowedIn ?? []).some((prefix) => relativePath.startsWith(prefix))
}

/**
 * Loopback URLs for explicitly test-scoped databases (e.g. the committed
 * Playwright webServer env) hold only disposable local credentials. They are
 * downgraded to warnings; anything routable or production-named stays an error.
 */
function isLocalTestDatabaseSample(sample: string): boolean {
  const match = /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)s?:\/\/[^/\s'"`]+@([^:/\s'"`]+)(?::\d+)?\/([^\s'"`]+)/i.exec(
    sample,
  )
  if (!match?.[1] || !match[2]) return false
  const [host, database] = [match[1], match[2]]
  const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(host)
  const testScoped = /(?:^|_)(?:test|ci)(?:$|_)/i.test(database)
  return loopback && testScoped
}

async function walk(directory: string, emit: (path: string) => void): Promise<void> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    const repoRelative = relative(REPO_ROOT, fullPath).replaceAll('\\', '/')
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      if (SKIP_DIRECTORIES.has(repoRelative)) continue
      await walk(fullPath, emit)
      continue
    }
    if (!SCAN_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
    emit(fullPath)
  }
}

export async function scanRepositoryForSecrets(
  root: string = REPO_ROOT,
): Promise<{ errors: Finding[]; warnings: Finding[] }> {
  const files: string[] = []
  await walk(root, (file) => files.push(file))

  const errors: Finding[] = []
  const warnings: Finding[] = []

  for (const file of files) {
    const relativePath = relative(root, file).replaceAll('\\', '/')
    let contents: string
    try {
      contents = await readFile(file, 'utf8')
    } catch {
      continue
    }
    for (const rule of RULES) {
      if (isAllowed(relativePath, rule)) continue
      const lines = contents.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        const line: string = lines[index] ?? ''
        rule.pattern.lastIndex = 0
        const match = rule.pattern.exec(line)
        if (!match) continue
        const finding: Finding = {
          file: relativePath,
          line: index + 1,
          rule: rule.id,
          sample: line.trim().slice(0, 120),
        }
        // Loopback test-database URLs are disposable local credentials.
        if (
          rule.id === 'database-url-with-credentials' &&
          isLocalTestDatabaseSample(finding.sample)
        ) {
          warnings.push(finding)
          continue
        }
        if (rule.severity === 'error') errors.push(finding)
        else warnings.push(finding)
      }
    }
  }
  return { errors, warnings }
}

export async function scanPublicBundleForSecrets(
  clientRoot: string = resolve(REPO_ROOT, 'dist/client'),
): Promise<BundleScanResult> {
  try {
    await stat(resolve(clientRoot, 'index.html'))
  } catch {
    return { scanned: false, findings: [] }
  }

  const findings: Finding[] = []
  const bundleRules: readonly ScanRule[] = [
    {
      id: 'bundle-private-key',
      pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      severity: 'error',
    },
    {
      id: 'bundle-jwt-literal',
      pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/,
      severity: 'error',
    },
    {
      id: 'bundle-db-url',
      pattern:
        /postgres(?:ql)?:\/\/[^\s/:@'"+]+:[^\s@/'"]+@/,
      severity: 'error',
    },
    {
      id: 'bundle-session-cookie-name-suspicious',
      pattern: /(?:sessionToken|refreshToken|__Secure-auth)/,
      severity: 'warning',
    },
  ]

  async function scanFile(pathname: string): Promise<void> {
    let contents: string
    try {
      contents = await readFile(pathname, 'utf8')
    } catch {
      return
    }
    for (const rule of bundleRules) {
      rule.pattern.lastIndex = 0
      if (rule.pattern.test(contents)) {
        findings.push({
          file: relative(clientRoot, pathname).replaceAll('\\', '/'),
          line: 0,
          rule: rule.id,
          sample: rule.id.replace('bundle-', ''),
        })
      }
    }
  }

  const queue = [clientRoot]
  while (queue.length > 0) {
    const current = queue.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) queue.push(fullPath)
      else await scanFile(fullPath)
    }
  }
  return { scanned: true, findings }
}

function printFindings(label: string, findings: readonly Finding[]): void {
  for (const finding of findings) {
    console.error(
      `${label}: ${finding.file}:${finding.line} [${finding.rule}] ${finding.sample}`,
    )
  }
}

async function run(): Promise<void> {
  const repository = await scanRepositoryForSecrets()
  const bundle = await scanPublicBundleForSecrets()

  printFindings('secret-error', repository.errors)
  printFindings('secret-warning', repository.warnings)
  printFindings('bundle-error', bundle.findings)

  const bundleSummary = bundle.scanned
    ? ` and dist/client (${bundle.findings.length} bundle findings)`
    : ' (no dist/client build present; bundle scan skipped)'

  console.log(
    `check:secrets scanned repository (${repository.errors.length} errors, ${repository.warnings.length} warnings)` +
      bundleSummary,
  )

  if (repository.errors.length > 0 || bundle.findings.length > 0) {
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1]
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  await run()
}
