# Engineering handoff plan — Weyne Representações

**Purpose:** turn the approved one-page prototype into a reviewable, launch-safe TanStack Start implementation while preserving a clean path to future application routes and server capabilities.

This plan separates product/design acceptance from engineering quality gates. It should be used for estimation, PR scope, review, release readiness, and the final maintenance handoff.

## 1. Delivery principles

1. The prototype is approved design input, not source code.
2. The landing page ships first as prerendered HTML at `/`.
3. Future scale comes from route, feature, content, form, and server boundaries—not speculative infrastructure.
4. Every phase ends in a buildable state and has objective evidence.
5. Missing business values remain explicit blockers; nobody invents them to make a preview look complete.
6. Visual review happens before performance tweaks obscure the source of layout differences.
7. Accessibility and touch behavior are part of design acceptance, not a final audit add-on.
8. An undocumented deviation from the prototype is a defect.

## 2. Decision record

### Accepted implementation decision

Use TanStack Start, React, TypeScript, Vite, Tailwind CSS v4, CVA, shadcn/ui source components, TanStack Form, Zod, Motion, Phosphor icons, Fontsource variable fonts, Bun, Vitest, and Playwright.

Prerender `/`. Do not introduce TanStack Query, global state, a database, auth, CMS, lead API, CRM integration, or monorepo in release one.

### Decision caveat

TanStack Start is a release-candidate framework at the date of this handoff. Engineering owns exact version pinning, lockfile review, upgrade discipline, and checking release notes before framework updates. A switch to Astro is justified only if product confirms the codebase will remain a static marketing site. A switch back to Next.js is justified only by an explicit organizational support/risk requirement, not by the current landing-page design.

### Decision owner

The engineering lead owns the framework implementation. Product/technical leadership must approve any framework change before implementation because it changes hosting, future backend seams, and long-term ownership.

## 3. Source-of-truth and change-control rules

| Concern | Authority | Review owner |
|---|---|---|
| Visible pt-BR copy | `content/landing-page.md` | Product/content owner |
| Exact visual values and interactions | interactive design HTML | Design owner |
| Architecture and dependencies | `ARCHITECTURE.md` + approved ADR changes | Engineering lead |
| Build sequence and technical recipes | `IMPLEMENTATION.md` | Implementer + engineering reviewer |
| Settled visual comparison | screenshots, after prototype inspection | Design + implementer |
| Business/legal/contact values | client-approved launch register | Product/client owner |
| Intentional deviations | deviation log with named approver | Relevant owner |

Change handling:

- Copy changes must be made in the authoritative content source first, then propagated to typed app content.
- Design changes must identify the affected component/state/breakpoint and update the prototype or provide a marked specification.
- Architecture changes require a short decision note containing context, alternatives, consequences, and migration impact.
- A reviewer may not approve a visual workaround that contradicts an unresolved product/design decision.
- Every release candidate includes the current open-input and deviation logs.

## 4. Roles and responsibilities

### Product/client owner

- supplies and approves launch contact, legal, social, canonical, and analytics values;
- approves final copy and conversion behavior;
- decides whether launch means WhatsApp-only or a later persisted lead flow;
- accepts or rejects unresolved scope changes;
- signs off launch readiness.

### Design owner

- confirms the interactive prototype is the final visual baseline;
- reviews canonical viewport evidence in the defined order;
- supplies an approved Open Graph image and any missing high-resolution assets;
- approves documented deviations;
- confirms hover/focus/touch and reduced-motion alternatives are visually acceptable.

### Engineering lead/reviewer

- owns framework/version/deployment decisions;
- reviews route and feature boundaries, prerender output, dependency restraint, security, and maintainability;
- confirms content validation and future server-function seams;
- verifies CI and rollback behavior;
- approves the final technical handoff.

### Implementer

- audits the bundle before coding;
- implements the complete approved scope;
- keeps content and launch values centralized;
- produces tests and evidence with each phase;
- maintains issue, input, and deviation logs;
- reports blockers immediately without inventing production values.

### QA/accessibility reviewer

- validates canonical breakpoints, browsers, keyboard/touch behavior, zoom/reflow, reduced motion, and key screen-reader semantics;
- verifies defects against the authoritative prototype/specification;
- confirms fixes and regression coverage before release.

One person may fill multiple roles, but the acceptance responsibility must remain explicit.

## 5. Required client input register

Create a tracked launch register with one owner and status for each item:

| Input | Required for | Blocking rule |
|---|---|---|
| WhatsApp international number | all primary CTAs and form submission | blocks production build/release |
| Public phone display value | contact/footer | blocks release unless approved for removal |
| Public email | contact/footer | blocks release unless approved for removal |
| CNPJ | footer/legal area | blocks release unless approved for removal |
| City/base address wording | organization/contact metadata | blocks structured data; may block visible copy |
| Instagram URL | footer/social | remove only with explicit approval |
| LinkedIn URL | footer/social | remove only with explicit approval |
| Founder signature/name | about/founder card | blocks copy sign-off |
| Canonical production origin | canonical, sitemap, absolute metadata | blocks production SEO sign-off |
| Open Graph image | social previews | blocks SEO/social sign-off |
| Hosting target | adapter, cache, preview, rollback | blocks release pipeline |
| Analytics requirement | privacy and implementation scope | default is no analytics |
| Lead persistence/CRM decision | future scope | default is WhatsApp-only, no storage |

The application must centralize these values and reject known placeholders in production mode.

## 6. Delivery phases and pull-request gates

The exact number of PRs may change, but do not merge one unreviewable full-site PR. The following five-PR model is recommended.

## PR 1 — Foundation, contracts, and prerender proof

### Scope

- scaffold TanStack Start with Bun;
- pin exact framework versions and commit `bun.lock`;
- configure Tailwind CSS v4, fonts, path aliases, lint, Vitest, and Playwright;
- add only approved shadcn primitives and runtime dependencies;
- implement `__root.tsx`, `/` route, route metadata seam, and global styles;
- enable static prerendering for `/`;
- establish folder boundaries;
- copy and optimize assets;
- create typed content/config contracts;
- create production placeholder/content validation;
- add one representative unit test and one browser smoke test;
- prove the H1 and copy exist in generated initial HTML.

### Required evidence

- dependency/version list;
- final Vite/Start plugin configuration;
- production build log;
- path or excerpt showing prerendered `/` HTML contains the H1;
- content-validation pass and intentional placeholder failure example;
- generated asset inventory with dimensions/formats;
- folder tree;
- no client-only wrapper around the entire route.

### Gate

Engineering lead confirms the project can add a second route and future server function without changing landing feature boundaries. Design review is not required beyond token/font setup.

## PR 2 — Complete static responsive implementation

### Scope

- fixed header and anchor navigation markup;
- hero and responsive image sources;
- stats band with final values visible without animation;
- about/founder section;
- differentiators;
- represented brands in default state;
- segments band;
- contact structure and semantic form markup;
- footer and floating controls in static/default state;
- all authoritative copy;
- responsive layouts at every canonical width;
- exact tokens, typography, gradients, curves, shadows, and media crops.

### Required evidence

At minimum provide screenshots for all sections at:

- 1440 × 1000;
- 1024 × 900;
- 768 × 1024;
- 430 × 932;
- 390 × 844;
- 360 × 800.

Also provide:

- content-integrity test results;
- no-horizontal-overflow evidence;
- source-to-implementation checklist covering every section;
- list of visible differences still intentionally deferred to interaction work.

### Gate

Design reviews in this order:

1. content and anatomy;
2. containers and vertical rhythm;
3. typography and wrapping;
4. colors/gradients/shadows/radii;
5. responsive behavior.

Do not review animation before the settled layout is accepted.

## PR 3 — Interaction, form, and progressive enhancement

### Scope

- transparent/solid header behavior;
- accessible mobile navigation `Sheet`;
- keyboard/touch brand description states plus desktop hover;
- TanStack Form and Zod validation;
- pure WhatsApp URL/message builder;
- valid submit behavior and failure fallback;
- reveal sequences and stats count-up;
- floating WhatsApp/back-to-top behavior;
- all focus, pressed, error, hover, touch, and open states;
- reduced-motion behavior;
- optional parallax only after all required interactions pass.

### Required evidence

- screen recording or captures of desktop and mobile navigation;
- keyboard walkthrough notes;
- touch-emulation result for brand cards;
- form validation/error captures;
- unit test cases for WhatsApp URL and schema;
- exact generated WhatsApp URL asserted in a test with sample values;
- reduced-motion capture showing final visible state;
- no hydration warnings or console errors.

### Gate

Engineering and accessibility reviewers confirm semantic controls, focus management, URL construction, progressive enhancement, and no hidden essential content. Design approves settled and interactive states.

## PR 4 — Quality hardening and deploy preview

### Scope

- complete unit and Playwright smoke suites;
- automated axe checks on settled page and open mobile menu;
- browser compatibility fixes;
- 200% zoom/reflow fixes;
- asset and runtime performance optimization;
- route-level SEO implementation using approved values where available;
- `robots.txt`, sitemap, favicon/manifest as applicable;
- deploy-preview pipeline;
- caching/compression setup;
- CI artifacts for build, browser report, screenshots, and Lighthouse;
- security and privacy review of external links/form behavior.

### Required evidence

- `bun run check` output;
- Playwright report;
- canonical screenshot set, including open/revealed/error states;
- Chrome, Firefox, and WebKit result summary;
- Lighthouse report from deploy preview;
- axe result summary plus manual accessibility checklist;
- generated HTML check for title, description, H1, body copy, and canonical when configured;
- bundle/dependency review showing no excluded speculative systems;
- deployment preview URL and rollback path.

### Gate

All quality budgets pass or have a named, time-bounded, explicitly approved exception. No serious/critical accessibility issue remains. No blocker is waived silently.

## PR 5 — Launch values, final acceptance, and maintenance handoff

### Scope

- insert approved contact/legal/social/SEO values in the centralized config;
- add approved Open Graph image;
- run production content validation;
- test every public external link;
- run final production build and preview/deploy;
- complete deviation and open-input logs;
- document routine content/contact updates;
- document deployment and one-action rollback;
- tag or otherwise identify the accepted release commit.

### Required evidence

- client-input register showing all release blockers resolved or explicitly removed from scope;
- production `bun run check` and Playwright results;
- final Lighthouse report;
- final canonical screenshot set;
- social metadata preview check;
- exact deployment commit/reference;
- maintenance guide identifying the one content/config location;
- approved deviation log;
- launch approval from product/client, design, and engineering.

### Gate

The production build cannot be approved while required values are placeholders. A preview with placeholders may be accepted as design-complete, but it is not launch-ready.

## 7. Acceptance matrix

### Viewports

| Width/height | Primary purpose |
|---|---|
| 1440 × 1000 | full desktop composition and maximum containers |
| 1024 × 900 | constrained desktop/tablet landscape behavior |
| 768 × 1024 | tablet and collapsed navigation behavior |
| 430 × 932 | large phone and design preview boundary |
| 390 × 844 | primary mobile reference |
| 360 × 800 | narrow phone/reflow stress case |

The screenshots supplied in the original bundle include a roughly 909px desktop capture. Use it as settled-state reference only; inspect the prototype at true canonical widths for measurements.

### Browsers and input methods

Before release, test current stable versions available in CI/local tooling for:

- Chromium/Chrome;
- Firefox;
- WebKit/Safari behavior through Playwright, plus a real Safari/iOS check when available;
- mouse/trackpad;
- keyboard only;
- touch or touch emulation.

### State coverage

Review at least:

- initial top-of-page state;
- header after scrolling;
- desktop anchor focus/target;
- mobile menu closed/open/after selection/Escape;
- CTA default/hover/focus/active;
- brand card rest/hover/keyboard-open/touch-open/closed;
- form empty/invalid/valid/submitting-or-navigating/fallback;
- floating actions hidden/visible/focus;
- normal motion and reduced motion;
- 200% zoom and narrow reflow;
- no-JavaScript or failed-hydration content visibility.

## 8. Quality gates

A release candidate must satisfy all of these.

### Functional

- every nav item targets an existing section;
- mobile menu focus behavior is correct;
- all primary CTAs use the approved WhatsApp destination;
- the form validates and constructs the exact approved message;
- brand information is available without hover;
- floating controls behave as specified;
- external links use safe target/rel behavior when opened in a new tab;
- no runtime or hydration error appears in normal use.

### Content and SEO

- all approved copy matches the content source;
- list counts and brand order are correct;
- no `PREENCHER`, example domain, or dummy contact remains in production output;
- title, description, canonical, Open Graph, and Twitter metadata are present when approved;
- structured data contains only confirmed facts;
- sitemap/robots behavior matches the production origin and deployment.

### Accessibility

- WCAG 2.2 AA target for authored UI;
- one H1 and semantic landmarks/headings;
- skip link and visible focus;
- complete keyboard operation;
- usable touch targets and touch alternatives;
- labels/errors/descriptions correctly associated;
- meaningful alt text and decorative-image treatment;
- reduced-motion path verified;
- 200% zoom/reflow verified;
- no serious/critical automated axe violations;
- managed sheet is the only intentional focus trap.

### Visual

- canonical viewport evidence is accepted;
- desktop/mobile image crop switch matches the prototype;
- section spacing, typography, line wrapping, colors, gradients, shadows, radii, and decorative shapes match;
- mobile layout and open menu match;
- brand reveal and form-error states match;
- no horizontal overflow or accidental clipping;
- any difference is logged and approved.

### Performance

- mobile Lighthouse Performance ≥ 90;
- Accessibility ≥ 95;
- Best Practices ≥ 95;
- SEO ≥ 95;
- meaningful images have dimensions/aspect ratios;
- hero uses optimized modern formats with fallback;
- no third-party font requests;
- no blocking analytics by default;
- production devtools are absent;
- hashed assets receive compression and long-lived immutable caching;
- HTML caching remains update-safe.

### Engineering

- TypeScript strict mode passes with no unjustified `any`;
- lint, focused unit tests, build, and release browser tests pass;
- prerendered `/` contains essential content;
- content/config validation runs before release;
- exact Start versions and lockfile are committed;
- route, feature, shared primitive, and utility dependency direction is preserved;
- no excluded speculative dependency or service was introduced;
- future server work can reuse the validation schema and add a Start server function without replacing form UI.

## 9. Defect severity and triage

| Severity | Examples | Release effect |
|---|---|---|
| Blocker | production placeholder, broken primary CTA, build/prerender failure, inaccessible navigation, missing section/content, severe data/privacy issue | release stops |
| Critical | major canonical viewport breakage, unusable form, keyboard trap, serious accessibility issue, route metadata absent | release stops |
| Major | material typography/layout mismatch, broken secondary interaction, significant browser issue, performance gate miss | fix before release unless named exception approved |
| Minor | small spacing/color difference without functional impact, low-risk polish issue | may be scheduled only with documented approval |

Triage defects against the authority table. Avoid arguing from screenshots when the interactive prototype or copy source provides the answer.

## 10. Deviation log format

Record every intentional difference with:

- unique ID;
- date;
- affected route/section/state/viewport;
- prototype/spec behavior;
- implemented behavior;
- reason;
- accessibility/performance/content impact;
- alternatives considered;
- approving owner and approval reference;
- follow-up date or “permanent”.

No verbal-only approval should survive into the release candidate.

## 11. CI and artifact retention

The pipeline should run or publish:

1. production content/config validation;
2. TypeScript typecheck;
3. lint;
4. Vitest;
5. production build/prerender;
6. Playwright release suite;
7. Lighthouse against deploy preview;
8. canonical screenshot artifacts.

Retain or link from the release record:

- build logs;
- exact commit and lockfile;
- Playwright HTML report;
- screenshot set;
- Lighthouse report;
- current open-input and deviation logs;
- deployment URL;
- rollback target/instructions.

Do not publish secrets in build logs, screenshots, metadata, or client bundles. The initial site should not require a secret because it only constructs a public WhatsApp URL.

## 12. Launch runbook

### Before deployment

- resolve every blocking client input;
- confirm content and design sign-off;
- run production content validation;
- run `bun run check` and Playwright;
- verify prerendered HTML directly;
- verify all external URLs;
- verify metadata against the production origin;
- check mobile menu, form, brand cards, and reduced motion on the deploy preview;
- capture final Lighthouse and canonical screenshots;
- confirm cache and compression configuration;
- identify the rollback deployment/commit.

### Immediately after deployment

- open the production URL in a clean browser session;
- test one desktop and one real mobile path;
- test every primary WhatsApp CTA and the form with a non-sensitive test message;
- confirm canonical/OG metadata and sitemap/robots responses;
- verify HTTPS and no mixed content;
- inspect console/network for unexpected failures;
- confirm the deployed commit/version;
- preserve evidence in the release record.

### Rollback triggers

Rollback immediately for:

- broken or wrong WhatsApp destination;
- missing page content or failed assets;
- failed hydration that blocks interaction;
- inaccessible navigation/form regression;
- incorrect public contact/legal data;
- severe browser-specific layout failure;
- security/privacy regression.

The hosting setup must support rollback in one deployment action. Content corrections that affect public contact/legal information should use the same urgent release discipline as code defects.

## 13. Maintenance handoff

The final repository documentation must show:

- how to install, run, test, build, preview, and deploy;
- the exact file containing contact, social, organization, and SEO values;
- how production placeholder validation works;
- how to change visible copy without scattering edits across components;
- how to add a represented brand safely;
- how to add a second public route;
- how a future server-side lead flow would reuse Zod validation and introduce a Start server function;
- when TanStack Query would become justified;
- how to update pinned TanStack packages safely;
- where visual baseline artifacts live;
- how to roll back a deployment.

A future developer should be able to update contact information in one place and add a route without understanding the prototype runtime.

## 14. Final acceptance record

The release record should contain these explicit statements:

- Product/client: launch values and visible copy approved.
- Design: canonical viewport and interaction evidence approved; deviations listed.
- Engineering: architecture, prerender output, tests, performance, deployment, and rollback approved.
- Accessibility/QA: keyboard, touch, focus, reduced motion, zoom/reflow, browser, and automated checks completed.
- Release owner: production URL, commit, deployment ID, and rollback target recorded.

A design-complete preview and a launch-ready production release are different milestones. Do not collapse them when client business values are still unresolved.
