import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseServerConfig } from '../src/lib/server/config.server'
import {
  logStructuredEvent,
  logUnexpectedError,
  redactSensitiveText,
} from '../src/lib/server/log-redaction'
import { runWithLogContext } from '../src/lib/server/log-context.server'
import type { IncomingMessage, ServerResponse } from 'node:http'

const CLIENT_ROOT = fileURLToPath(new URL('../client/', import.meta.url))

// TanStack Start currently emits inline hydration/state scripts, the landing
// page has an inline reveal bootstrap, and React renders component style
// attributes. Keep those two narrowly documented exceptions while denying
// foreign code, framing, plugins, and unexpected network destinations.
export const productionSecurityHeaders = {
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    'upgrade-insecure-requests',
  ].join('; '),
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': [
    'camera=()',
    'geolocation=()',
    'microphone=()',
    'payment=()',
    'usb=()',
  ].join(', '),
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
} as const

const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
}

type StartServerEntry = {
  fetch: (request: Request) => Promise<Response>
}

let startServerEntry: Promise<StartServerEntry> | undefined

function applyProductionSecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(productionSecurityHeaders)) {
    res.setHeader(name, value)
  }
}

export function isImmutableAssetPath(pathname: string): boolean {
  return /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(pathname)
}

export function cacheControlForPath(
  pathname: string,
  contentType: string,
): string {
  if (contentType.startsWith('text/html')) return 'no-cache'
  if (isImmutableAssetPath(pathname)) {
    return 'public, max-age=31536000, immutable'
  }
  return 'public, max-age=0, must-revalidate'
}

async function loadStartServer(): Promise<StartServerEntry> {
  startServerEntry ??= import(new URL('./server.js', import.meta.url).href).then(
    (module: { default?: StartServerEntry }) => {
      if (!module.default || typeof module.default.fetch !== 'function') {
        throw new Error('The TanStack Start server bundle has no fetch handler')
      }
      return module.default
    },
  )
  return startServerEntry
}

function requestOrigin(req: IncomingMessage): string {
  const forwardedProto = req.headers['x-forwarded-proto']
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto?.split(',')[0]?.trim()
  return `${protocol || 'http'}://${req.headers.host || 'localhost'}`
}

/**
 * Hard byte cap for any single request body. The largest legal payload today
 * is the order-attachment upload (25 MiB of bytes, ~34.2 MB as base64), so
 * the default leaves comfortable slack while refusing unbounded bodies
 * before they are buffered anywhere. Configurable via `WEYNE_MAX_BODY_BYTES`.
 */
export const DEFAULT_MAX_BODY_BYTES = 48 * 1024 * 1024

export function requestBodyExceedsLimit(
  req: IncomingMessage,
  maxBytes: number,
): boolean {
  const declared = req.headers['content-length']
  if (Array.isArray(declared)) return true
  if (declared === undefined) return false
  const length = Number(declared)
  return Number.isFinite(length) && length > maxBytes
}

/**
 * Wraps the raw request stream so bodies that lie about (or omit)
 * `content-length` cannot exceed the cap. Reading here also keeps the
 * stream out of flowing mode before the Start server consumes it.
 */
function readBoundedBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    req.on('data', (chunk: Buffer) => {
      received += chunk.byteLength
      if (received > maxBytes) {
        req.destroy()
        reject(new Error(`request body exceeds ${maxBytes} bytes`))
        return
      }
      chunks.push(chunk)
    })
    req.once('end', () => resolve(Buffer.concat(chunks)))
    req.once('error', reject)
  })
}

function toWebRequest(req: IncomingMessage, body?: Buffer): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else if (value !== undefined) {
      headers.set(name, value)
    }
  }

  const method = req.method ?? 'GET'
  const init: RequestInit & { duplex?: 'half' } = { headers, method }
  if (method !== 'GET' && method !== 'HEAD') {
    // The bounded read has already consumed the raw stream; hand the Start
    // server a complete body instead of the live socket.
    init.body = body ? new Uint8Array(body) : new Uint8Array(0)
    if (body === undefined) headers.set('content-length', '0')
  }

  return new Request(new URL(req.url ?? '/', requestOrigin(req)), init)
}

async function sendWebResponse(
  response: Response,
  res: ServerResponse,
  pathname: string,
): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value)
  })

  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => Array<string> }
  ).getSetCookie
  const cookies = getSetCookie?.call(response.headers) ?? []
  if (cookies.length > 0) res.setHeader('set-cookie', cookies)

  if (!response.headers.has('cache-control')) {
    const contentType = response.headers.get('content-type') ?? ''
    res.setHeader(
      'cache-control',
      contentType.startsWith('text/html')
        ? cacheControlForPath(pathname, contentType)
        : 'no-store',
    )
  }

  if (response.body === null) {
    res.end()
    return
  }
  res.end(Buffer.from(await response.arrayBuffer()))
}

async function staticFileForPath(pathname: string): Promise<string | null> {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1)
  const candidate = resolve(join(CLIENT_ROOT, relativePath))
  const fromRoot = relative(CLIENT_ROOT, candidate)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null

  try {
    return (await stat(candidate)).isFile() ? candidate : null
  } catch {
    return null
  }
}

async function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const file = await staticFileForPath(pathname)
  if (!file) return false

  const contentType = CONTENT_TYPES[extname(file).toLowerCase()]
  if (contentType) res.setHeader('content-type', contentType)
  res.setHeader(
    'cache-control',
    cacheControlForPath(pathname, contentType ?? 'application/octet-stream'),
  )
  if (req.method === 'HEAD') {
    res.end()
  } else {
    res.end(await readFile(file))
  }
  return true
}

export function startProductionServer(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const config = parseServerConfig(environment)

  const server = createServer((req, res) => {
    applyProductionSecurityHeaders(res)
    let pathname = '/'
    const startedAt = Date.now()
    // Correlation ID: honor an upstream-provided one (Caddy/edge), mint a
    // fresh UUID otherwise. Echoed on every response and attached to all
    // structured log lines emitted while this request (or background work
    // it schedules) is in flight.
    const upstreamRequestId = req.headers['x-request-id']
    const requestId = Array.isArray(upstreamRequestId)
      ? (upstreamRequestId[0] ?? '')
      : (upstreamRequestId ?? '')
    const correlationId =
      /^[\w.-]{8,128}$/.test(requestId) ? requestId : randomUUID()

    void runWithLogContext({ requestId: correlationId }, () =>
      (async () => {
        res.setHeader('x-request-id', correlationId)
        pathname = new URL(req.url ?? '/', requestOrigin(req)).pathname

        if (pathname === '/readyz') {
          const { readDependencies } = await import(
            '../src/lib/server/readiness.server'
          )
          const report = await readDependencies()
          res.statusCode = report.ready ? 200 : 503
          res.setHeader('cache-control', 'no-store')
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(report))
          return
        }
        if (pathname === '/healthz') {
          res.statusCode = 200
          res.setHeader('cache-control', 'no-store')
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ status: 'ok' }))
          return
        }
        if (requestBodyExceedsLimit(req, config.maxBodyBytes)) {
          res.statusCode = 413
          res.setHeader('cache-control', 'no-store')
          res.end('Payload Too Large')
          return
        }
        const body =
          req.method !== 'GET' && req.method !== 'HEAD'
            ? await readBoundedBody(req, config.maxBodyBytes)
            : undefined
        if (await serveStaticFile(req, res, pathname)) return

        const start = await loadStartServer()
        await sendWebResponse(await start.fetch(toWebRequest(req, body)), res, pathname)
      })().catch((error: unknown) => {
        // Redacted single-line JSON; raw errors can carry credentials or PII.
        logUnexpectedError('production.request', error, { pathname })
        if (!res.headersSent) res.statusCode = 500
        res.end('Internal Server Error')
      }).finally(() => {
        // Access log after completion, still inside the log context so the
        // line carries the request's correlation ID. Method/path/status
        // only — never headers, query strings, or payloads.
        const durationMs = Date.now() - startedAt
        logStructuredEvent({
          kind: 'request',
          method: req.method,
          path: redactSensitiveText(pathname, 256),
          status: res.statusCode,
          durationMs,
        })
      }),
    )
  })

  return server.listen(config.port, config.host, () => {
    logStructuredEvent({
      kind: 'startup',
      host: config.host,
      port: config.port,
    })
  })
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  pathToFileURL(resolve(invokedPath)).href === import.meta.url
) {
  startProductionServer()
}