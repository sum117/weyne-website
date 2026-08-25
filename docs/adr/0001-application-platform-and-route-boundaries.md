# ADR 0001: Application platform and route boundaries

- Status: Accepted
- Date: 2026-08-17
- Owners: Weyne application maintainers

## Context

Weyne is growing from a one-page marketing site into an authenticated internal application. The public landing page is already a working, statically prerendered TanStack Start document with intentional hydration behavior and a frozen design handoff. The application needs request-time authentication and data without making the public page dynamic or introducing a second frontend stack.

## Decision

1. Keep the validated platform: TanStack Start `1.168.32`, TanStack Router `1.170.18`, React/React DOM `19.2.7` as locked, TypeScript `5.9.3`, Vite `7.3.6`, and Bun `1.3.14` for dependency installation, scripts, tests, and builds. Preserve `bun.lock`; Start and Router remain exact manifest pins.
2. `/` is the only statically prerendered route. It remains the complete pt-BR marketing document and hydrates only its existing interactive behavior. It must remain usable without JavaScript and retain its SEO metadata, copy, visual contract, and WhatsApp conversion path.
3. The authenticated product lives under `/app`. `/app` and its descendants execute through the Start SSR handler per request and must never be added to the prerender list. Authenticated pages are `noindex`.
4. TanStack Start server functions are the typed application API boundary. Route loaders and TanStack Query call authorized server functions rather than introducing a parallel REST or GraphQL business API. Better Auth's catch-all HTTP handler is the protocol exception.
5. The product serves exactly one organization. Do not add tenant IDs, organization tables, organization-selection UI, per-tenant query scopes, Better Auth's organization plugin, tenant middleware, or other multitenancy abstractions. User roles and record ownership are authorization concerns inside this single organization, not tenants.
6. Preserve the repository boundaries: thin route files, server-only modules for privileged dependencies, typed landing content, generated route tree, and read-only `docs/design-handoff/`.

## Supported commands

From the repository root:

- `bun install --frozen-lockfile` — reproducible install.
- `bun run dev` — local Vite/Start development server.
- `bun run check` — required full gate: content, typecheck, lint, unit tests, dependency audit, production build/bundle budget, and production-header validation.
- `bun run build` — content gate plus production build.
- `bun run build:app` — CI/publish build of client, SSR handler, Node runtime, migration runner, and bundle checks.
- `bun run start` — run the built production server with Node.
- `bun run test:e2e` — Playwright against the built application.

Builds require both Bun and Node because Start's prerender launches a Node process.

## Consequences

- Public performance and SEO remain deterministic while authenticated routes can use request state.
- Any `/app` link discovered at build time cannot silently become public static output; the prerender configuration must continue to emit exactly `/`.
- Server and client module graphs must stay separated. Secrets, database/auth/storage libraries, and export libraries cannot enter browser imports or serialized loader data.
- Framework upgrades are deliberate architecture work: reproduce the relevant compatibility tests before changing Start, Router, React, Bun, TypeScript, or Vite versions.
- Downstream cards may add `/app` routes and authorization policies, but may not revisit the platform, route split, API style, or organization model without a superseding ADR.

## Rejected alternatives

- A second SPA/frontend for `/app`: duplicates routing, rendering, styling, and deployment concerns.
- Dynamic SSR for `/`: removes the validated static-first behavior without a product need.
- Prerendering `/app`: risks freezing authenticated or user-specific state into public artifacts.
- REST or GraphQL for ordinary business operations: duplicates the selected typed server-function boundary.
- Multitenancy “for later”: adds pervasive schema, authorization, query, and UX complexity for a product that is explicitly single-organization.
- Casual Start/Router upgrades: these packages are RC-era exact pins and compatibility has only been demonstrated for the recorded versions.

## Validation evidence

- [`docs/architecture-spike-baseline.md`](../architecture-spike-baseline.md) records a clean baseline `bun run check`, the pinned toolchain, a live prerendered `/`, and the frozen 46-file design handoff (`t_5c3ed803`).
- [`docs/architecture-spike-ssr-runtime.md`](../architecture-spike-ssr-runtime.md) records `Prerendered 1 pages: /` and two `/app` requests with different server timestamps, proving request-time SSR (`t_42cf7754`).
- [`spikes/001-persistence-auth-api-storage/README.md`](../../spikes/001-persistence-auth-api-storage/README.md) validates a compiled authenticated Start server function and explicitly proves the single-organization model (`t_e6fcf915`).
- [`docs/architecture-spike-client-data-exports.md`](../architecture-spike-client-data-exports.md) validates React 19 SSR/hydration and confirms the application build still prerenders only `/` (`t_239aa5fe`).
