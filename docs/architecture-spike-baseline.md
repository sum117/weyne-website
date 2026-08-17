# Architecture spike baseline

Recorded on 2026-08-17 before architecture spike changes. This note describes the repository as found; it does not add or revise product architecture decisions.

## Baseline verification

`bun run check` passed on the clean `main` branch at `8c7f20a` before this note was created.

- Content check: passed in preview mode with the existing warnings for omitted Instagram and LinkedIn URLs.
- TypeScript: passed (`tsc --noEmit`).
- ESLint: passed (`eslint .`).
- Unit tests: 3 files passed, 26 tests passed.
- Production build: passed with Vite 7.3.6; TanStack Start prerendered exactly one page, `/`.
- Generated output: `dist/client` for static hosting and `dist/server` for the build-time/server bundle. The current production image packages only `dist/client`.

A post-build request to the repository's static server returned `200 OK`, `Content-Type: text/html; charset=utf-8`, and a 76,950-byte prerendered `/` document containing the pt-BR document shell, landing-page markup, reveal boot script, styles, and hydrating client assets.

## Current package and toolchain baseline

Source: `package.json`, `bun.lock`, `.github/workflows/ci.yml`, and the installed dependency tree.

| Tool/package | Manifest declaration | Locked/validated version |
| --- | --- | --- |
| Bun | CI pin | `1.3.14` |
| `@tanstack/react-start` | `1.168.32` | `1.168.32` |
| `@tanstack/react-router` | `1.170.18` | `1.170.18` |
| React | `^19.2.0` | `19.2.7` |
| React DOM | `^19.2.0` | `19.2.7` |
| TypeScript | `^5.9.3` | `5.9.3` |
| Vite | `7.3.6` | `7.3.6` |

TanStack Start and Router are exact manifest pins. React and TypeScript use compatible-range declarations, so spike workers must preserve `bun.lock` and use `bun install --frozen-lockfile` when reproducing this baseline. TypeScript is strict, uses bundler module resolution and `noEmit`, and targets ES2022; see `tsconfig.json`.

## Commands later spike workers must use

- Install reproducibly: `bun install --frozen-lockfile`
- Start development server on port 3000: `bun run dev`
- Required full gate before and after a spike: `bun run check`
- Individual gates: `bun run check:content`, `bun run typecheck`, `bun run lint`, `bun run test`
- Production build with the content gate: `bun run build`
- CI/publish build without a duplicate content check: `bun run build:app`
- Serve the exact prerendered client locally: `bun run serve:static`
- E2E against `dist/client`: run `bun run build`, then `bun run test:e2e`
- Local current-image build: run `bun run build`, then `docker build .`

`bun run check` is the repository and CI quality gate: content check, typecheck, lint, unit tests, then the prerender build. The TanStack prerender starts a Node server, so both Node and Bun must be available.

## Public `/` behavior

- `vite.config.ts` enables TanStack Start prerendering with link crawling and `failOnError`.
- `src/routes/index.tsx` defines the only public route, `/`, with route-owned SEO metadata, canonical link, Open Graph/Twitter metadata, and optional LocalBusiness JSON-LD from typed landing content.
- `src/features/landing/landing-page.tsx` renders the complete one-page marketing document: header, hero, stats, about, differentiators, brands, segments, contact, footer, and floating actions.
- `src/routes/__root.tsx` emits the full pt-BR HTML shell and the blocking reveal boot script. Essential page content and final values are present in prerendered HTML; the client hydrates interactive menu, reveal, card, and WhatsApp lead-form behavior.
- `src/router.tsx` keeps the Start router factory thin and enables scroll restoration and intent preloading.
- `scripts/serve-dist.ts` and `playwright.config.ts` exercise the prerendered HTML plus hydrating client bundle from `dist/client`.
- The first release has no API route, server function, database, authentication, or lead persistence. WhatsApp is the sole conversion boundary, with unusable numbers falling back to `#contato`.

## Current static deployment flow

1. `.github/workflows/ci.yml` pins Bun 1.3.14, installs with the frozen lockfile, and runs `bun run check` for pushes and pull requests.
2. `.github/workflows/publish.yml` builds `dist/client` in the GitHub runner with Node + Bun using `bun run build:app`.
3. `Dockerfile` uses `caddy:2-alpine`, copies `deploy/Caddyfile` and the already-built `dist/client` into `/srv`, and exposes container port 80. It does not run the TanStack build inside Docker.
4. The publish workflow pushes `ghcr.io/sum117/weyne-web` as `latest` and `sha-<full commit SHA>`.
5. `deploy/docker-compose.weyne.yml` runs the web image and a dedicated `cloudflare/cloudflared:latest` service on the private `weyne_edge` network. The web container publishes no host port.
6. Cloudflare terminates TLS at the edge; the dedicated tunnel forwards plain HTTP to `web:80`. Caddy serves static files, compression, cache policy, security headers, and access logs.
7. Production requires `IMAGE_TAG` and `CLOUDFLARE_TUNNEL_TOKEN` in the uncommitted VPS `.env.weyne`; `deploy/.env.weyne.example` is the non-secret template. The tunnel token is specifically a dedicated Cloudflare Tunnel token, not an account API token.

Relevant deployment paths: `Dockerfile`, `deploy/Caddyfile`, `deploy/docker-compose.weyne.yml`, `deploy/.env.weyne.example`, `.github/workflows/ci.yml`, and `.github/workflows/publish.yml`.

## Protected design handoff

The entire `docs/design-handoff/` tree is frozen, read-only reference for every subsequent spike. Do not edit, regenerate, optimize, reformat, or replace anything under it. This includes all 46 current files and these protected groups:

- Root specifications and plans: `README.md`, `PROMPT.md`, `ARCHITECTURE.md`, `IMPLEMENTATION.md`, `HANDOFF_PLAN.md`, `DESIGN_SPEC.md`, and `CHANGELOG.md`
- Authoritative copy and source material: `content/landing-page.md` and `content/represented-brands.pdf`
- Interactive references and assets: `design/`, including both `.dc.html` prototypes, `support.js`, and `design/assets/`
- Settled-state references: `screenshots/`

When references disagree, follow the precedence already recorded in `docs/design-handoff/README.md`; do not resolve disagreement by changing the handoff. Production output under `public/` is separate and must use the repository's existing asset pipelines rather than modifying handoff sources.

## Repository constraints for spike work

- Preserve the statically prerendered public `/` route and its existing design/copy behavior.
- Keep route files thin and keep all current landing copy/config in `src/features/landing/content.ts`.
- Do not invent business or contact data. Release readiness remains enforced by `WEYNE_RELEASE=1 bun run check:content`.
- Never hand-edit `src/routeTree.gen.ts`, `dist/`, `bun.lock`, or optimized assets under `public/`.
- Only `VITE_SITE_ORIGIN` and `VITE_WHATSAPP_NUMBER` are current public environment overrides; `VITE_*` values are browser-visible and must never contain secrets.
- TanStack Query, server functions, API routes, global state, authentication, databases, and persistence are absent from this baseline. Their validation belongs to the downstream spike cards, not this note.
