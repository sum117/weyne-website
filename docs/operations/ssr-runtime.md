# Local SSR runtime and deployment operations

This runbook documents and rehearses the production shape without deploying
anything or requiring credentials. Every local example uses an intentionally
unusable, non-secret PostgreSQL URL. The health and current placeholder `/app`
paths do not connect to that database.

## What is static and what requires the server

`bun run build:app` produces both `dist/client` and `dist/server`:

- `/` is emitted as `dist/client/index.html`. The production runtime serves that
  physical prerendered document and React hydrates its interactive controls.
- `/app`, nested application routes, and `/_serverFn/*` requests are handled by
  the TanStack Start fetch handler in the live SSR process.
- `bun run serve:static` and a static file server can preview `/`, but they are
  not a production substitute: direct `/app` navigation and server functions
  will fail.

The supported production process is Node 24 running
`dist/server/runtime.js`. Bun 1.3.14 builds, tests, and packages the application;
`vite preview` is not the production server.

## Build and start the process locally

From the repository root in a POSIX-compatible shell (including Git Bash):

```sh
bun install --frozen-lockfile
DATABASE_URL='postgresql://local:local@database.invalid:5432/weyne' bun run build:app
DATABASE_URL='postgresql://local:local@database.invalid:5432/weyne' \
  HOST=127.0.0.1 PORT=3000 bun run start
```

In another shell:

```sh
curl --fail --show-error http://127.0.0.1:3000/healthz
curl --fail --show-error http://127.0.0.1:3000/
curl --fail --show-error http://127.0.0.1:3000/app
```

`/healthz` returns only `{"status":"ok"}` and does not query PostgreSQL. It
proves that configuration validation passed and the HTTP process is listening;
it does not prove database, storage, or other dependency readiness.

### Readiness versus liveness

Dependency readiness is a separate endpoint: `GET /readyz`. It probes every
required dependency — one `SELECT 1` against the pooled database, plus a
bounded HeadBucket against object storage when S3 credentials are configured —
and answers 200 with per-dependency status when all required checks pass, or
503 with the failing check named when they do not. Probe failures never echo
raw causes (driver errors can embed `DATABASE_URL`). `/readyz` never mutates
anything and is safe to poll at any interval.

| Endpoint | Answers | Fails when |
|---|---|---|
| `/healthz` | Is this process serving? | Process not listening or misconfigured. |
| `/readyz` | Can this process do its work? | Database or object storage unreachable. |

Every response carries an `x-request-id` correlation ID: an upstream value
(Caddy mints one via `{http.request.uuid}`) is validated and echoed; anything
absent or malformed is replaced with a fresh UUID. The same ID is attached to
every structured log line emitted while the request — including background
work it schedules — is in flight, so a single ID traces a request from edge
log through application and error logs.

### Staging-like full stack

`deploy/docker-compose.staging.yml` boots the complete production topology on
one host: PostgreSQL and MinIO (R2 stand-in) join app, Caddy, and cloudflared.
The backend network is `internal: true`, nothing publishes a host port, all
credentials arrive only through `.env.staging` (`deploy/.env.staging.example`
is the placeholder template), and the app healthcheck polls `/readyz`, so a
database or storage outage marks the container unhealthy without restarting
it. Dependency ordering in Compose is startup convenience only; `/readyz` is
the source of truth. Rehearse with fake values:

```sh
cd deploy && cp .env.staging.example .env.staging && $EDITOR .env.staging
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --wait
```

The `backend` and `edge` networks use fixed names (`weyne_staging_backend`,
`weyne_staging_edge`). Two Compose projects that both use this file therefore
share those networks, and service names such as `postgres` and `storage`
resolve to more than one container. Run only ONE staging project per host, and
tear the previous one down with `down -v` before starting another. A second
concurrent project produces confusing failures — backups reporting
`snapshot "..." does not exist`, or `storage-init` reporting a bucket it just
created as missing — because the client reached a different container than the
one it set up.

## Rehearse the container and Caddy topology locally

The local Compose file uses the same application image and Caddyfile as
production, supplies only non-secret placeholder configuration, and omits
cloudflared and migrations. Build output must exist before Docker builds the
image because TanStack Start prerendering is intentionally performed outside
Docker.

```sh
DATABASE_URL='postgresql://local:local@database.invalid:5432/weyne' bun run build:app
docker compose -f deploy/docker-compose.local.yml up -d --build --wait
docker compose -f deploy/docker-compose.local.yml ps
curl --fail --show-error http://127.0.0.1:8080/healthz
curl --fail --show-error http://127.0.0.1:8080/app
docker compose -f deploy/docker-compose.local.yml down --remove-orphans
```

Only Caddy is published, on `127.0.0.1:${WEYNE_HTTP_PORT:-8080}`. The Start
process listens on container port 3000 and is reachable only on the Compose
`edge` network. To avoid a local port collision, prefix Compose commands with,
for example, `WEYNE_HTTP_PORT=8180` and use port 8180 in the curl commands.

The complete automated rehearsal builds the app, starts an isolated Compose
project on `${WEYNE_SMOKE_PORT:-43178}`, waits for both containers to become
healthy, runs the Chromium production smoke suite, checks health again, and
removes the stack:

```sh
bunx playwright install chromium
bun run test:production-smoke
```

## Environment contract

### Start application and migration process

These values are server-only. Startup parses them before binding the HTTP port.

| Variable | Required | Validation and default |
|---|---:|---|
| `DATABASE_URL` | yes | Non-empty `postgres://` or `postgresql://` URL with a host and database path; no default. The migration process uses the same value. |
| `HOST` | no | Hostname, IPv4/IPv6 address, or `::`; defaults to `0.0.0.0`. |
| `PORT` | no | Decimal integer from 1 through 65535; defaults to `3000`. |
| `MIGRATION_CLEANUP_RELEASE` | no | Migration-only opt-in. Empty/absent for normal releases; for a contract migration it must exactly equal that migration ID. See [migrations and rollback](migrations-and-rollback.md). |
| `NODE_ENV` | no application parser | The image fixes it to `production`; it is process configuration, not a secret. |

### Database pool and resource bounds

The application process owns one bounded postgres.js pool. Defaults are
conservative for the dedicated VPS deployment (single app container,
PostgreSQL beside it with the default 100-slot `max_connections`). Every
value is environment-overridable without a rebuild; invalid values fail
startup with the same redacted configuration error as `DATABASE_URL`.

| Variable | Validation and default | Meaning |
|---|---|---|
| `WEYNE_DB_POOL_MAX` | Integer 1-100; defaults to `10`. | Maximum concurrent pool connections. Keep well below the server-side `max_connections` headroom. |
| `WEYNE_DB_IDLE_TIMEOUT_SECONDS` | Integer 1-3600; defaults to `30`. | Seconds an idle pooled connection is kept before closing. |
| `WEYNE_DB_CONNECT_TIMEOUT_SECONDS` | Integer 1-120; defaults to `10`. | Seconds to wait while establishing a connection. |
| `WEYNE_DB_STATEMENT_TIMEOUT_MS` | Integer 1-600000; defaults to `30000`. | Server-side `statement_timeout` per session: a runaway query is cancelled by PostgreSQL, not by client code. |
| `WEYNE_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | Integer 1-600000; defaults to `15000`. | Server-side `idle_in_transaction_session_timeout`: a forgotten open transaction releases its connection. |

Connections are also recycled after 30 minutes (`max_lifetime`) so long
processes pick up server-side changes and never accumulate ancient
sessions.

### Request body limit

| Variable | Validation and default | Meaning |
|---|---|---|
| `WEYNE_MAX_BODY_BYTES` | Integer 1024-1073741824; defaults to `50331648` (48 MiB). | Hard byte cap for any single request body, enforced before buffering: declared `content-length` above the cap is answered 413, and streamed bodies are destroyed once they exceed it. The largest legal payload today is a 25 MiB order attachment (~34.2 MB as base64). |

The server-only object-storage adapter additionally supports the following
variables when an application path instantiates S3 storage. They are not needed
by `/healthz`, `/`, or the current placeholder `/app` smoke path.

| Variable | Required by S3 adapter | Validation and default |
|---|---:|---|
| `S3_REGION` | yes | Non-empty string. |
| `S3_BUCKET` | yes | Non-empty string. |
| `S3_ACCESS_KEY_ID` | yes | Non-empty string. |
| `S3_SECRET_ACCESS_KEY` | yes | Non-empty string. |
| `S3_ENDPOINT` | no | Valid `http://` or `https://` URL; trailing slashes are removed. Omit for the provider's standard endpoint. |
| `S3_FORCE_PATH_STYLE` | no | Literal `true` or `false`; defaults to `false`. |
| `S3_SIGNED_URL_TTL_SECONDS` | no | Integer from 1 through 604800; defaults to 900. |

Do not put any of these values in `VITE_*`. Vite variables are compiled into
browser-visible output. The only supported `VITE_*` values are the public
`VITE_SITE_ORIGIN` and `VITE_WHATSAPP_NUMBER` overrides documented in the root
README.

### Compose and test orchestration

These values select infrastructure; they are not read by the Start config
parser:

| Variable | Scope | Behavior |
|---|---|---|
| `WEYNE_IMAGE` | production Compose | Required immutable GHCR tag or, preferably, digest. |
| `CLOUDFLARE_TUNNEL_TOKEN` | production cloudflared only | Required tunnel token; never passed to Caddy or the application. |
| `WEYNE_HTTP_PORT` | local Compose only | Host loopback port for Caddy; defaults to 8080. |
| `WEYNE_SMOKE_PORT` | automated smoke only | Host loopback port; defaults to 43178. |

`deploy/.env.weyne.example` is an inventory template, not usable production
configuration. Real values belong only in the ignored `.env.weyne` on the
target host or a secret manager. Local storage values and defaults are described
separately in [`docs/storage.md`](../storage.md).

## Production routing and cache assumptions

Production traffic follows this fixed path:

```text
Cloudflare edge (TLS) -> dedicated cloudflared tunnel
  -> http://web:80 (Caddy) -> http://app:3000 (TanStack Start)
```

Neither Caddy nor the application publishes a host port in
`deploy/docker-compose.weyne.yml`. The Cloudflare tunnel's origin must remain
`http://web:80`; routing it to `app:3000`, HTTPS, localhost, or a public host port
bypasses or breaks the documented boundary. Caddy provides compression,
security headers, and logs, while the application chooses response caching:

- HTML, including prerendered `/` and SSR `/app`: `Cache-Control: no-cache`;
- content-hashed `/assets/*-<hash>.*`: `public, max-age=31536000, immutable`;
- unhashed public files: `public, max-age=0, must-revalidate`;
- `/healthz`, server-function responses, and otherwise uncategorized non-HTML
  runtime responses: `no-store` unless the handler explicitly sets a policy.

Never assign immutable caching to HTML or unhashed files. A release may safely
retain old hashed assets, while HTML revalidation discovers new asset names.

## CI smoke coverage

`.github/workflows/ci.yml` runs `bun run check`, installs Chromium, and executes
`bun run test:production-smoke`. The browser/HTTP suite verifies `/healthz`, the
prerendered landing document, immutable hashed assets, SSR direct navigation to
`/app`, landing hydration, client navigation, and both container healthchecks
through Caddy.

`.github/workflows/publish.yml` repeats the full gate, rehearses migrations,
checks and builds the non-root Node image, then starts that image with a
non-secret placeholder database URL and polls `/healthz`. Pull requests do not
log into GHCR. Publishing on `main` records an immutable digest, but neither
workflow deploys to the VPS.

The commands in this runbook likewise perform no deployment and require no
Cloudflare, GHCR, database, or object-storage credentials.

## Troubleshooting

### The process exits before listening

Read the first stderr line. `DATABASE_URL is required`, invalid PostgreSQL URL,
invalid `HOST`, and out-of-range/non-integer `PORT` are startup validation
failures. Correct the named value; do not weaken validation or replace a secret
with a `VITE_*` variable. Confirm the built artifacts exist with
`dist/server/runtime.js`, `dist/server/server.js`, and `dist/client/index.html`.

### Compose reports an unhealthy container

```sh
docker compose -f deploy/docker-compose.local.yml ps -a
docker compose -f deploy/docker-compose.local.yml logs --no-color app web
docker inspect --format '{{json .State.Health}}' weyne-local-app-1
```

An unhealthy `app` points to startup validation, a missing/stale build, or a
port/listen failure. `web` waits for `app` health; if only Caddy is unhealthy,
validate `deploy/Caddyfile` and inspect its logs. In production, inspect the
one-shot `migrate` service first because `app` will not start after a failed
migration.

### `/` works but direct `/app` navigation or a server function fails

The request is reaching a static server or a stale pre-SSR Caddy topology.
Confirm the running image contains `dist/server/runtime.js`, Caddy uses
`reverse_proxy app:3000`, and Cloudflare targets `http://web:80`. Do not add an
SPA fallback to `index.html`; `/app` must execute the Start SSR handler.

### HTML or assets appear stale

Inspect the actual response path and policy:

```sh
curl --head http://127.0.0.1:8080/
curl --head http://127.0.0.1:8080/assets/<hashed-file>
```

HTML must say `no-cache`; a content-hashed asset must be immutable. If HTML is
immutable, remove the incorrect edge/proxy cache rule. If HTML is current but an
asset is not, verify that the HTML references the new hash and that the exact
file exists in the running image. Rebuild `dist` before `docker build`; Docker
packages existing output and does not run the Start build itself.