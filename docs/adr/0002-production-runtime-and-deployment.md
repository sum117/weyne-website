# ADR 0002: Production runtime and deployment

- Status: Accepted
- Date: 2026-08-17
- Owners: Weyne application and operations maintainers

## Context

The former production image was Caddy serving only `dist/client`. Authenticated SSR routes, server functions, sessions, database access, and exports require a live Start handler. The existing Cloudflare Tunnel and Caddy ingress boundary are operationally useful and must remain stable.

## Decision

Use one immutable application image containing `dist/client`, `dist/server`, the Node-targeted runtime adapter, migration runner, and production dependencies. Node 24 runs `node dist/server/runtime.js`; Bun `1.3.14` remains the build/package/test tool.

Production topology is:

```text
Cloudflare edge (TLS)
  -> dedicated cloudflared tunnel
  -> web:80 (Caddy sidecar; no host port)
  -> app:3000 (Start server image; no host port)
```

The application runtime serves physical static files first, including prerendered `/`, exposes `/healthz`, and delegates non-file requests to Start's generated fetch handler. It owns cache selection: HTML is `no-cache`, hashed assets are immutable for one year, unhashed public files revalidate, and uncategorized Start responses default to `no-store`. Caddy remains responsible for compression, security headers, access logs, and the stable `web:80` tunnel origin.

CI runs `bun install --frozen-lockfile`, `bun run check`, migration rehearsal, image build, and image smoke testing. Publishing rebuilds the application and pushes GHCR tags `sha-<full SHA>` and `latest`, recording the immutable digest. Deployments must pin `WEYNE_IMAGE` to an immutable tag or digest, never rely on `latest` as a rollback coordinate.

## Runtime and deployment commands

- Build application output: `bun run build:app`.
- Build the image after output exists: `docker build -t weyne-web:local .`.
- Start built output locally: set required server environment and run `bun run start`.
- Validate health: `curl --fail http://localhost:<port>/healthz`.
- Validate Compose: `docker compose --env-file .env.weyne -f deploy/docker-compose.weyne.yml config --quiet`.
- Deploy on the VPS: `docker compose --env-file .env.weyne pull` then `docker compose --env-file .env.weyne up -d --wait` from the versioned deploy directory.

The Start build occurs in CI before `docker build`; do not move prerender into Docker because the spawned server has been unreliable there.

## Migration from the static Caddy image

1. Keep the previous static image digest and its matching Compose/Caddy files as one rollback set.
2. Publish and pin the new immutable server-image digest.
3. Add runtime secrets to the uncommitted VPS environment and deploy the versioned Compose/Caddy files together with the new image.
4. The one-shot `migrate` service must complete successfully before `app` starts; `web` waits for application health.
5. Verify `/healthz`, public `/`, authenticated `/app`, a hashed asset, security/cache headers, and the WhatsApp landing interaction through Cloudflare.

Database migrations are forward-only and follow expand/contract discipline. For an application rollback after an expand migration, retain the newer database schema, restore the previous compatible image digest, and replace only the application with `--no-deps`; do not run an older migration plan against the newer ledger. Follow [`docs/operations/migrations-and-rollback.md`](../operations/migrations-and-rollback.md). A contract cleanup may run only after its compatibility window and explicit `MIGRATION_CLEANUP_RELEASE` gate.

The first rollback to the pre-SSR static deployment is a special case: restore the previous static image, previous Caddy `file_server` configuration, and previous Compose topology together. Changing only the image is invalid because the old image listens through Caddy on port 80 while the new app listens on port 3000 behind Caddy.

## Secrets and ownership

- GitHub Actions owns the short-lived `GITHUB_TOKEN` used to publish GHCR and provenance. It is not a runtime secret.
- The VPS uncommitted `.env.weyne` (or a future secret manager) owns application runtime secrets. Secrets are injected at runtime, never via build args, image layers, repository files, or `VITE_*` variables.
- `CLOUDFLARE_TUNNEL_TOKEN` is injected only into `cloudflared`; neither Caddy nor the app receives it.
- Database/auth/storage secrets are injected only into services that require them. Caddy receives none.
- `WEYNE_IMAGE`, `HOST`, `PORT`, `NODE_ENV`, and cleanup-release identifiers are configuration rather than credentials.

## Consequences

- The public page remains a physical prerendered document while the same image supports SSR.
- Caddy and cloudflared remain separate services and preserve the existing no-host-port exposure boundary.
- Deployments include a migration gate and coordinated health dependencies; a failed migration prevents the application from starting.
- Rollback coordinates include the image digest and, for the initial topology migration, matching Compose/Caddy configuration.
- The Node runtime is an intentional compatibility choice even though Bun builds the wrapper.

## Rejected alternatives

- Keep a static-only Caddy image: cannot support authenticated SSR or server functions.
- Send Cloudflare directly to Start: discards the established Caddy policy and stable tunnel target.
- Run `vite preview` in production: not a production server contract.
- Run the emitted `dist/server/server.js` directly: this Start version emits a fetch handler, not a listening server.
- Use an unvalidated Bun-only final runtime: the demonstrated production contract is a Node 24 target.
- Build Start inside Docker: conflicts with the observed prerender reliability constraint.
- Roll back database files or rewrite applied migrations: violates the immutable migration ledger and risks data loss.

## Validation evidence

[`docs/architecture-spike-ssr-runtime.md`](../architecture-spike-ssr-runtime.md) records successful client/SSR/runtime builds, exact `/` prerendering, live dynamic `/app` responses, healthy Docker execution, valid Compose/Caddy configuration, environment boundaries, and the static-to-SSR rollback requirement (`t_42cf7754`). The clean baseline deployment is recorded in [`docs/architecture-spike-baseline.md`](../architecture-spike-baseline.md) (`t_5c3ed803`).
