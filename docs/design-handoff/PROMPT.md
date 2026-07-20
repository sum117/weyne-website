# Implementation prompt — Weyne Representações in TanStack Start

Use this prompt with the complete handoff bundle. It is written for a coding agent or an engineering team expected to implement, validate, and hand back a production-ready result—not merely propose an approach.

---

## Role

Act as the senior frontend engineer responsible for implementing the Weyne Representações website from the supplied high-fidelity prototype.

Your priorities, in order, are:

1. faithful reproduction of the approved design and pt-BR content;
2. semantic, accessible, server-rendered HTML;
3. a small but scalable TanStack Start architecture;
4. predictable responsive and interaction behavior;
5. testable content, form, and routing contracts;
6. restrained dependencies and abstractions;
7. documented launch readiness and any approved deviations.

Do the implementation. Do not stop at a plan, scaffold, component inventory, or partial hero section.

## Mission

Build the current one-page Weyne Representações marketing site as a production-quality **TanStack Start** application using React, TypeScript, Tailwind CSS v4, CVA, shadcn/ui source components, TanStack Form, and Zod.

The site currently has one public route, `/`, and one primary conversion goal: begin a WhatsApp conversation. Implement that route as prerendered HTML while preserving an architecture that can later accept additional routes, loaders, server functions, middleware, lead persistence, CRM integration, or CMS-backed content without replacing the landing page.

Scalability here means clear boundaries and extension seams. It does not mean adding speculative infrastructure.

## Read these inputs before coding

Read and inspect the complete bundle in this order:

1. `README.md` — bundle map, precedence rules, current decision summary, launch blockers.
2. `content/landing-page.md` — authoritative visible copy and unresolved production values.
3. `design/Weyne Representacoes.dc.html` — authoritative interactive design reference.
4. `design/Mobile Preview.dc.html` — phone behavior at 360, 390, and 430 CSS-pixel widths.
5. `DESIGN_SPEC.md` — exact visual tokens, section anatomy, responsive behavior, motion, and accessibility expectations.
6. `ARCHITECTURE.md` — required technology choices and system boundaries.
7. `IMPLEMENTATION.md` — TanStack-specific recipes, build sequence, component guidance, tests, and QA.
8. `screenshots/README.md` and `screenshots/*` — supporting settled-state references only.

Open the interactive prototype in a browser. Inspect all sections, responsive states, hover/focus/touch states, reveal behavior, mobile navigation, form behavior, and fixed controls before implementing them.

### Source-of-truth precedence

When inputs disagree, apply this exact order:

1. Visible copy: `content/landing-page.md`.
2. Visual values and interaction behavior: `design/Weyne Representacoes.dc.html`.
3. Architecture and dependency choices: `ARCHITECTURE.md` and `IMPLEMENTATION.md`.
4. Screenshots: supporting comparison only, never the source for exact desktop measurements.
5. Missing business data: do not infer or invent it.

The prototype's proprietary runtime, inline CSS, and hand-written JavaScript are reference material. Recreate the behavior with the target stack; do not port the prototype implementation.

## Required architecture

Use:

- TanStack Start with React and TypeScript;
- TanStack Router file-based routing supplied by Start;
- Vite using the generated and documented Start plugin setup;
- Bun for dependency management and scripts;
- Tailwind CSS v4 through `@tailwindcss/vite` and CSS-first tokens;
- `class-variance-authority`, `clsx`, and `tailwind-merge` through a shared `cn()` helper;
- shadcn/ui source components only where they provide useful accessibility or behavior;
- TanStack Form and Zod for the contact form;
- Motion for reveal/count-up/decorative motion, with reduced-motion support;
- `@phosphor-icons/react`, normally with `weight="light"`;
- self-hosted variable Newsreader and Jost fonts through Fontsource;
- Vitest for focused contract tests;
- Playwright for browser behavior and screenshot evidence.

Pin exact TanStack Start-related versions and commit `bun.lock`. Preserve the generated framework setup and adapt examples to the installed version rather than copying stale configuration blindly.

### Rendering model

- Prerender `/` during the production build.
- The full page copy, semantic structure, final stat values, contact context, and navigation must be present in initial HTML.
- Animation may enhance existing content after hydration; it must not create essential content.
- Keep route metadata in the route `head` configuration.
- Keep the root HTML document, global stylesheet, language, viewport, theme color, and scripts in `src/routes/__root.tsx`.
- Do not create artificial application routes for in-page anchors.

### Dependencies and infrastructure that are out of scope

Do not add any of the following in the first release:

- TanStack Query;
- TanStack Store, Zustand, Redux, or another global store;
- a database or ORM;
- authentication;
- a CMS;
- server-side lead storage;
- a CRM integration;
- a Hono sidecar or separate API service;
- React Server Components;
- a monorepo or shared component package;
- internationalization infrastructure;
- dark mode;
- PWA/offline behavior;
- speculative analytics or a consent platform;
- generic design-system extraction beyond the components this page uses.

Add TanStack Query only in a later feature that has real remote server state requiring cache ownership, invalidation, refetching, or sharing across routes. Add a global store only after local state and URL state are demonstrably insufficient.

## Required project boundaries

Use this structure as the target shape, adapting only where the current TanStack CLI generates a materially different convention:

```text
src/
  routes/
    __root.tsx
    index.tsx
  features/
    landing/
      landing-page.tsx
      content.ts
      schema.ts
      whatsapp.ts
      components/
        site-header.tsx
        hero-section.tsx
        stats-band.tsx
        about-section.tsx
        differentiators-section.tsx
        brands-section.tsx
        segments-section.tsx
        contact-section.tsx
        site-footer.tsx
        floating-actions.tsx
  components/
    ui/
    site/
  lib/
    cn.ts
    env.ts
  styles/
    app.css
scripts/
  check-content.ts
tests/
  unit/
  e2e/
public/
  images/
    brands/
```

Boundary rules:

- `routes/index.tsx` owns route metadata and composes one page feature; it does not contain section markup.
- The landing feature may import shared UI primitives and shared utilities.
- Shared primitives must not import from the landing feature.
- Keep section-specific layout and decorative code in the section that owns it.
- Extract a shared component only after at least two real call sites or when a primitive has a distinct reusable contract.
- Do not make every section a CVA variant or a generic schema-driven renderer.
- Use arrays for repeated content such as stats, differentiators, brands, and segments.
- Keep launch-specific values and copy typed and centralized.

## Content and launch configuration

Create a typed content/config module that the UI consumes. At minimum it must centralize:

- page and organization name;
- all visible copy;
- navigation labels and anchor targets;
- 4 stats;
- 6 differentiators;
- 8 represented brands;
- 7 segments;
- founder attribution;
- WhatsApp number and display value;
- public phone and email;
- CNPJ;
- social links;
- canonical URL and Open Graph image;
- SEO title, description, and any approved LocalBusiness structured data.

Preserve the exact pt-BR copy from `content/landing-page.md`. Do not silently rewrite marketing language, normalize punctuation, rename brands, change capitalization, or translate text.

Implement a production-readiness validation script that fails a production build when required values remain missing or contain known placeholders such as `PREENCHER`, example domains, dummy telephone numbers, or empty canonical metadata. Development may render clearly marked non-clickable placeholders when needed, but the production build must not pass with invented contact data.

The validation must also check:

- exact required list counts;
- unique item keys;
- unique section IDs;
- every navigation anchor maps to a real section;
- required brand asset paths exist;
- required production URLs use an allowed protocol;
- the WhatsApp number normalizes to a usable international numeric value.

## Visual implementation

Reproduce the approved design, not a loose interpretation. Use the exact values from the prototype and `DESIGN_SPEC.md` for:

- colors and gradients;
- typography and italic usage;
- clamp-based type sizes;
- line heights and tracking;
- container widths;
- section spacing;
- grids and breakpoints;
- hairlines, radii, shadows, opacity, and overlays;
- photo crops and responsive source switching;
- decorative curves, outlines, monograms, and wave dividers;
- fixed header behavior;
- floating WhatsApp and back-to-top actions;
- reveal sequences, count-up behavior, and hover/focus/touch states.

Do not compensate for a wrong parent container by applying many one-off offsets to children. Fix layout at the owning level.

### Tailwind and token rules

- Define brand tokens in `src/styles/app.css` using Tailwind v4 CSS-first configuration.
- Keep the exact brand palette: navy `#012C4B`, blue `#034F83`, baltic `#069CFF`, sand `#EECAA0`, paper `#F6F3EC`, ink `#12314C`, muted `#5C7286`.
- Define Newsreader as the display family and Jost as the sans family.
- Keep the house easing, repeated shadows, repeated gradients, and motion keyframes as named tokens or reusable utilities.
- Use arbitrary values when they represent a real one-off value from the approved prototype. Do not round exact handoff values to a nearby default Tailwind token merely for aesthetic consistency.
- Do not introduce a `tailwind.config.js` unless the installed version or a verified plugin requires it.
- Do not use inline style objects for static styling that belongs in Tailwind/CSS.

### CVA rules

Use CVA only for components with a real public variant API. Appropriate initial examples include:

- `Button`: primary, secondary/outline, sand/contact, and icon-only variants as actually required;
- optional small badge or icon-tile primitives when they have repeated states;
- shared navigation action styling when used in more than one context.

CVA variants must remain semantic. Do not create variants named after page sections or pixel values such as `heroBlue`, `contact37`, or `desktopOnlyLarge`.

Use Tailwind utilities directly for one-off section composition.

### shadcn/ui rules

Retain the accessible behavior of shadcn/Radix-derived components. Add only the primitives needed by the approved design, initially expected to be:

- `Button`;
- `Sheet` for mobile navigation;
- `Field`, `Input`, and `Textarea` for the form;
- `Sonner` only when a non-blocking user message is actually needed.

Restyle source components to the design tokens without weakening keyboard behavior, focus management, labels, descriptions, error association, or Escape handling.

## Page anatomy and required behavior

Implement all approved sections in this order:

1. fixed site header;
2. hero;
3. overlapping stats band;
4. about/founder section;
5. differentiators;
6. represented brands;
7. segments band;
8. contact section and WhatsApp form;
9. footer;
10. floating WhatsApp and back-to-top actions.

### Header and navigation

- Keep the fixed header and the prototype's transparent-to-solid behavior.
- Desktop navigation appears at the approved breakpoint; below it, use the shadcn `Sheet` mobile menu.
- Anchor links must remain real `<a href="#…">` links.
- Account for the fixed header using `scroll-padding-top` and/or section `scroll-margin`.
- The mobile sheet must trap focus, close on Escape, close after a navigation selection, and restore focus to the trigger.
- Mark the current/active context only when there is a reliable behavior to support it; do not add a fragile scroll-spy solely for decoration.

### Hero and media

- Use semantic heading and supporting copy in initial HTML.
- Use `<picture>` for the approved desktop/mobile Carolina image crop switch below 640px.
- Generate and use AVIF/WebP versions with PNG fallback.
- Set explicit dimensions or aspect ratio to prevent layout shift.
- Give the actual LCP image high fetch priority and do not lazy-load it.
- Decorative marks are hidden from assistive technology.
- Keep CTA order and labels exactly as approved.

### Stats

- Render the final numeric values in initial HTML.
- Count-up animation is a progressive enhancement and must settle on the exact displayed values.
- Run it once when the band becomes visible unless reduced motion is enabled.
- Under reduced motion, show final values immediately.

### Repeated cards

- Render differentiators, brands, and segments from typed arrays.
- Preserve the expected counts and order.
- Brand detail overlays must not be hover-only. Provide keyboard and touch access with a clear open/close state while retaining desktop hover behavior.
- Use real buttons for state changes and links only for navigation.
- Do not stretch supplied logos beyond their designed resolution.

### Contact form and WhatsApp conversion

Use TanStack Form with a Zod schema. At minimum:

- `name` is required, trimmed, and length-limited;
- company and message follow the approved optional/required status and maximum lengths;
- labels remain visible;
- errors are connected to fields and announced accessibly;
- submit does not post to a fake API.

Create a pure `buildWhatsAppUrl()` utility that:

- strips public number formatting;
- verifies a non-empty usable number;
- builds the approved pt-BR message from validated fields;
- preserves accents and line breaks through correct URL encoding;
- returns the final `https://wa.me/...` URL.

On valid submit, open/navigate to the generated WhatsApp URL using a user-initiated flow that avoids popup blocking. Make the fallback behavior understandable if navigation is unavailable.

Do not persist lead data in this release. Structure validation and the submission adapter so a future TanStack Start server function can reuse the same schema before CRM/storage work.

## Motion and progressive enhancement

Use Motion where it simplifies observable behavior, but preserve a meaningful page without JavaScript.

Rules:

- Content must remain visible if hydration or animation fails.
- Use the house easing and approved timing/stagger values.
- Avoid broad `transition-all` declarations.
- Prefer opacity and transform animation.
- Do not animate layout properties unnecessarily.
- Respect `prefers-reduced-motion` in CSS and JavaScript.
- Under reduced motion, remove decorative float, parallax, ring pulses, reveal travel, and count-up transitions while keeping all final content and states.
- Parallax is optional and must be the final enhancement after fidelity, accessibility, and performance pass.

## Accessibility requirements

Target WCAG 2.2 AA for authored UI.

Required behavior includes:

- one logical H1;
- semantic header, nav, main, section, and footer landmarks;
- correctly nested headings;
- a keyboard-operable skip link;
- visible focus states using the brand focus color;
- no keyboard traps outside the intentional managed modal/sheet context;
- minimum practical touch targets;
- meaningful image alt text and empty alt/`aria-hidden` for decorative art;
- labels, descriptions, and errors associated with form controls;
- screen-reader names for icon-only controls;
- menu, brand overlays, form, back-to-top control, and WhatsApp action usable by keyboard;
- content visible and usable at 200% zoom and narrow reflow;
- color contrast checked against actual gradients and overlay states;
- reduced-motion behavior manually verified.

Automated axe checks may supplement but do not replace manual keyboard, touch, screen-reader-semantic, focus, and zoom review.

## SEO and document requirements

Use TanStack route `head` configuration rather than manually mutating `document.head`.

The final implementation must support:

- `lang="pt-BR"` on the root document;
- route title and meta description from typed content;
- canonical URL after the client supplies the production origin;
- Open Graph and Twitter card metadata;
- approved local-business JSON-LD only when all required factual fields are confirmed;
- favicon and web manifest when supplied/approved;
- `robots.txt` and `sitemap.xml` appropriate to the final deployment;
- server-rendered/prerendered title, description, headings, and body copy.

Do not publish guessed business attributes in metadata or structured data.

## Performance requirements

Treat these as release gates:

- mobile Lighthouse: Performance at least 90;
- Accessibility at least 95;
- Best Practices at least 95;
- SEO at least 95;
- no avoidable image/font layout shift;
- no third-party font requests;
- no blocking analytics in the first release;
- explicit dimensions/aspect ratios for meaningful media;
- optimized AVIF/WebP hero media with PNG fallback;
- below-fold images lazy-loaded where appropriate;
- no production Router devtools;
- no unnecessary client-only boundary around the entire page;
- no obvious horizontal overflow at canonical widths;
- deployment compression and immutable caching for hashed assets.

Keep performance work evidence-based. Do not damage design fidelity by blindly lowering image quality or removing approved effects before measuring them.

## Tests and validation

Implement focused tests that protect contracts rather than implementation details.

### Unit tests

At minimum cover:

- WhatsApp number normalization;
- exact message construction and URL encoding, including accents and line breaks;
- empty/invalid number rejection;
- contact schema trimming, required name, and maximum lengths;
- production placeholder rejection;
- exact required list counts;
- unique IDs and keys;
- navigation-anchor integrity;
- required brand asset existence.

### Playwright smoke tests

At minimum verify:

1. `/` returns successfully and the H1 is present in the initial HTML.
2. Desktop anchor navigation reaches the correct sections.
3. The mobile menu opens, traps focus, closes with Escape, closes on selection, and restores focus.
4. Brand descriptions are available with keyboard and touch emulation.
5. The form exposes accessible errors for invalid input.
6. A valid submission attempts the exact composed `wa.me` URL.
7. No horizontal overflow exists at 1440, 1024, 768, 430, 390, and 360 CSS-pixel widths.
8. Basic axe scans report no serious or critical violations on the settled page and open mobile menu.

Do not assert Tailwind class strings or animation-frame internals.

### Required commands

Provide working scripts for:

```sh
bun run dev
bun run typecheck
bun run lint
bun run test
bun run test:e2e
bun run build
bun run preview
bun run check
```

`bun run check` must run content validation, typecheck, lint, unit tests, and production build exactly once each. Avoid recursive `build`/`check` definitions.

## Visual QA matrix

Compare implementation and interactive prototype at these canonical viewport sizes:

- 1440 × 1000;
- 1024 × 900;
- 768 × 1024;
- 430 × 932;
- 390 × 844;
- 360 × 800.

At each applicable width capture and review:

- hero top;
- hero/stats transition;
- about/founder section;
- differentiators;
- brands in rest state and one revealed state;
- segments;
- contact;
- footer;
- mobile menu open state.

Review in this order:

1. content and section structure;
2. containers, grid, and vertical rhythm;
3. typography and line wrapping;
4. colors, gradients, radii, shadows, and overlays;
5. responsive changes;
6. hover, focus, touch, and error states;
7. motion timing and reduced motion;
8. measured performance.

Record every intentional deviation from the prototype with its reason and approval. Unrecorded deviation is a defect.

## Implementation sequence

Work in reviewable phases and keep the application buildable after each phase.

### Phase 0 — audit and lock

- Inspect every handoff file and interactive state.
- Produce an internal implementation checklist and unresolved-input register.
- Confirm the installed TanStack Start, Router, Tailwind, shadcn, Form, Motion, and test package versions.
- Record any current-doc differences from sample snippets before coding around them.

### Phase 1 — foundation

- Scaffold TanStack Start with Bun.
- Configure Tailwind v4, fonts, tokens, shadcn primitives, path aliases, linting, Vitest, and Playwright.
- Implement root document and route head.
- Enable prerendering for `/`.
- Import/optimize assets.
- Implement typed content and production-readiness validation.

### Phase 2 — static responsive page

- Build all sections with final content and responsive structure.
- Match typography, spacing, media crops, gradients, decorative art, and section transitions.
- Keep anchor navigation and basic form markup usable before enhanced interaction work.

### Phase 3 — interaction and motion

- Implement mobile sheet, header behavior, brand reveal states, form validation and WhatsApp URL generation, floating controls, reveal/count-up behavior, and reduced-motion paths.
- Verify all interaction methods: mouse, keyboard, and touch.

### Phase 4 — hardening

- Add unit and browser tests.
- Run canonical screenshot comparison.
- Fix accessibility, responsive overflow, hydration, console, and performance issues.
- Verify initial HTML and prerender output directly.

### Phase 5 — release handoff

- Replace all approved launch placeholders.
- Run the full quality gate on the deploy preview.
- Supply evidence, exact versions, deployment/rollback notes, and the unresolved-input/deviation log.

## Required final handback

Return a concise completion report containing:

- architecture summary and any deviations from this prompt;
- exact package versions and hosting adapter/runtime;
- local run, test, build, and preview commands;
- final route and folder map;
- optimized/generated asset list;
- unit and Playwright results;
- canonical viewport screenshot links or artifact locations;
- Lighthouse scores and tested deploy-preview URL;
- manual accessibility checks performed;
- confirmation that `/` is prerendered and essential content exists in initial HTML;
- unresolved client inputs;
- approved visual deviations;
- where to update all contact/SEO values in one place;
- deployment and one-action rollback instructions.

Do not claim completion when production placeholders remain, the build lacks prerendered page content, an approved interaction is missing, or validation/tests have not run.

## Definition of done

The implementation is complete only when all of the following are true:

- the approved prototype is reproduced at the canonical viewports;
- all authoritative pt-BR copy is present and correctly ordered;
- the page is meaningful in initial prerendered HTML;
- every navigation, menu, brand reveal, form, floating action, and motion path behaves as specified;
- keyboard, touch, focus, zoom/reflow, and reduced-motion behavior pass manual review;
- no unapproved contact, social, SEO, or legal placeholder is published;
- content validation, typecheck, lint, unit tests, production build, and Playwright release tests pass;
- Lighthouse and accessibility gates pass on the deploy preview;
- all deviations and unresolved items are documented;
- the final repository can accept a second route or a future Start server function without reorganizing the landing-page feature.
