// @ts-expect-error The declaration-less module is emitted by `vite build`.
import server from '../dist/server/server.js'

const port = Number(process.env.PORT ?? 3011)
Bun.serve({
  fetch: (request: Request) => server.fetch(request),
  port,
})
console.log(`backend spike server listening on http://127.0.0.1:${port}`)
