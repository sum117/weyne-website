# Visual regression matrix

The deterministic Playwright suite is the reviewable visual contract for implemented public and authenticated surfaces.

`docs/authenticated-app-screenshot-matrix.md` is the route-level target contract. The suite documented here is its currently executable subset: authenticated captures remain component fixtures until the corresponding route, shell, loader, permission projection, and URL-owned state exist. Do not treat fixture coverage as route completion.

## Commands

- `bun run test:visual:update` intentionally creates or replaces Chromium baselines.
- `bun run test:visual` compares the current render with the committed baselines.

The suite fixes locale (`pt-BR`), time zone (`America/Recife`), light color scheme, reduced motion, CSS pixel scale, device scale factor, browser engine, font readiness, animation/transition duration, and fixture data. It explicitly selects the landing reveal system's settled fallback state so off-viewport sections remain present in full-page captures; it does not mask elements or relax comparisons around changing layout. Run the comparison twice after updating baselines; both passes must succeed before accepting them.

## Canonical viewport matrix

| Surface | 1440 × 1000 desktop | 1024 × 900 tablet | 390 × 844 mobile |
| --- | --- | --- | --- |
| Public landing, full page | yes | yes | yes |
| Public mobile navigation sheet | — | — | yes |
| Product catalog/table/cards | yes | — | yes |
| Client archive dialog | — | yes | — |
| Quote detail/table-like line items | yes | — | — |
| Form, chart, and file controls | — | yes | yes |
| Loading, empty, and error states | yes | — | — |

`tests/visual/fixture.html` is a test-only Vite entry point. It imports production components and CSS but is not part of the TanStack route tree or production build.

## Specification review and accepted differences

The landing page has an approved pixel-level source: `docs/design-handoff/design/Weyne Representacoes.dc.html`, with supporting captures in `docs/design-handoff/screenshots/`. Its full-page baselines cover the specified desktop, tablet breakpoint behavior, and true 390 px mobile layout; the separate mobile-menu capture covers the approved sheet state.

No approved pixel-level prototype exists for authenticated screens. `docs/APP_UX_BENCHMARK.md` is explicitly directional and forbids copying third-party branding. Authenticated baselines therefore review the implemented component contracts against Weyne's shared tokens in `src/styles/app.css` and the required states in `docs/app-component-state-inventory.md`; they must not be described as pixel parity with a nonexistent target. This is an intentional, documented difference rather than a silently ignored mismatch.

Baseline changes are acceptable only when they match the approved landing handoff or an intentional authenticated-component change. Review image diffs before updating; never update snapshots merely to make a failure green.
