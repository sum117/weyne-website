# Accessibility and keyboard QA record

Last reviewed: 2026-08-17 12:02 (UTC-03:00)

## Reproduce the automated review

1. Install dependencies with `bun install --frozen-lockfile`.
2. Build the production client and SSR runtime with `bun run build`.
3. Run the accessibility and critical keyboard flows in the two required engines:
   `bunx playwright test tests/e2e/accessibility.spec.ts --project=chromium --project=firefox`.
4. Run the existing landing critical flows in the same engines:
   `bunx playwright test tests/e2e/landing.spec.ts --project=chromium --project=firefox`.

The accessibility suite blocks external requests, requests reduced motion, uses only local production assets, and reports every serious or critical axe target without disabling rules. The production runtime receives a local, non-secret placeholder database URL; reviewed routes do not connect to PostgreSQL.

## Manual keyboard procedure

Run `bun run build`, start the production runtime on a local port, and use a clean Chromium profile. Do not use the pointer during each scenario. At every stop, verify that focus is visibly distinguishable before continuing.

| Route and viewport | Keyboard sequence | Expected result | 2026-08-17 result |
| --- | --- | --- | --- |
| `/` at 390 × 844 | Focus **Menu**, press Enter, cycle with Tab, press Escape | Focus enters at **Sobre**, remains among the five sheet links, and returns to **Menu** after Escape | Pass: all eight sampled Tab stops remained in the dialog, every stop had visible focus, and focus returned to the trigger |
| `/#contato` at 1440 × 900 | Focus **Enviar pelo WhatsApp**, press Enter with empty fields | No external page opens; the first error is announced and associated with the invalid field; submit focus remains visible | Pass: `Informe seu nome` rendered as an alert; `Nome` exposed `aria-invalid=true` and `aria-describedby=nome-error` |
| `/app/produtos` at 1440 × 900 | Start at **Buscar por identificador**, then press Tab through the toolbar | Order is identifier, name, indústria, categoria, marca, situação; disabled **Limpar filtros** is skipped | Pass: order matched, every enabled control showed visible focus, and the disabled action was skipped |
| `/app/relatorios` at 1440 × 900 | Focus **Vendas por produto**, press Enter | The tab becomes selected, focus remains visible, URL state changes to `tab=produtos`, and the product report empty state appears | Pass: `aria-selected=true`, URL state persisted, and `Nenhum resultado` remained visible |

The forward mobile-sheet cycle wrapped from its final CTA back to **Sobre**, demonstrating containment. The reviewed button and Radix tab activated with Enter; no custom keyboard shortcut is required.

## Automated route/state matrix

| Surface | Coverage |
| --- | --- |
| Public landing | Base page, hydrated content, form validation error, mobile sheet open state, focus containment/restoration, serious/critical axe scan |
| Management foundation | `/app` SSR response and serious/critical axe scan |
| Product catalog | `/app/produtos` filters plus empty/status state and serious/critical axe scan |
| Reports/table | `/app/relatorios` table empty state, keyboard tab switch with URL persistence, and serious/critical axe scan |
| Loading and recoverable error | Shared table/catalog behavior is covered by focused component tests; no production route currently exposes deterministic loading/error fixture switches |
| Charts | No chart composition is mounted by a current route; the reports route currently renders the canonical table fallback only |
| File interactions | Attachment policy/storage code exists, but no current route mounts a file input or upload interaction |
| Destructive dialog | Shared Radix alert-dialog and catalog dialog components exist, but the current read-only empty product route cannot open a destructive action |

The unmounted surfaces above are intentionally not represented by invented test-only production routes or broad axe exclusions. Add route-level Playwright scenarios when their real routes and deterministic fixtures land.

## Findings and fixes

- Axe caught serious color-contrast regressions in the decorative differentiator numbers and footer developer credit. Both now use contrast-safe project colors; no rule was suppressed.
- The mobile menu used a controlled Radix sheet without a Radix trigger, so Escape could not restore focus. It now uses `SheetTrigger`, explicitly focuses the first link on open, traps focus, and restores the trigger on close.
- No serious or critical axe exceptions are configured. Third-party Radix and Recharts output receives no blanket exclusion.
