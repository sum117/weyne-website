# Architecture decision — TanStack Start

**Status:** accepted for implementation  
**Verified against current framework documentation:** 2026-07-20  
**Important release note:** TanStack Start is in Release Candidate status at the time of this handoff. Its documentation describes the API as feature-complete and stable, but it is not yet a v1 release. Pin framework versions, commit the Bun lockfile, and review Start release notes before upgrading.

## 1. Decision

Build the site as a **TanStack Start** application using React, TypeScript, Vite, Tailwind CSS v4, and CVA. The initial `/` route must be statically prerendered. It remains a single-page marketing experience with anchor navigation, but it lives inside a real route/document architecture so future pages, data loaders, server functions, middleware, and API routes can be added without migrating frameworks.

This is deliberately different from both of these extremes:

- It is **not** a client-only Vite SPA that will require a framework migration when SEO, server work, or additional routes appear.
- It is **not** a prematurely full application with Query, a database, auth, global state, a CMS, or a monorepo.

The scalable part is the boundary design, not the number of dependencies.

## 2. Why this is the recommended stack

TanStack Start is powered by TanStack Router and provides full-document SSR, static prerendering, route head management, server functions, server routes, middleware, and deployable client/server builds. That makes it possible to serve the current landing page as prerendered HTML while preserving a direct path to future application features.

### Alternative recommendation

Use **Astro + Tailwind + CVA** instead only when the product owner is confident this will remain a mostly static marketing site and any interactive product will live in a separate application. Astro is the leaner content-first choice for that case.

Stay with **Next.js** when organizational support, hosting conventions, or risk policy requires a mature v1 framework and the team does not want to adopt a release-candidate framework. Nothing in the visual handoff requires Next-specific features.

Given the stated goal—start with a landing page but keep the same codebase ready to become an application—TanStack Start is the best fit, with the RC caveat documented above.

## 3. Runtime and dependency stack

| Concern | Choice | Rule |
|---|---|---|
| Framework | `@tanstack/react-start` | Owns the document, route rendering, prerendering, and future server boundary |
| Routing | TanStack Router, file-based | `/` is the only route now; anchor links remain native `<a href="#…">` links |
| View layer | React + TypeScript, strict mode | No `any`; route components stay thin |
| Build | Vite | Use the official TanStack Start and Tailwind Vite plugins |
| Package manager | Bun | Commit `bun.lock`; use exact versions for Start while it remains RC |
| Styling | Tailwind CSS v4 | CSS-first tokens in `src/styles/app.css`; no `tailwind.config.js` unless a verified plugin requires it |
| Variants | `class-variance-authority` | Only for components with a meaningful public variant API |
| Class composition | `clsx` + `tailwind-merge` through `cn()` | No ad hoc string concatenation for conditional utility sets |
| Accessible primitives | shadcn/ui source components | Add only `button`, `sheet`, `field`, `input`, `textarea`, and `sonner` initially |
| Form state | `@tanstack/react-form` | Use Zod through Standard Schema validation |
| Validation | Zod | One schema for browser validation and any future server function |
| Motion | `motion` / `motion/react` | Centralized house easing and reduced-motion behavior |
| Icons | `@phosphor-icons/react` | `weight="light"` unless the design explicitly differs |
| Fonts | Fontsource variable packages | Newsreader and Jost, self-hosted |
| Unit tests | Vitest | Pure utilities, validation, and content integrity |
| Browser tests | Playwright | Small smoke suite and deterministic screenshot evidence |
| Accessibility checks | semantic review + optional `@axe-core/playwright` | Automated checks supplement, not replace, keyboard review |

### Dependencies intentionally absent

Do not install these until a concrete feature needs them:

- TanStack Query: add when remote server state must be cached, invalidated, refetched, or shared across routes.
- TanStack Store, Zustand, Redux, or another global store: local menu/form/scroll state is enough.
- TanStack DB, an ORM, or a database: the initial form opens WhatsApp and persists nothing.
- Authentication or session libraries.
- CMS SDKs.
- A separate API framework such as Hono.
- A monorepo tool.
- Storybook.
- A second UI kit.

## 4. Rendering model

### Initial release

- Route: `/`
- Rendering: full-document SSR during prerender, emitted as static HTML for the production route.
- Hydration: only for menu state, scroll state, card interactions, motion, and the WhatsApp form.
- Content source: typed local modules, not a loader or client fetch.
- Navigation: same-page anchors with native links and CSS `scroll-behavior` / `scroll-padding-top`.
- Server functions: none.
- API routes: none.

Configure TanStack Start prerendering in `vite.config.ts` with `enabled: true` and `failOnError: true`. Keep automatic discovery and link crawling enabled unless the chosen deployment adapter documents a reason not to.

### Future routes

Add routes under `src/routes/` when the product gains genuinely separate URLs, such as:

- `/marcas/$slug`
- `/segmentos/$slug`
- `/contato/obrigado`
- `/admin/...`

The landing page sections must not be converted into routes merely to demonstrate Router usage.

## 5. Repository layout

```text
weyne-site/
├── public/
│   ├── images/
│   │   ├── brands/
│   │   ├── carolina-desk.avif
│   │   ├── carolina-desk.webp
│   │   ├── carolina-desk.png
│   │   ├── carolina-desk-mobile.avif
│   │   ├── carolina-desk-mobile.webp
│   │   ├── carolina-desk-mobile.png
│   │   └── brand marks and watermarks...
│   ├── og/
│   │   └── weyne-home.jpg
│   ├── favicon.ico
│   ├── robots.txt
│   └── site.webmanifest
├── src/
│   ├── routes/
│   │   ├── __root.tsx            # document shell, global head, CSS link, boundaries
│   │   └── index.tsx             # route metadata + <LandingPage /> only
│   ├── routeTree.gen.ts           # generated; never edit manually
│   ├── features/
│   │   └── landing/
│   │       ├── landing-page.tsx
│   │       ├── content.ts         # typed copy/data contract
│   │       ├── content.schema.ts  # validates client-provided launch values
│   │       ├── lead.schema.ts
│   │       ├── whatsapp.ts
│   │       ├── components/
│   │       │   ├── count-up.tsx
│   │       │   ├── reveal.tsx
│   │       │   ├── section-heading.tsx
│   │       │   └── wave-divider.tsx
│   │       └── sections/
│   │           ├── hero-section.tsx
│   │           ├── stats-section.tsx
│   │           ├── about-section.tsx
│   │           ├── differentiators-section.tsx
│   │           ├── brands-section.tsx
│   │           ├── segments-section.tsx
│   │           └── contact-section.tsx
│   ├── components/
│   │   ├── ui/                    # shadcn-generated, brand-tuned source components
│   │   └── site/
│   │       ├── site-header.tsx
│   │       ├── site-footer.tsx
│   │       └── floating-actions.tsx
│   ├── lib/
│   │   ├── cn.ts
│   │   ├── env.ts                 # public env parsing; no UI imports
│   │   └── seo.ts                 # small helpers/types only, if useful
│   └── styles/
│       └── app.css                # Tailwind import, tokens, base styles, keyframes
├── tests/
│   ├── unit/
│   │   ├── lead-schema.test.ts
│   │   ├── whatsapp.test.ts
│   │   └── content-integrity.test.ts
│   └── e2e/
│       └── landing.spec.ts
├── .env.example
├── components.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── bun.lock
```

### Boundary rules

- `src/routes/` owns URL, route head, and route lifecycle. It does not contain section markup.
- `src/features/landing/` owns the landing-page domain, copy contract, and page-specific composition.
- `src/components/ui/` contains reusable source-owned primitives. It must not import from `features/`.
- `src/components/site/` contains site-wide shell components that may be reused by future routes.
- `src/lib/` contains framework-independent utilities. It must not import React components.
- Generated `routeTree.gen.ts` is never manually edited or reviewed as authored code.

Dependency direction:

```text
routes → features → site/ui components → lib
                    ↘ content/contracts
```

No lower layer may import from a higher layer.

## 6. Route ownership

### `src/routes/__root.tsx`

Owns:

- `<html lang="pt-BR">` document structure
- charset and viewport metadata
- theme color, icons, manifest, and global stylesheet link
- `<HeadContent />`, `<Outlet />`, and `<Scripts />`
- root error and not-found boundaries when added
- development-only Router devtools, lazy-loaded and excluded from production

It does not own page-specific title, description, Open Graph copy, or LocalBusiness JSON-LD.

### `src/routes/index.tsx`

Owns:

- page title and description
- canonical URL once the production origin is confirmed
- Open Graph and Twitter card metadata
- home-page structured data after real business details are confirmed
- rendering `<LandingPage />`

It does not contain the entire landing-page JSX.

## 7. Content architecture

The initial content remains local and typed. Define a `LandingPageContent` contract and export one immutable object. Components consume that object; they do not embed business values in multiple files.

Separate:

- stable design copy and list data;
- launch configuration such as phone, email, social URLs, CNPJ, canonical origin, and OG image;
- environment-specific public values such as the WhatsApp number, if deployment requires them.

Create a production readiness validator that fails `bun run build` or a preceding `bun run check:content` when any required value is empty, uses the known placeholder number, contains `[PREENCHER]`, or still uses the placeholder CNPJ.

Do not expose private keys through `VITE_` variables. The WhatsApp number is public and may be client-visible; future CRM or email credentials must live only in server code.

## 8. State model

State must stay as close as possible to the component that owns it:

- mobile sheet open state: Radix/shadcn component state;
- header scrolled state: header component;
- brand overlay open state on touch: individual brand card or a single controlled card id in the section;
- form state: TanStack Form;
- contact visibility / floating action visibility: the component coordinating those elements;
- no Context provider unless a state value is genuinely needed across unrelated subtrees.

Do not mirror URL anchors in Router state. Do not put transient UI state in search params.

## 9. Design-system and CVA rules

CVA is for reusable variants, not a replacement for Tailwind or a reason to abstract every element.

Good CVA candidates:

- `Button`: `variant = primary | inverse | sand | ghostOnDark`, `size = pill | pillLg | icon`.
- `SectionEyebrow`: `tone = light | dark`.
- optionally `IconTile`: a small reusable variant shared across multiple sections.

Keep one-off section grids, decorative layers, hero positioning, and unique cards as ordinary Tailwind classes. Avoid wrapper components whose only purpose is shortening a class string.

All dynamic Tailwind values must be statically discoverable. Use explicit maps or inline CSS variables for data-driven values; never construct utility names from arbitrary strings.

## 10. Server evolution path

The initial build has no backend. When a real backend requirement appears, evolve inside TanStack Start:

### Lead persistence

1. Keep `lead.schema.ts` as the shared contract.
2. Add a validated Start server function for lead submission.
3. Perform rate limiting, bot protection, CRM/email delivery, and secret access on the server.
4. Decide product behavior explicitly: persist first and then open WhatsApp, or treat WhatsApp as the only submission.
5. Add TanStack Query only when mutation lifecycle, retry, optimistic state, or shared server cache becomes useful. A single server function call does not automatically justify Query.

### CMS-backed content

1. Preserve the `LandingPageContent` output shape.
2. Add a server-only adapter or route loader that returns that shape.
3. Keep section components unchanged.
4. Add caching/revalidation based on the CMS's actual update frequency.

### Authenticated application

Add authenticated layout routes and server-side authorization only when required. Route guards are navigation UX; every server function and server route must enforce its own authorization boundary.

## 11. Deployment strategy

The architecture is deployment-adapter neutral. Feature code must not import a provider SDK.

Preferred choices:

1. **Cloudflare Workers** when the team expects future server functions and wants an official TanStack hosting path from day one.
2. **Netlify** when the organization already uses it and wants its official TanStack Start Vite integration.
3. **Bun server/container** when infrastructure is already container-based and the team wants to keep Bun as the production runtime.
4. **Static hosting of prerendered output** when the first release truly has no runtime behavior. Verify the generated output and rewrite rules against the installed Start version and chosen host.

Regardless of target:

- deploy previews must be available for visual review;
- production must use HTTPS;
- compression and immutable caching must be enabled for hashed assets;
- image assets must receive long-lived cache headers;
- HTML must not be cached so aggressively that contact updates cannot be rolled out safely;
- rollback must be one deployment action.

## 12. Performance and accessibility budgets

These are release gates, not aspirations:

- mobile Lighthouse: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95;
- no avoidable layout shift from images or fonts;
- explicit dimensions or aspect ratios for all meaningful images;
- above-the-fold hero media delivered as AVIF/WebP with PNG fallback and kept within an agreed asset budget;
- no third-party font requests;
- no blocking analytics script in the first release;
- all behavior available by keyboard and touch;
- `prefers-reduced-motion` disables non-essential motion and leaves all content visible;
- minimum WCAG 2.2 AA target for authored UI;
- one logical H1, semantic section headings, landmarks, labels, alt text, and focus-visible states.

## 13. Quality gates

`bun run check` should run, in order:

1. content/config validation;
2. TypeScript typecheck;
3. lint;
4. unit tests;
5. production build.

Playwright smoke tests may run separately in CI if browser installation cost makes the main check too slow, but they must run before release.

Minimum unit coverage is contract-focused, not percentage-driven:

- WhatsApp URL construction and encoding;
- lead schema behavior;
- required list counts and unique IDs/anchors;
- production placeholder rejection.

Minimum browser coverage:

- home route renders and all section anchors exist;
- desktop nav and mobile sheet behavior;
- form validation and generated WhatsApp URL;
- touch/keyboard brand overlay behavior;
- no horizontal overflow at canonical widths.

## 14. Non-goals for the first release

- product catalog or brand detail routes;
- e-commerce;
- authentication;
- a database;
- server-side lead storage;
- CRM integration;
- a CMS;
- analytics unless explicitly approved with privacy requirements;
- internationalization;
- dark mode;
- PWA/offline behavior;
- a component package or monorepo;
- React Server Components;
- generic design-system extraction beyond components the page actually uses.

## 15. Primary documentation references

- TanStack Start overview: `https://tanstack.com/start/latest/docs/framework/react/overview`
- TanStack Start getting started: `https://tanstack.com/start/latest/docs/framework/react/getting-started`
- Static prerendering: `https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering`
- Tailwind integration: `https://tanstack.com/start/latest/docs/framework/react/guide/tailwind-integration`
- Hosting: `https://tanstack.com/start/latest/docs/framework/react/guide/hosting`
- SEO: `https://tanstack.com/start/latest/docs/framework/react/guide/seo`
- shadcn TanStack Start installation: `https://ui.shadcn.com/docs/installation/tanstack`
- shadcn TanStack Form guide: `https://ui.shadcn.com/docs/forms/tanstack-form`

