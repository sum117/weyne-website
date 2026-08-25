# TanStack Start SSR deployment spike

Status: **VALIDATED** on 2026-08-17 against the repository's pinned toolchain and the baseline in `docs/architecture-spike-baseline.md`.

## Question and verdict

**Given** TanStack Start 1.168.32, React 19.2.7, Bun 1.3.14, TypeScript 5.9.3, and the existing prerendered landing page, **when** the production build is run and its server bundle starts, **then** `/` must remain a physical prerendered document while `/app` executes through the Start server runtime.

**Verdict: VALIDATED.** The production build emitted both `dist/client` and `dist/server`, prerendered exactly `/`, and produced a Node-targeted runtime wrapper. Live requests proved that `/` was served from `dist/client/index.html`, while two `/app` requests returned different server timestamps from a TanStack server function.

## Reproducible commands

```sh
bun install --frozen-lockfile
bun run check
bun run build:app
DATABASE_URL=postgresql://weyne:weyne@localhost:5432/weyne \
  PORT=3101 bun run start
curl -i http://localhost:3101/healthz
curl -i http://localhost:3101/
curl -i http://localhost:3101/app
```

Container and proxy validation:

```sh
docker build -t weyne-ssr-spike:local .
docker run --name weyne-ssr-spike -d -p 127.0.0.1:3102:3000 weyne-ssr-spike:local
curl --fail http://localhost:3102/healthz
curl --fail http://localhost:3102/app
docker inspect --format '{{.State.Health.Status}}' weyne-ssr-spike
WEYNE_IMAGE=ghcr.io/sum117/weyne-web:spike \
  DATABASE_URL=postgresql://weyne:weyne@db:5432/weyne \
  CLOUDFLARE_TUNNEL_TOKEN=redacted \
  docker compose -f deploy/docker-compose.weyne.yml config --quiet
docker run --rm \
  -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

On Windows/Git Bash, use a native `C:/.../deploy/Caddyfile` path for the Docker bind mount.

## Observed compatibility evidence

- `bun run build:app` passed with Vite 7.3.6, Start 1.168.32, Router 1.170.18, React 19.2.7, and Bun 1.3.14.
- Client build: 4,930 modules transformed.
- SSR build: 98 modules transformed; `dist/server/server.js` was emitted.
- Prerender log: `Prerendered 1 pages: /`. `/app` was not prerendered.
- Runtime wrapper: `bun build ... --target=node --format=esm` emitted `dist/server/runtime.js`.
- `GET /healthz`: HTTP 200 with `{"status":"ok"}` and `Cache-Control: no-store`.
- `GET /`: HTTP 200, `Content-Type: text/html`, `Cache-Control: no-cache`, 77,038-byte full pt-BR landing document. It contained the existing landing markup and no `/app` SSR marker.
- First `GET /app`: HTTP 200 with `data-server-rendered-at="2026-08-17T14:10:45.144Z"`.
- Second `GET /app`: HTTP 200 with `data-server-rendered-at="2026-08-17T14:10:59.057Z"`. The changed value proves request-time server execution rather than prerender reuse.
- Docker image build passed. The running image returned both health and `/app`; Docker reported `healthy`.
- Compose interpolation/configuration and the Caddyfile both validated successfully.

## Retained minimal implementation

### Routes and runtime

- `src/routes/app.tsx` introduces only the `/app` shell needed for the spike. It is marked `noindex, nofollow` and does not pretend authentication exists yet.
- `src/features/app/runtime-status.ts` uses a TanStack `createServerFn` and returns a request-time timestamp.
- `vite.config.ts` disables automatic static path discovery and link crawling. With no explicit page list, Start's documented/default page remains `/`; this makes the static/dynamic boundary deliberate and prevents future `/app` links from silently turning authenticated pages into build-time output.
- `scripts/production-server.ts` is the thin production adapter. It serves physical `dist/client` files first (including `/`), exposes `/healthz`, and delegates every non-file request to the generated Start `fetch` handler.
- `package.json` retains `build:runtime` and `start`: the Start output is followed by a small Node-targeted ESM runtime build, then started with `node dist/server/runtime.js`.

No new package was required specifically for this SSR path. The existing exact Start/Router pins and locked React/TypeScript versions were retained. Other dependency additions visible in the shared architecture branch belong to their own compatibility spikes and are not evidence required by this result.

### Static assets and cache policy

The runtime, not Caddy, owns static-file selection so one immutable server image contains both output halves:

- prerendered and SSR HTML: `no-cache`;
- content-hashed files under `/assets/`: `public, max-age=31536000, immutable`;
- unhashed public files: `public, max-age=0, must-revalidate`;
- Start responses without an explicit non-HTML policy: `no-store`.

Caddy keeps compression, security headers, and access logging, but preserves upstream cache headers. This avoids two competing static roots and ensures `/app` and future server-function requests reach Start.

## Production topology

```text
Cloudflare edge (TLS)
  -> dedicated cloudflared tunnel
  -> web:80 (Caddy sidecar, no host port)
  -> app:3000 (immutable GHCR Start server image, no host port)
```

Required deployment changes are represented in the retained files:

- `Dockerfile` now packages `dist/client`, `dist/server`, production dependencies, and the Node runtime. Bun 1.3.14 performs the frozen production install in a build stage; Node 24 runs the Node-targeted server as the unprivileged `node` user.
- `deploy/docker-compose.weyne.yml` splits the previous all-in-one `web` image into `app` and `web` services. The tunnel destination remains `web:80`, so Cloudflare Tunnel configuration does not change.
- `deploy/Caddyfile` changes from `file_server` to `reverse_proxy app:3000`; compression, headers, and logging remain at the ingress boundary.
- `.github/workflows/publish.yml` still builds before `docker build`, but now packages both Start output halves.
- `.dockerignore` no longer excludes `dist/server`.

The app and proxy both have health checks. Caddy waits for the app to become healthy; cloudflared continues to depend on Caddy.

## Environment and secrets boundary

Public build-time values remain limited to the existing `VITE_SITE_ORIGIN` and `VITE_WHATSAPP_NUMBER`. Every `VITE_*` value is embedded in browser output and must be treated as public.

Server credentials introduced by architecture work—database URLs, auth secrets, S3 credentials, private bucket names, signing keys, and similar values—must be read from `process.env` only in `.server.ts` modules, server functions, or server-route handlers. They must be injected into the `app` service at runtime from the uncommitted VPS `.env.weyne` (or a future secret manager), never through `VITE_*`, build arguments, image layers, client loaders, or serialized route data. The retained runtime validates `DATABASE_URL` at startup and Compose injects it only into `app`.

The existing `CLOUDFLARE_TUNNEL_TOKEN` remains exclusive to the `cloudflared` service. Caddy and the app do not receive it. `WEYNE_IMAGE`, `HOST`, `PORT`, and `NODE_ENV` are configuration, not secrets.

## Migration and rollback

1. Build, test, and publish the new server image under the immutable `sha-<full SHA>` tag.
2. Preserve the currently deployed static image SHA and the matching old `Dockerfile`, compose file, and Caddyfile as the rollback set.
3. On the VPS, update the versioned `deploy/Caddyfile` and `deploy/docker-compose.weyne.yml`, set `WEYNE_IMAGE` to the new digest, then run `docker compose --env-file .env.weyne pull` and `docker compose --env-file .env.weyne up -d`.
4. Require `app` and `web` health, then verify public `/`, `/app`, one hashed asset, and the WhatsApp landing interaction through Cloudflare before declaring success.
5. Roll back by restoring the previous static compose/Caddy configuration and previous static image SHA together, then running `pull`/`up -d` again. The image contract changed from Caddy on port 80 to Start on port 3000, so reverting only `WEYNE_IMAGE` while retaining the new compose topology is invalid.

No database migration is part of this runtime spike. When persistence arrives, schema rollback policy must be handled separately and must not assume that reverting the web image reverses data changes.

## Rejected alternatives

- **Keep the single static Caddy image:** rejected because `/app`, server functions, sessions, and future authenticated data require a live Start handler.
- **Send Cloudflare directly to the Start container:** workable, but rejected for this migration because it discards the established Caddy security-header, compression, logging, and stable `web:80` tunnel boundary.
- **Run `vite preview` in production:** rejected; it is a preview tool, not the supported production server contract, and does not encode the explicit static-first cache/health behavior.
- **Prerender `/app`:** rejected because authenticated application state and per-request server data must never be frozen into public build artifacts.
- **Build Start inside `docker build`:** rejected based on the recorded repository constraint: prerender spawns a Node server and has been unreliable inside Docker builds. CI builds first and the image only packages immutable output.
- **Use Bun as the final HTTP runtime without a separate compatibility contract:** not needed for this path. Bun remains the pinned package manager, test runner, and runtime-bundle builder; the generated wrapper targets Node and is run on Node 24, matching the Start prerender/runtime behavior actually exercised here.
