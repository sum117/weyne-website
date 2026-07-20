# Weyne Representações — TanStack Start implementation handoff

**Revised:** 2026-07-20  
**Locale:** pt-BR  
**Current product scope:** one public landing page  
**Target architecture:** TanStack Start + React + TypeScript + Tailwind CSS v4 + CVA

This bundle turns the existing high-fidelity prototype into an implementation-ready handoff for a scalable TanStack application. The first release remains intentionally small: one prerendered marketing route whose only conversion is starting a WhatsApp conversation. The repository structure, route boundary, content contract, and validation seams are designed so later pages, server functions, lead persistence, or CMS-backed content can be added without replacing the landing-page implementation.

## Start here

| File or folder | Purpose |
|---|---|
| `PROMPT.md` | Ready-to-paste implementation prompt for a coding agent or development team |
| `ARCHITECTURE.md` | Architecture decision, stack, folder boundaries, evolution rules, deployment options |
| `IMPLEMENTATION.md` | Build sequence, TanStack-specific integration notes, component recipes, and QA requirements |
| `HANDOFF_PLAN.md` | Delivery phases, review gates, evidence expected in each PR, launch checklist, and ownership |
| `DESIGN_SPEC.md` | Original detailed visual specification: tokens, section anatomy, motion, accessibility, and exact values |
| `content/landing-page.md` | Authoritative pt-BR copy and launch placeholders |
| `design/Weyne Representacoes.dc.html` | Authoritative interactive visual reference; open in a browser with the whole `design/` directory intact |
| `design/Mobile Preview.dc.html` | Phone-frame preview at 360, 390, and 430 CSS-pixel widths |
| `screenshots/` | Settled-state visual references; useful for comparison, but not authoritative for measurements |
| `design/assets/` | Production source assets to copy and optimize; do not import the prototype runtime |

## Source-of-truth precedence

Use the following rule whenever two files appear to disagree:

1. **Visible copy:** `content/landing-page.md` wins.
2. **Visual values and interaction behavior:** `design/Weyne Representacoes.dc.html` wins.
3. **Implementation architecture and dependency choices:** `ARCHITECTURE.md` and `IMPLEMENTATION.md` win.
4. **Settled-state comparison:** screenshots are supporting evidence only. Their desktop captures are approximately 909px wide and must not be treated as 1440px measurements.
5. **Unresolved business data:** never invent it. Keep it centralized and fail the production readiness check until the client supplies it.

The proprietary `design/support.js`, inline prototype styles, and hand-written prototype JavaScript are reference material only. They must not be copied into production.

## Architecture summary

The recommended implementation is **TanStack Start**, not a plain Vite SPA. The `/` route is statically prerendered for the initial release, while TanStack Router, route head management, and Start's server boundary remain available for future application work. TanStack Query, global state, a database, authentication, and a CMS are explicitly excluded until a real feature requires them.

Core implementation choices:

- TanStack Start with React, TypeScript, Vite, and file-based routing
- Tailwind CSS v4 with CSS-first tokens
- CVA only for reusable component variants; Tailwind utilities for one-off page composition
- shadcn/ui primitives where they solve accessibility or behavior: `Sheet`, `Button`, `Field`, `Input`, `Textarea`, and `Sonner`
- TanStack Form + Zod for the contact form
- Motion for reveal, count-up, and small decorative animation
- Phosphor React icons, light weight
- Fontsource variable packages for Newsreader and Jost
- Bun as package manager and script runner; deployment runtime remains adapter-driven
- Static prerendering for `/`; no lead API in the first release

## Required client inputs before production

The site is not launch-ready until all of these are confirmed:

- WhatsApp number and display phone number
- Contact email
- CNPJ
- Instagram and LinkedIn URLs, or approval to remove those links
- Founder signature/name confirmation
- Canonical production origin
- Open Graph image
- Hosting target
- Whether analytics or a consent banner is required
- Whether leads should only open WhatsApp or also be persisted/sent to a CRM

Keep these values in one typed configuration module. Do not scatter placeholders through components.

## Definition of done at a glance

A release candidate must:

- reproduce the prototype at 1440, 1024, 768, and 390 CSS-pixel widths;
- preserve all keyboard, touch, reduced-motion, and focus-visible behavior;
- generate complete server-rendered/prerendered HTML for `/` with route-level metadata;
- contain no unapproved placeholder contact data;
- pass typecheck, lint, unit tests, production build, and the focused Playwright smoke suite;
- meet the performance, accessibility, SEO, and visual evidence gates in `HANDOFF_PLAN.md`.

