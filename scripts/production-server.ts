import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseServerConfig } from '../src/lib/server/config.server'
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

function toWebRequest(req: IncomingMessage): Request {
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
    init.body = req as unknown as BodyInit
    init.duplex = 'half'
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
    void (async () => {
      const pathname = new URL(req.url ?? '/', requestOrigin(req)).pathname
      if (pathname === '/healthz') {
        res.statusCode = 200
        res.setHeader('cache-control', 'no-store')
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }
      if (await serveStaticFile(req, res, pathname)) return

      const start = await loadStartServer()
      await sendWebResponse(await start.fetch(toWebRequest(req)), res, pathname)
    })().catch((error: unknown) => {
      console.error('Production request failed', error)
      if (!res.headersSent) res.statusCode = 500
      res.end('Internal Server Error')
    })
  })

  return server.listen(config.port, config.host, () => {
    console.log(
      `TanStack Start listening on http://${config.host}:${config.port}`,
    )
  })
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  pathToFileURL(resolve(invokedPath)).href === import.meta.url
) {
  startProductionServer()
}