# AGENTS.md

Instructions for AI coding agents working in this repository. Human-facing
docs live in [README.md](README.md).

## Project

One-page marketing site for Weyne Representações (commercial representation,
professional hygiene & cleaning, Brazilian Northeast). TanStack Start
(React 19, file-based routing, full-document SSR) — the `/` route is
statically prerendered at build time and hydrates only for the menu, scroll
reveals, card interactions, and the WhatsApp lead form. The single conversion
goal is starting a WhatsApp conversation. Site copy is pt-BR; code, comments,
and commit messages are English.

## Commands

Bun 1.3+ is the package manager and script runner (CI pins 1.3.14).

- `bun install` — install deps (CI uses `--frozen-lockfile`)
- `bun run dev` — Vite dev server at http://localhost:3000
- `bun run check` — full gate: content check → typecheck → lint → unit tests
  → prerender build. Byte-for-byte what CI runs; run it before calling any
  task done.
- `bun run test` — Vitest unit tests · single file:
  `bun run test tests/unit/whatsapp.test.ts`
- `bun run typecheck` / `bun run lint` — `tsc --noEmit` / ESLint flat config
- `bun run build` — content check + prerendered production build → `dist/client`
- `bun run test:e2e` — Playwright smoke suite (`tests/e2e/`) against
  `dist/client` served statically on :3100; requires `bun run build` first.
  The config declares chromium/firefox/webkit; if a browser is missing
  locally, run one project (`bunx playwright test --project=chromium`) or
  install the rest (`bunx playwright install firefox webkit`).
- `bun run check:content` — content gate, preview mode. Release mode:
  `WEYNE_RELEASE=1 bun run check:content` (PowerShell:
  `$env:WEYNE_RELEASE='1'; bun run check:content`)
- Asset pipelines: `bun run generate:og` · `generate:icons` ·
  `optimize:images` · `screenshots`

Gotcha: the TanStack Start prerender spawns a Node server per route, so
`node` must be on PATH — Bun alone fails with "Unable to connect", and the
prerender is unreliable inside `docker build` (its server is unreachable).
So CI builds `dist/client` in the runner (Node + Bun) and the image only
packages it — see Delivery.

## Architecture

- Route files are thin. `src/routes/__root.tsx` owns the document shell (font
  /favicon links, the blocking `data-js` reveal-boot script);
  `src/routes/index.tsx` owns `/` plus all SEO head (OG/Twitter, canonical,
  JSON-LD). Section markup lives in `src/features/landing/`. Section anchors
  are native `<a href="#…">` links — never create routes for them.
- `src/features/landing/content.ts` is the single source of truth for ALL
  copy and launch config, fully typed. `content.schema.ts` validates
  structure (exact counts: 4 stats, 6 differentiators, 8 brands, 7 segments;
  unique keys; nav anchors must map to real sections) and production
  readiness (placeholder detection). `scripts/check-content.ts` layers brand
  asset existence checks on top. Preview mode downgrades readiness issues to
  warnings; `WEYNE_RELEASE=1` makes them hard errors.
- WhatsApp contract: every CTA that opens WhatsApp routes through
  `src/features/landing/whatsapp.ts` (`buildWhatsAppUrl`,
  `resolveWhatsAppHref`). Pure module — no React/DOM imports. Unusable or
  placeholder numbers fall back to the `#contato` anchor.
- Reveal system: a blocking head script sets `data-js` before first paint;
  the reveal CSS in `app.css` hides elements only under `data-js`, so no-JS
  visitors see everything and nothing ever flashes. The `Reveal` component
  flips `data-reveal-in` via IntersectionObserver; a 3s
  `data-reveal-fallback` reveals all if hydration never runs. All motion
  collapses under `prefers-reduced-motion`. Essential copy and final stat
  values must exist in the prerendered HTML (count-ups SSR their final
  value).
- Env: only optional public overrides `VITE_SITE_ORIGIN` and
  `VITE_WHATSAPP_NUMBER`, read statically per-key in `src/lib/env.ts`;
  confirmed defaults live in `content.ts`. Never put a secret in a `VITE_`
  variable — client-visible by design.
- First release deliberately excludes TanStack Query, server functions, API
  routes, global state, and any database (see
  `docs/design-handoff/ARCHITECTURE.md`). TanStack Start is RC: versions are
  pinned; do not casually upgrade Start/Router.

## Styling

- Tailwind CSS v4, CSS-first: every token (brand palette, `--ease-house`
  easing, shadows, keyframes, `--breakpoint-nav`) lives in
  `src/styles/app.css` under `@theme`. There is no `tailwind.config.js`.
- The design handoff mandates exact measurements: keep arbitrary values like
  `leading-[1.08]` as-is; do not round to a nearby Tailwind default token
  (`tailwindcss/no-unnecessary-arbitrary-value` is off for this reason).
- shadcn/ui source components in `src/components/ui` (new-york style); CVA
  only for components with a real variant API. Phosphor icons with
  `weight="light"`. `cn` helper at `@/lib/cn`; path alias `@/*` → `src/*`.
- ESLint enforces inline type-imports and `_`-prefixed unused vars.
  `docs/**` is ignored — reference material, not code.

## Hard boundaries

- Never invent business/contact data. Real values enter only through
  `content.ts` and must pass the release gate. CNPJ is still a placeholder;
  Instagram/LinkedIn are intentionally omitted until URLs exist.
- `docs/design-handoff/` is the frozen design handoff (spec, prototype,
  screenshots, brand assets) — read-only reference. `DESIGN_SPEC.md` holds
  exact visual values. Recreate the design; do not redesign it.
- Never hand-edit: `src/routeTree.gen.ts` (generated), `dist/`, `bun.lock`,
  or optimized images under `public/` (produced by the asset pipelines).

## Delivery

- `ci.yml` runs `bun run check` on every push/PR. `publish.yml` builds
  `dist/client` in the runner (`build:app`), then packages it into a Caddy
  image and pushes `ghcr.io/sum117/weyne-web` (`:latest` + `:sha-<full sha>`).
- Runtime is Caddy serving `dist/client` behind a dedicated Cloudflare
  Tunnel — no public ports. The VPS runs compose project `weyne` pinned by
  image SHA (`deploy/`); rollback = previous SHA.
- Secrets (`CLOUDFLARE_TUNNEL_TOKEN`) live only in `.env.weyne` on the VPS —
  gitignored, never in the repo.

## Git

- Conventional commits (`feat:`, `fix(docker):`, `chore:`), imperative
  subject.
- LF line endings everywhere, enforced by `.gitattributes` — development
  happens on Windows; never introduce CRLF.
- `main` is the only long-lived branch and must stay green (`bun run check`).
