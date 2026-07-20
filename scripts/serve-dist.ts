/**
 * Minimal static server for the prerendered client build (dist/client).
 *
 * Used as the Playwright webServer so e2e runs against the exact prerendered
 * HTML + hydrating client bundle a static host would serve. Zero extra deps.
 *
 *   bun scripts/serve-dist.ts [port]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(process.cwd(), 'dist/client')
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 3100)

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

async function resolveFile(urlPath: string): Promise<string | null> {
  const clean = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  let target = join(ROOT, normalize(clean).replace(/^(\.\.[/\\])+/, ''))
  try {
    const info = await stat(target)
    if (info.isDirectory()) target = join(target, 'index.html')
  } catch {
    // Root-level pretty path (e.g. "/") → prerendered index.html.
    if (clean === '/' || clean === '') target = join(ROOT, 'index.html')
    else return null
  }
  try {
    await stat(target)
    return target
  } catch {
    return null
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const file = await resolveFile(req.url ?? '/')
    if (!file) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    const body = await readFile(file)
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
    res.end(body)
  })().catch(() => {
    res.statusCode = 500
    res.end('Server error')
  })
})

server.listen(PORT, () => {
  console.log(`serving dist/client on http://localhost:${PORT}`)
})
