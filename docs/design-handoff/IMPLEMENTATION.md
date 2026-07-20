# Implementation guide — TanStack Start landing page

This guide describes how to recreate the Weyne Representações prototype in the architecture defined by `ARCHITECTURE.md`. It does not replace `DESIGN_SPEC.md`; use that file and the interactive design for exact visual values.

## 0. Non-negotiable implementation rules

- Recreate the design; do not redesign it into a generic shadcn page.
- Do not copy `design/support.js`, prototype inline styles as a block, or prototype JavaScript.
- Keep the `/` route thin. Route files own routing and metadata, not section markup.
- Use native anchor links for sections; do not create fake routes for `#sobre`, `#marcas`, and similar anchors.
- Use CVA for real reusable variants only.
- Keep all business copy and client-provided values centralized and typed.
- Never invent launch contact data.
- Do not add TanStack Query, a global store, a server function, an API route, or a database in the first release.
- Preserve server-rendered content. Essential copy and final stat values must exist in HTML before hydration.
- Every interactive hover state must have a keyboard and touch equivalent where relevant.
- Run the full check suite after each implementation phase, not only at the end.

## 1. Scaffold the project

Use the official TanStack CLI path and choose TanStack Start, React, TypeScript, Vite, Tailwind CSS, and Bun. Do not select Query, auth, database, or example application add-ons.

```sh
bunx @tanstack/cli@latest create
cd <generated-project>
```

Initialize shadcn/ui in the existing Start project and add only the primitives used by the design:

```sh
bunx shadcn@latest init
bunx shadcn@latest add button sheet field input textarea sonner
```

Add the remaining runtime dependencies:

```sh
bun add class-variance-authority clsx tailwind-merge
bun add motion @phosphor-icons/react
bun add @fontsource-variable/newsreader @fontsource-variable/jost
bun add @tanstack/react-form zod
```

Add focused test dependencies:

```sh
bun add -d vitest jsdom @testing-library/react @testing-library/jest-dom
bun add -d @playwright/test @axe-core/playwright
```

While TanStack Start remains RC, use exact package versions for Start-related packages and commit `bun.lock`. Do not casually upgrade framework packages during visual implementation.

## 2. Configure Vite, Tailwind, and prerendering

The exact generated config may evolve. Preserve the generated Start setup and add Tailwind/prerendering in the order documented by the installed version.

Expected shape:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: true,
        failOnError: true,
      },
    }),
    viteReact(),
    tailwindcss(),
  ],
})
```

When a hosting adapter adds a Vite plugin, follow that adapter's official ordering. Do not spread hosting imports into feature code.

## 3. Import and optimize assets

Copy `design/assets/*` to `public/images/` while preserving the `brands/` directory. The prototype directory is not a runtime dependency.

Required asset work:

1. Generate AVIF and WebP variants for `carolina-desk.png` and `carolina-desk-mobile.png`.
2. Keep the PNG files as fallbacks.
3. Keep transparent logos and monograms as PNG unless a verified conversion preserves quality and transparency.
4. Record original dimensions and render explicit `width`/`height` or `aspect-ratio` values.
5. Use meaningful alt text only for meaningful images. Decorative outlines, curves, and monograms use empty alt text or `aria-hidden="true"`.
6. Keep original source assets in version control; optimized derivatives are production assets.
7. Do not upscale the represented-brand logos. Re-extract from `content/represented-brands.pdf` only when a supplied logo is visibly insufficient at its designed size.

Hero media must use `<picture>` with the mobile source selected below 640px. The desktop/mobile crop switch is a design requirement, not an optimization guess.

## 4. Establish the document shell

Use the root route for the actual HTML document and global stylesheet link. With the Vite integration, import the stylesheet using `?url` as documented by TanStack Start.

```tsx
// src/routes/__root.tsx
/// <reference types="vite/client" />

import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import appCss from '@/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#012C4B' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico' },
      { rel: 'manifest', href: '/site.webmanifest' },
    ],
  }),
  component: RootDocument,
})

function RootDocument() {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Toaster position="bottom-right" />
        <Scripts />
      </body>
    </html>
  )
}
```

Keep development tools development-only. Do not ship Router devtools in the production bundle.

## 5. Define route metadata in `index.tsx`

The home route should contain metadata plus one page component import.

```tsx
// src/routes/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { LandingPage } from '@/features/landing/landing-page'
import { siteConfig } from '@/features/landing/content'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: siteConfig.seo.title },
      { name: 'description', content: siteConfig.seo.description },
      { property: 'og:type', content: 'website' },
      { property: 'og:locale', content: 'pt_BR' },
      { property: 'og:title', content: siteConfig.seo.title },
      { property: 'og:description', content: siteConfig.seo.description },
      { property: 'og:image', content: siteConfig.seo.ogImageAbsoluteUrl },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: siteConfig.seo.title },
      { name: 'twitter:description', content: siteConfig.seo.description },
      { name: 'twitter:image', content: siteConfig.seo.ogImageAbsoluteUrl },
    ],
    links: siteConfig.seo.canonicalUrl
      ? [{ rel: 'canonical', href: siteConfig.seo.canonicalUrl }]
      : [],
    scripts: siteConfig.seo.localBusinessJsonLd
      ? [
          {
            type: 'application/ld+json',
            children: JSON.stringify(siteConfig.seo.localBusinessJsonLd),
          },
        ]
      : [],
  }),
  component: LandingPage,
})
```

Do not emit guessed canonical, OG, social, or structured-data values. The production content check must reject missing required metadata.

## 6. Build the token layer

Create `src/styles/app.css`. Tailwind v4 uses CSS-first configuration.

```css
@import 'tailwindcss' source('../');
@import '@fontsource-variable/jost';
@import '@fontsource-variable/newsreader';
/* Import the installed Newsreader variable italic export documented by Fontsource. */

@theme {
  --font-sans: 'Jost Variable', system-ui, sans-serif;
  --font-display: 'Newsreader Variable', ui-serif, Georgia, serif;

  --color-navy: #012c4b;
  --color-blue: #034f83;
  --color-baltic: #069cff;
  --color-sand: #eecaa0;
  --color-paper: #f6f3ec;
  --color-ink: #12314c;
  --color-muted: #5c7286;
  --color-line: rgb(3 79 131 / 0.13);

  --ease-house: cubic-bezier(0.16, 0.8, 0.24, 1);
  --shadow-band: 0 40px 80px -46px rgb(3 79 131 / 0.4);
  --shadow-card-hover: 0 44px 74px -38px rgb(3 79 131 / 0.45);
  --shadow-form: 0 50px 100px -50px rgb(1 44 75 / 0.9);

  --animate-float: float 7.5s ease-in-out infinite;
  --animate-pulse-ring: pulse-ring 2.6s ease-out infinite;

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-9px); }
  }

  @keyframes pulse-ring {
    0% { transform: scale(1); opacity: 0.5; }
    70% { transform: scale(1.85); opacity: 0; }
    100% { opacity: 0; }
  }
}

:root {
  --background: var(--color-paper);
  --foreground: var(--color-ink);
  --card: #fff;
  --card-foreground: var(--color-ink);
  --primary: var(--color-blue);
  --primary-foreground: #fff;
  --secondary: var(--color-sand);
  --secondary-foreground: #3a2a12;
  --muted-foreground: var(--color-muted);
  --border: var(--color-line);
  --input: var(--color-line);
  --ring: var(--color-baltic);
  --radius: 0.75rem;
}

html {
  scroll-behavior: smooth;
  scroll-padding-top: 96px;
  background: var(--color-paper);
}

body {
  margin: 0;
  background: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

::selection {
  background: var(--color-sand);
  color: var(--color-navy);
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Copy all remaining exact type scales, gradients, shadows, radii, spacing, and decorative SVG values from `DESIGN_SPEC.md` and the prototype. Avoid creating approximate default tokens that override exact handoff values.

## 7. Centralize content and launch configuration

Create one typed content module. Keep design copy separate from launch-specific business values when that improves validation, but export one stable shape to the UI.

Minimum contracts:

```ts
export type SiteContact = {
  whatsappNumber: string
  phoneDisplay: string
  email: string
  cnpj: string
  instagramUrl?: string
  linkedinUrl?: string
}

export type LandingPageContent = {
  siteName: string
  nav: ReadonlyArray<{ label: string; href: `#${string}` }>
  stats: ReadonlyArray<Stat>
  differentiators: ReadonlyArray<Differentiator>
  brands: ReadonlyArray<Brand>
  segments: ReadonlyArray<Segment>
  contact: SiteContact
  seo: SeoConfig
  // hero, about, footer, and other copy groups
}
```

The implementation must preserve:

- exactly 4 stats;
- exactly 6 differentiators;
- exactly 8 represented brands;
- exactly 7 segments;
- anchor IDs `topo`, `sobre`, `diferenciais`, `marcas`, `segmentos`, and `contato`;
- all pt-BR copy from `content/landing-page.md`.

Use explicit component references for icons and render them consistently with `weight="light"`.

### Production readiness validation

Create a Zod schema or dedicated script that fails when:

- WhatsApp does not contain a plausible digits-only international number;
- a phone/email/CNPJ still matches the supplied placeholder;
- any required value contains `[PREENCHER]`;
- canonical URL or absolute OG image URL is absent for a production release;
- duplicate section IDs or duplicate brand keys exist.

The check must be part of `bun run check` and the deployment build command.

## 8. Tune shadcn primitives and CVA

Keep shadcn source components under `src/components/ui/`. Adjust them to match the brand rather than layering inconsistent per-call overrides everywhere.

### Button variants

Retain the accessible base and `asChild` behavior. Add only the variants required by the design:

```ts
primary:
  'rounded-full bg-blue text-white shadow-[0_12px_26px_-14px_rgb(3_79_131/.75)] transition duration-300 hover:-translate-y-px hover:bg-baltic',
inverse:
  'rounded-full bg-white text-navy shadow-[0_20px_40px_-18px_rgb(0_0_0/.5)] transition duration-300 hover:-translate-y-0.5 hover:bg-sand',
sand:
  'rounded-xl bg-sand text-[#3a2a12] transition duration-300 hover:-translate-y-0.5 hover:bg-white',
ghostOnDark:
  'rounded-full bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/15',
```

Sizes:

```ts
pill: 'h-11 gap-2 px-5 text-sm font-semibold',
pillLg: 'h-[54px] gap-3 px-7 text-[15.5px] font-semibold',
icon: 'size-11 rounded-full',
```

Every variant must include a visible focus state. Do not rely on hover alone.

### Sheet

Use shadcn `Sheet` for the mobile menu. Style the content as the floating white rounded panel shown in the prototype while preserving:

- focus trap;
- Escape close;
- body scroll lock;
- close button name;
- close on nav selection;
- correct initial focus.

Do not rebuild these behaviors manually.

### Fields

Use shadcn `Field`, `FieldLabel`, and `FieldError` with TanStack Form. The form controls must set `aria-invalid` and keep errors linked to fields.

## 9. Compose the page

`LandingPage` owns composition only:

```tsx
export function LandingPage() {
  return (
    <>
      <a className="sr-only focus:not-sr-only" href="#conteudo">
        Ir para o conteúdo
      </a>
      <SiteHeader />
      <main id="conteudo">
        <HeroSection />
        <StatsSection />
        <AboutSection />
        <DifferentiatorsSection />
        <BrandsSection />
        <SegmentsSection />
        <ContactSection />
      </main>
      <SiteFooter />
      <FloatingActions />
    </>
  )
}
```

Do not create a page-wide context merely to pass static content. Import the typed content module or pass narrow props where doing so improves testability.

## 10. Header and anchor behavior

- Keep one fixed header.
- Use Motion's `useScroll` / `useMotionValueEvent`, or a small passive scroll listener, for the `scrollY > 24` visual state.
- Use CSS media queries/arbitrary Tailwind variants for the 900px navigation breakpoint; do not add a resize listener.
- Monogram state is a cross-fade between two stacked images.
- Section links are native anchors.
- Use CSS `scroll-padding-top`; do not intercept clicks to calculate offsets.
- Update neither Router location nor search params for ordinary section scrolling.

The mobile sheet must match the supplied open-menu screenshot and remain usable at 320px width.

## 11. Section implementation notes

The exact anatomy is in `DESIGN_SPEC.md`. These are architecture-sensitive notes.

### Hero

- Use semantic H1 text in the initial HTML.
- Use `<picture>` for desktop/mobile Carolina assets.
- Set explicit media dimensions/aspect ratios to prevent CLS.
- Apply `fetchPriority="high"` to the chosen LCP image and lazy-load only below-fold assets.
- Keep decorative SVG curves inline, `aria-hidden`, and pointer-events disabled.
- Use CSS or Motion for the badge float; reduced motion disables it.
- Parallax is a final, optional enhancement. Ship fidelity and performance first.

### Stats

- The final number must be the server-rendered text.
- Count-up is progressive enhancement and may only mutate text after hydration/in-view.
- The static `+` prefix remains separate from the animated number.
- Ensure screen readers receive one coherent label per stat, not a sequence of disconnected glyphs.

### About and differentiators

- Use semantic blockquote markup for the quote.
- Decorative numbering is `aria-hidden`.
- Card hover effects receive matching `focus-within` or focus-visible behavior.

### Brands

- Render each interactive card as a semantic button when tapping toggles details.
- Desktop fine-pointer hover and keyboard focus reveal the overlay.
- Touch tap toggles `aria-expanded`.
- Do not make a nested link inside a button. When future brand detail URLs exist, change the interaction model deliberately.
- Do not use grayscale as the only communicated state; the overlay includes text.

### Segments

- Keep wave dividers as reusable SVG components with exact paths.
- Ensure decorative watermarks do not create horizontal overflow.
- Tiles may remain non-interactive unless the design or product gives them a destination.

### Contact

- Phone and email are links only after confirmed values exist.
- Long email text must wrap without horizontal overflow.
- The form is a client interaction but all labels, headings, and helper copy render on the server.

### Footer and floating actions

- Social buttons with missing URLs are removed, not rendered as dead links.
- Back-to-top is a real button with an accessible name.
- WhatsApp FAB is a link with a useful accessible name.
- Respect `env(safe-area-inset-bottom)` and `env(safe-area-inset-right)`.
- Hide the FAB while the contact section is substantially visible, as specified.

## 12. Motion as progressive enhancement

Create one house easing constant and one reveal abstraction, but do not let server-rendered markup arrive permanently hidden.

Requirements:

- no essential content is rendered with `opacity: 0` in the non-JavaScript HTML;
- reduced motion returns final, visible states;
- reveal motion runs once;
- count-up starts only when the stat band enters view;
- all infinite motion stops under reduced motion;
- animation code does not change document order or accessible names;
- avoid a separate observer per tiny element when one grouped reveal is sufficient.

A safe implementation can delay applying hidden reveal state until hydration, accepting that an already-visible element may not animate. No-JS visibility and hydration correctness are more important than animating every element.

## 13. Contact form with TanStack Form and Zod

Define the schema once:

```ts
// src/features/landing/lead.schema.ts
import { z } from 'zod'

export const leadSchema = z.object({
  nome: z.string().trim().min(2, 'Informe seu nome'),
  empresa: z.string().trim().max(120, 'Use até 120 caracteres').optional(),
  mensagem: z.string().trim().max(600, 'Use até 600 caracteres').optional(),
})

export type LeadInput = z.input<typeof leadSchema>
```

Keep WhatsApp construction pure and testable:

```ts
export function buildWhatsAppUrl(number: string, message: string): string {
  const digits = number.replace(/\D/g, '')
  if (!digits) throw new Error('WhatsApp number is not configured')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}
```

Use TanStack Form:

```tsx
const form = useForm({
  defaultValues: {
    nome: '',
    empresa: '',
    mensagem: '',
  },
  validators: {
    onSubmit: leadSchema,
  },
  onSubmit: ({ value }) => {
    const parsed = leadSchema.parse(value)
    const url = buildWhatsAppUrl(
      siteConfig.contact.whatsappNumber,
      buildLeadMessage(parsed),
    )

    window.open(url, '_blank', 'noopener,noreferrer')
    toast('Abrindo o WhatsApp…')
  },
})
```

Keep submission synchronous so browsers do not block the new tab. A future server call changes this interaction and must be designed/tested separately.

Every other WhatsApp CTA must use the same URL builder or a shared precomputed URL. There is one conversion contract, not several hand-written strings.

## 14. SEO and public files

Before release, provide:

- `robots.txt`;
- `sitemap.xml` with the confirmed canonical origin;
- favicon and touch icon derived from the approved monogram;
- `site.webmanifest` only when it contains accurate values;
- absolute Open Graph image URL;
- page title and description from the handoff;
- canonical link;
- JSON-LD only with confirmed legal/contact/business details.

Do not add generic keyword tags. Do not put metadata in a legacy static `index.html`; the route `head` API owns it.

## 15. Tests

### Unit tests

`whatsapp.test.ts`

- removes formatting from the public number;
- URL-encodes accents, spaces, punctuation, and line breaks;
- rejects an empty number;
- builds the exact default CTA message.

`lead-schema.test.ts`

- requires a valid name;
- allows optional company/message;
- enforces maximum lengths;
- trims values.

`content-integrity.test.ts`

- validates required counts;
- checks unique keys and section IDs;
- rejects placeholders in production mode;
- confirms every brand logo path exists in `public/images/brands`;
- confirms every nav anchor maps to an element ID.

### Playwright smoke tests

At minimum:

1. `/` returns a successful page and contains the H1 in initial HTML.
2. Desktop nav links move focus/scroll to the target section.
3. Mobile menu opens, traps focus, closes with Escape, and closes after selection.
4. Brand details can be revealed with keyboard and touch emulation.
5. Empty form shows the name error.
6. Valid form attempts to open the correctly composed `wa.me` URL.
7. No horizontal overflow at 1440, 1024, 768, 430, 390, and 360 widths.
8. A basic axe scan reports no serious/critical issues on the settled page and open menu.

Do not turn the suite into a brittle assertion of every utility class.

## 16. Visual QA

Compare against the interactive prototype at:

- 1440 × 1000;
- 1024 × 900;
- 768 × 1024;
- 430 × 932;
- 390 × 844;
- 360 × 800.

At each width capture:

- top of hero;
- hero/stats transition;
- about;
- differentiators;
- brands rest and one revealed card;
- segments;
- contact;
- footer;
- mobile menu where applicable.

Review order:

1. structure and content;
2. container widths and section spacing;
3. typography and line breaks;
4. color/gradient/shadow/radius;
5. responsive behavior;
6. hover/focus/touch states;
7. motion timing;
8. performance optimizations.

Do not compensate for an incorrect container by adding isolated pixel nudges to many children.

## 17. Scripts and CI

Recommended package scripts:

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "bun run check:content && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "check:content": "tsx scripts/check-content.ts",
    "check": "bun run check:content && bun run typecheck && bun run lint && bun run test && bun run build"
  }
}
```

Avoid recursive `check`/`build` script definitions: if `build` already invokes `check:content`, adjust the combined command accordingly. The final scripts must execute each gate once.

CI must archive or link:

- production build result;
- Playwright report;
- canonical viewport screenshots;
- Lighthouse report for the deploy preview.

## 18. Completion report expected from the implementer

The final implementation handoff must include:

- exact package versions and deployment adapter used;
- run/build/test commands;
- list of optimized/generated assets;
- screenshot evidence at canonical viewports;
- Lighthouse scores and tested URL;
- accessibility checks performed manually;
- unresolved client inputs;
- deviations from the prototype, each with reason and approval;
- instructions for changing contact information in one place;
- rollback/deployment notes.

