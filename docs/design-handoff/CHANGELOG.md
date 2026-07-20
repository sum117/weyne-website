# Handoff revision changelog

## 2026-07-20 — TanStack Start revision

- Replaced the plain Vite SPA architecture with TanStack Start and file-based TanStack Router routes.
- Changed the initial rendering strategy from client-only static output to prerendered HTML for `/`.
- Moved metadata ownership from `index.html` to route `head` definitions.
- Removed the proposed future Hono sidecar; future backend behavior now belongs in TanStack Start server functions or server routes.
- Replaced React Hook Form with TanStack Form while retaining Zod as the shared validation contract.
- Retained Tailwind CSS v4, CVA, shadcn/ui, Motion, Phosphor icons, Fontsource, and Bun.
- Added a strict dependency rule: do not add TanStack Query, Store, DB, auth, CMS, or a monorepo until a concrete requirement exists.
- Added a source-of-truth precedence model to resolve copy, visual, architecture, and screenshot conflicts.
- Added a feature-oriented folder layout that supports future routes without over-abstracting the current landing page.
- Added route-level SEO, canonical, Open Graph, structured-data, and prerender guidance.
- Added production content validation so placeholder contact values cannot silently ship.
- Added a focused test strategy: unit tests for pure contracts plus Playwright smoke/visual evidence at canonical widths.
- Added implementation PR boundaries, review gates, evidence requirements, launch ownership, and rollback expectations.
- Preserved the original detailed design specification as `DESIGN_SPEC.md`.

