import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'

const HOST = '127.0.0.1'
const PORT = 43_177
const ORIGIN = `http://${HOST}:${PORT}`
const RUNTIME = 'dist/server/runtime.js'
const DATABASE_URL = 'postgresql://header-check:header-check@127.0.0.1:1/header_check'

const expectedHeaders = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const

const requiredCspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  'upgrade-insecure-requests',
] as const

async function waitForRuntime(): Promise<void> {
  const deadline = Date.now() + 15_000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ORIGIN}/healthz`)
      if (response.ok) return
      lastError = new Error(`health check returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`production runtime did not become ready: ${String(lastError)}`)
}

function assertSecurityHeaders(pathname: string, response: Response): void {
  for (const [name, expected] of Object.entries(expectedHeaders)) {
    const actual = response.headers.get(name)
    if (actual !== expected) {
      throw new Error(`${pathname}: ${name} was ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`)
    }
  }

  const csp = response.headers.get('content-security-policy')
  if (!csp) throw new Error(`${pathname}: content-security-policy is missing`)
  for (const directive of requiredCspDirectives) {
    if (!csp.includes(directive)) {
      throw new Error(`${pathname}: CSP is missing ${JSON.stringify(directive)}`)
    }
  }
  if (csp.includes("'unsafe-eval'")) {
    throw new Error(`${pathname}: CSP must not allow unsafe-eval`)
  }
}

async function main(): Promise<void> {
  await access(RUNTIME)

  const runtime = spawn('node', [RUNTIME], {
    env: {
      ...process.env,
      DATABASE_URL,
      HOST,
      NODE_ENV: 'production',
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  runtime.stdout.on('data', (chunk) => {
    diagnostics += String(chunk)
  })
  runtime.stderr.on('data', (chunk) => {
    diagnostics += String(chunk)
  })

  try {
    await waitForRuntime()

    const home = await fetch(`${ORIGIN}/`)
    if (home.status !== 200) throw new Error(`/ returned ${home.status}`)
    assertSecurityHeaders('/', home)
    const html = await home.text()
    const asset = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1]
    if (!asset) throw new Error('/ did not reference a built asset')

    const assetResponse = await fetch(`${ORIGIN}${asset}`)
    if (assetResponse.status !== 200) {
      throw new Error(`${asset} returned ${assetResponse.status}`)
    }
    assertSecurityHeaders(asset, assetResponse)

    const health = await fetch(`${ORIGIN}/healthz`)
    if (health.status !== 200) throw new Error(`/healthz returned ${health.status}`)
    assertSecurityHeaders('/healthz', health)

    console.log(`Verified production security headers on /, /healthz, and ${asset}`)
  } catch (error) {
    if (diagnostics.trim()) console.error(diagnostics.trim())
    throw error
  } finally {
    runtime.kill()
    await Promise.race([
      new Promise<void>((resolve) => runtime.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ])
  }
}

await main()
