# Weyne authenticated app: route and design-foundation inventory

**Repository state inspected:** 2026-08-17

**Scope:** authenticated application surfaces only; the public landing page is evidence for reusable visual foundations but is explicitly excluded from redesign scope.

> **Snapshot note:** Sections 1–8 record the repository state at the inventory pass. Concurrent downstream work later added `/app`, `/app/produtos`, and an experimental `/app/relatorios` route. The generated route tree now exposes those paths in addition to `/`; see `docs/authenticated-app-screenshot-matrix.md` for the revalidated current-versus-target route classification. The original zero-route finding remains historical evidence and must not be read as current route truth.

## 1. Executive finding

This repository does **not** currently contain an authenticated application.
There are no authenticated routes, application layouts, login/session guards,
server functions, app navigation, dashboards, CRUD pages, tables, or chart
implementations to inventory. The generated router knows only `/`, which is the
public one-page marketing site (`src/routeTree.gen.ts:20-36`). The architecture
also names authentication as a first-release non-goal and describes an
authenticated application only as a future extension
(`docs/design-handoff/ARCHITECTURE.md:267-269,333-344`).

Consequently, the set of **in-scope existing routes is empty**. Any UX spec for
an authenticated app must define its information architecture and route
contract rather than presenting guessed routes or entities as existing
behavior.

## 2. Complete route inventory

### In-scope authenticated routes

| Route | Classification | Layout | Query/filter/state variants | Evidence |
|---|---|---|---|---|
| _None_ | — | — | — | `src/routes/` contains only `__root.tsx` and `index.tsx`; `src/routeTree.gen.ts:20-36` exposes only `/`. |

This accounts for every in-scope route: there are zero authenticated routes in
the checked repository.

### Defined routes and shells outside scope

| Route or route node | Classification | Scope decision | Current behavior and variants | Implementation |
|---|---|---|---|---|
| `/` | Other — public landing page | **Excluded from app redesign** | Statically prerendered one-page marketing surface. No path params, loader, validated search schema, query filters, or route-owned data state. Its meaningful variants are section anchors (`#topo`, `#sobre`, `#diferenciais`, `#marcas`, `#segmentos`, `#contato`), header pre/post 24px scroll, mobile menu open/closed, touch brand overlays, contact validation/opening feedback, FAB visibility, reveal/count-up state, and reduced motion. These are landing states, not app routes. | `src/routes/index.tsx:1-40`; composition at `src/features/landing/landing-page.tsx:12-35`; anchors typed at `src/features/landing/content.ts:29-37`; content/navigation at `src/features/landing/content.ts:280-301`. |
| `__root__` | Other — document shell, not a URL | May be retained as framework infrastructure, but it is **not** an authenticated app layout | Owns pt-BR document, global head/assets, reveal boot script, global `Toaster`, and scripts. It has no app shell, outlet-side auth guard, app error boundary, or not-found boundary. | `src/routes/__root.tsx:11-49`. |

Router-wide behavior is limited to scroll restoration, intent preloading, and a
zero preload stale time (`src/router.tsx:8-16`). Repository search found no
`beforeLoad`, route loaders, `validateSearch`, or search schemas. There is no
URL-established contract for pagination, sorting, tabs, filters, selected
records, or modal/drawer state.

## 3. Existing page structure and navigation

### Shared layouts

- There is no authenticated layout route or nested app route tree.
- `RootDocument` is the full-document shell, not an application frame
  (`src/routes/__root.tsx:35-49`).
- `LandingPage` composes the public `SiteHeader`, seven landing sections,
  `SiteFooter`, and `FloatingActions`
  (`src/features/landing/landing-page.tsx:12-35`). These public marketing
  components must not be mistaken for a desktop app sidebar/top bar.

### Navigation

- Public desktop navigation is a fixed header with four native anchor links and
  a contact CTA; it does not use Router links
  (`src/components/site/site-header.tsx:99-119`).
- Below 900px, navigation becomes a top `Sheet`, closes when an item is chosen,
  and is also closed when the viewport reaches desktop width
  (`src/components/site/site-header.tsx:31-37,121-173`).
- No authenticated sidebar, context bar, breadcrumbs, account switcher,
  organization switcher, command menu, user menu, or permission-based nav is
  established.

## 4. Existing domains, data surfaces, and state

### Primary authenticated entities

**None are established.** The repository does not define customers, accounts,
contacts, opportunities, orders, products, invoices, activities, users, teams,
or any other authenticated business record. Those names must remain candidate
concepts until product requirements establish them.

The only typed domain is public landing content:

- stats, differentiators, represented brands, market segments, contact details,
  SEO, and landing navigation (`src/features/landing/content.ts:25-187`);
- a transient lead input with `nome`, optional-in-UX `empresa`, and optional
  `mensagem` (`src/features/landing/lead.schema.ts:10-26`).

These are marketing-content records and a WhatsApp message draft, not evidence
of authenticated app entities or persistence.

### Forms

- The only form is the public contact form. It uses TanStack Form and Zod,
  validates on blur and submit, and opens a generated WhatsApp URL without
  persistence (`src/features/landing/components/contact-form.tsx:39-67`).
- It implements touched-field errors, `aria-invalid`, `aria-describedby`, a
  live error region, disabled styling in the primitives, and transient
  “Abrindo o WhatsApp…” feedback
  (`src/features/landing/components/contact-form.tsx:69-160`;
  `src/components/ui/field.tsx:37-65`).
- It does **not** establish app create/edit patterns, server-error mapping,
  autosave, dirty-state guards, optimistic submission, draft persistence,
  multi-step flows, date/select/combobox inputs, destructive actions, or
  authorization failures.

### Tables and charts

- No `<table>` implementation, table primitive, data-grid dependency, TanStack
  Table dependency, pagination control, row selection, column visibility,
  faceting, or bulk action exists.
- No chart library or data visualization exists. `ChartLineUp` is only a
  Phosphor icon used for the marketing differentiator “Compromisso com
  resultados” (`src/features/landing/content.ts:381-385`); it is not a chart.
- The landing stat band is a responsive card grid, not a dashboard KPI system
  (`src/features/landing/sections/stats-section.tsx:7-35`).

### State model actually present

State is local and transient: mobile-sheet open state, scrolled header state,
touch brand overlay state, form state, WhatsApp-opening feedback, reveal/count
animation, and floating-action visibility. The architecture explicitly avoids
mirroring anchors in Router state and avoids global context without a concrete
need (`docs/design-handoff/ARCHITECTURE.md:221-232`). There is no remote cache,
global store, authenticated session, persisted user preference, or server
mutation lifecycle.

## 5. Foundations to retain

These are verified implementation foundations. They can inform an authenticated
app without carrying over the landing page's composition.

### Color system

Canonical CSS-first tokens live in `src/styles/app.css:11-38`:

| Token | Current value | Existing role |
|---|---:|---|
| `navy` | `#012c4b` | darkest brand surface; root theme color also uses `#012C4B` (`src/routes/__root.tsx:16`) |
| `blue` | `#034f83` | primary brand/action color |
| `baltic` | `#069cff` | hover and focus accent/ring |
| `sand` | `#eecaa0` | warm secondary/accent |
| `paper` | `#f6f3ec` | page background |
| `ink` | `#12314c` | primary text on light surfaces |
| `muted` | `#5c7286` | secondary text |
| `line` | `rgb(3 79 131 / 0.13)` | hairline border |

The shadcn semantic bridge maps background/foreground/card/popover/primary,
secondary, muted, accent, destructive, border, input, and ring variables onto
that palette (`src/styles/app.css:92-136`). It is light-only. Preserve the
semantic layer rather than hard-coding the three headline colors throughout
new app components.

Existing first-class gradients are `bg-hero-radial`, `bg-card-gradient`, and
`bg-segments-gradient` (`src/styles/app.css:138-154`). They are landing-oriented
and should not automatically become app-surface treatments.

### Typography

- `Jost Variable` is self-hosted and mapped to `font-sans`.
- `Newsreader Variable` (roman and italic) is self-hosted and mapped to
  `font-display`.
- Imports and mappings are in `src/styles/app.css:4-15`; dependencies are in
  `package.json:37-40`.
- Existing convention: Jost for UI/body; Newsreader for display headings,
  wordmark, quotes, and large stats. The frozen design reference records
  Newsreader 400/500 and Jost 400/500/600 as the intended weights
  (`docs/design-handoff/DESIGN_SPEC.md:48-67`).

The app UX spec should retain the families but must decide where display serif
is appropriate in a denser product UI (for example, page titles versus table
cells). The repository does not define an authenticated-app type scale.

### Spacing, sizing, and radii

There is **no named app spacing-token layer** beyond Tailwind v4's spacing
scale. Existing landing composition combines Tailwind scale utilities with
intentional arbitrary/clamped values. Verified recurring values include:

- outer horizontal padding: `clamp(18px,5vw,48px)`;
- content max widths: `1320px` (`max-w-330`) for nav/hero and `1200px`
  (`max-w-300`) for sections;
- section vertical padding: approximately `clamp(84px,11vw,140–150px)`;
- semantic radius base: `--radius: 0.75rem`, with `sm/md/lg/xl` derivatives;
- landing card radii commonly 20–26px, pill buttons fully rounded, inputs 12px.

Implementation sources: `src/styles/app.css:112,132-135`,
`src/components/site/site-header.tsx:48`,
`src/features/landing/sections/brands-section.tsx:10-13,32`, and
`docs/design-handoff/DESIGN_SPEC.md:69-75`.

These values are foundations, not yet a dense app spacing contract. The UX
spec must define app-shell dimensions, control heights, row density, form
rhythm, and content gutters without inventing a parallel token library unless
repetition justifies new CSS-first tokens.

### Easing, motion, and shadows

- House easing: `cubic-bezier(0.16, 0.8, 0.24, 1)` as `--ease-house`
  (`src/styles/app.css:29-30`).
- Named shadows:
  - `band`: `0 40px 80px -46px rgb(3 79 131 / 0.4)`;
  - `founder`: `0 46px 90px -50px rgb(3 79 131 / 0.42)`;
  - `form`: `0 50px 100px -50px rgb(1 44 75 / 0.9)`;
  - `card-hover`: `0 44px 74px -38px rgb(3 79 131 / 0.45)`;
  - `brand-hover`: `0 48px 84px -40px rgb(3 79 131 / 0.5)`;
  - `pill`: `0 12px 26px -14px rgb(3 79 131 / 0.75)`.
- Definitions are at `src/styles/app.css:32-38`; named utilities are used by
  the stat, founder, form, differentiator, and brand surfaces.
- Reduced motion globally collapses animation/transition duration and keeps
  reveal content visible (`src/styles/app.css:233-250`).

The large landing shadows are too expressive to assume for dense app chrome.
The app spec must define restrained elevation usage while retaining the color
and easing character.

### Icons

- `@phosphor-icons/react` is installed (`package.json:40`).
- shadcn configuration selects `"iconLibrary": "phosphor"`
  (`components.json:13`).
- Components import SSR-safe icon exports from
  `@phosphor-icons/react/dist/ssr`; rendered icons use `weight="light"` in the
  inspected UI (for example `src/components/ui/sheet.tsx:78-80` and
  `src/components/site/site-header.tsx:113-116,135-139`).

Retain Phosphor and the light-weight convention; define filled/duotone
exceptions only if state communication requires them.

### Tailwind v4 and shadcn source ownership

- Tailwind is v4 and CSS-first: `@import 'tailwindcss'` plus `@theme`; there is
  no `tailwind.config.js` (`src/styles/app.css:1-2,11-67`).
- `components.json` points shadcn to `src/styles/app.css`, enables CSS
  variables, uses the `new-york` style, and aliases UI source to
  `@/components/ui` (`components.json:2-19`).
- `cn()` is the existing `clsx` + `tailwind-merge` composition boundary
  (`src/lib/cn.ts`).
- CVA is used only where a public variant API exists, currently `Button` and
  `IconTile` (`src/components/ui/button.tsx:13-35` and
  `src/features/landing/components/icon-tile.tsx`).

## 6. Reusable source components currently available

| Component | Existing capability worth retaining | App-use constraint or gap | Source |
|---|---|---|---|
| `Button` | Source-owned, `asChild`, CVA, visible focus, disabled state | Variants (`primary`, `inverse`, `sand`) and sizes (`pill`, `pillLg`, `submit`) are CTA/landing-specific; no secondary/ghost/destructive/icon/loading app API | `src/components/ui/button.tsx` |
| `Input` | Semantic token border, strong focus ring, invalid and disabled states | No size variants, prefix/suffix, clear affordance, read-only treatment, or app density contract | `src/components/ui/input.tsx` |
| `Textarea` | Same focus/invalid/disabled treatment; resize-y | No size variants, counter, autosize, or app density contract | `src/components/ui/textarea.tsx` |
| `Field`, `FieldLabel`, `FieldError`, `FieldDescription` | Label semantics and live error region | Label/description/error colors are tuned for the dark landing contact card; light app forms need a deliberate tone/variant rather than ad hoc overrides | `src/components/ui/field.tsx` |
| `Sheet` family | Radix Dialog behavior, portal, overlay, four sides, title/description, optional close control | No body/footer primitives, app navigation anatomy, nested-nav behavior, or responsive shell integration | `src/components/ui/sheet.tsx` |
| `Toaster` | Global, non-blocking, light Sonner host using brand variables | No standardized app success/error/warning/action copy or mutation integration | `src/components/ui/sonner.tsx`; mounted at `src/routes/__root.tsx:42-45` |

Site-level `SiteHeader`, `SiteFooter`, and `FloatingActions` are reusable only
within the public-site family. They are not an authenticated app shell.

Missing app primitives include, at minimum: card, badge/status, tabs, table,
pagination, select/combobox, checkbox/radio/switch, dropdown/context menu,
tooltip, popover, dialog/alert-dialog, skeleton, avatar, breadcrumb, separator,
scroll area, command menu, calendar/date input, and chart wrappers. Add source
components only when the route specification proves a need; do not add a second
UI kit.

## 7. Responsive and accessibility behavior already established

### Responsive behavior

- Canonical custom nav breakpoint: `--breakpoint-nav: 56.25rem` (900px)
  (`src/styles/app.css:16-17`).
- Public header switches from desktop links to a mobile Sheet at that
  breakpoint (`src/components/site/site-header.tsx:99-173`).
- Phone-specific landing adjustments use Tailwind's `max-sm` behavior around
  640px, including stat stacking and hero/brand adaptations
  (`src/features/landing/sections/stats-section.tsx:9-12`;
  `src/features/landing/sections/brands-section.tsx:24-28`).
- Fluid grids use `auto-fit/minmax` and clamped spacing rather than many named
  breakpoints (for example `src/features/landing/sections/brands-section.tsx:13,32`).
- Safe-area insets are handled in the fixed header/mobile sheet
  (`src/components/site/site-header.tsx:48,145`).

No authenticated shell has established desktop sidebar collapse behavior,
table-to-card adaptation, sticky columns/actions, mobile detail navigation, or
app overflow rules.

### Accessibility behavior

Foundations include pt-BR document language, a landing skip link, semantic
labels and errors, `aria-expanded` on the menu trigger, Radix dialog semantics,
keyboard-visible focus, reduced-motion support, touch handling for brand cards,
and sr-only names for icon-only controls. Relevant sources include
`src/routes/__root.tsx:35-47`, `src/features/landing/landing-page.tsx:15-20`,
`src/styles/app.css:205-209,233-250`, and
`src/components/site/site-header.tsx:121-173`.

The app spec still must establish focus movement after route changes, landmark
and heading rules for the app shell, keyboard table interactions, status/error
announcements, modal focus return, row-action discoverability, target sizes,
zoom/reflow, and color-independent status communication.

## 8. Inconsistencies and unresolved gaps

### Verified implementation inconsistencies or risks

1. **Task premise versus repository reality:** requested authenticated app
   routes and entities do not exist. Treating benchmark examples as Weyne
   routes would fabricate product scope.
2. **Breakpoint value duplicated across layers:** 900px is a CSS token
   (`src/styles/app.css:17`) and a hard-coded JS media query
   (`src/components/site/site-header.tsx:33`). Values currently agree, but there
   is no shared runtime source.
3. **Partial token adoption:** recurring shadows are named, but several
   components still use inline arbitrary shadows. `Button`'s primary shadow,
   for example, duplicates the `shadow-pill` value instead of consuming the
   named utility (`src/components/ui/button.tsx:19` versus
   `src/styles/app.css:38`). Header, Sheet, FAB, and hero badge also carry
   one-off shadows.
4. **Literal derived colors coexist with semantic tokens:** this is consistent
   with the frozen landing design, but app work should prefer semantic tokens.
   Examples include header text colors and dark form-submit text
   (`src/components/site/site-header.tsx:83,91,107`;
   `src/components/ui/button.tsx:22`).
5. **Shared field primitives are surface-specific:** labels and helper/error
   colors default to white/sand, making the nominally reusable primitives
   implicitly dark-surface components (`src/components/ui/field.tsx:21-65`).
6. **No route-level failure boundaries:** the root architecture mentions error
   and not-found boundaries “when added,” but neither is implemented
   (`docs/design-handoff/ARCHITECTURE.md:182-193`;
   `src/routes/__root.tsx:11-27`).

### Product/UX questions the specification must resolve

The repository provides no intended behavior for the following, so the UX spec
must label decisions as new requirements rather than retained behavior:

- authenticated route map, URL naming, nesting, default route, and deep links;
- login/recovery/invitation/session expiry and server-side authorization;
- user roles, organizations/territories, and permission-based navigation;
- canonical business entities, relationships, identifiers, lifecycle statuses,
  ownership, and which operations are permitted;
- dashboard audience, KPI definitions, time ranges, comparison logic, freshness,
  and drill-down destinations;
- list columns, default sort, filters/facets, search semantics, pagination versus
  infinite scrolling, row selection, bulk actions, saved views, export, and URL
  persistence;
- detail-page hierarchy, related records, activity/history, edit boundaries,
  destructive actions, and audit information;
- create/edit validation, optional versus required fields, server errors,
  duplicate detection, unsaved changes, success destinations, and cancellation;
- loading, empty, no-results, partial-data, stale, offline, forbidden,
  not-found, server-error, and retry states;
- chart data, units, zero/null handling, legends, accessible summaries, and
  responsive fallback;
- desktop sidebar/top-bar anatomy and mobile Sheet navigation;
- app-specific breakpoints, density, overflow, keyboard shortcuts, focus order,
  announcements, and screenshot fixtures.

## 9. Boundary for downstream work

Retain the brand palette, Jost/Newsreader families, house easing, intentional
shadow vocabulary, Phosphor-light icons, Tailwind v4 CSS-first architecture,
semantic shadcn token bridge, source-owned shadcn/Radix components, `cn()`
composition, and reduced-motion/focus conventions.

Do **not** redesign or absorb the public `/` landing page into the authenticated
app scope. Do **not** treat its fixed marketing header, anchor navigation, stat
band, brand cards, contact form, or floating WhatsApp controls as established
app patterns. Do **not** claim authenticated routes or CRM entities until a
product source establishes them.
