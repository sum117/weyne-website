# Authenticated app component and state inventory

This document is the implementation contract for the authenticated Weyne app design-system work. It derives from the app UX requirements in Kanban spec `t_1773b498`, the product brief (`project.pdf`), and the current repository. The public `/` landing page is explicitly out of redesign scope.

Normative words (`must`, `must not`) are requirements. Proposed token names and component boundaries below are stable inputs for the token and primitive implementation cards; workers should not introduce parallel names or another UI kit.

## Foundations that must remain

- Keep Tailwind CSS v4 CSS-first configuration in `src/styles/app.css`; there is no `tailwind.config.js`.
- Keep Jost (`font-sans`) for UI and Newsreader (`font-display`) for display headings. Do not add Arpona/Rossanova from the original brief: the shipped self-hosted fonts are the approved equivalents.
- Keep Phosphor icons from the SSR entry point with `weight="light"`. Icon-only controls must have an accessible name and at least a 44 by 44 px touch target.
- Keep `--ease-house: cubic-bezier(0.16, 0.8, 0.24, 1)`. State changes use it; no new easing family is needed.
- Keep the global `:focus-visible` treatment. Interactive primitives must also expose a token-backed, high-contrast focus ring; focus must never rely on color fill or hover alone.
- Keep the global `prefers-reduced-motion` reset. Loading indicators may remain perceptible but must not depend on motion to communicate state.
- Keep the named overlay scale in order: `z-header` 60, `z-fab` 70, `z-overlay` 80, `z-skip` 100. Portalled Sheet, AlertDialog, Select, DropdownMenu, Popover, Command and Tooltip surfaces must use the named scale, not raw competing z-index values.
- Keep the app light-only unless a separate approved requirement adds dark mode.

## Existing assets: reuse or extend

| Existing asset | Current contract | App action |
|---|---|---|
| Brand and shadcn variables | `app.css`: navy, blue, baltic, sand, paper, ink, muted, line; background/card/popover/primary/secondary/accent/destructive/border/input/ring | Extend the same `:root` and `@theme inline` bridges; do not replace them. |
| Typography, motion, shadows | `font-sans`, `font-display`, `ease-house`, named landing shadows, reduced-motion reset | Reuse. Add app shadows only when a listed surface needs one. |
| Overlay utilities | `z-header`, `z-fab`, `z-overlay`, `z-skip` | Reuse for app shell and every portalled primitive. |
| `Button` | `primary`, `inverse`, `sand`; pill-oriented sizes | Preserve those landing variants. Add app `secondary`, `outline`, `ghost`, `destructive`, and `icon` contracts rather than creating another button. |
| `Input`, `Textarea` | Default, placeholder, focus-visible, invalid and disabled styling | Reuse. Add size only if dense table filters need it; preserve native input semantics. |
| `Field` family | Label, description and live error structure, currently tuned for the dark contact form | Preserve current default or a `contact` tone and add an app `surface` tone with ink/muted/error semantics. Keep TanStack Form; do not add shadcn's React Hook Form wrapper. |
| `Sheet` | Radix Dialog behavior, four sides, overlay, focus management, Escape and close control | Reuse for mobile navigation and narrow-screen secondary panels. |
| `Toaster` | Sonner, light-only | Reuse for non-blocking success/error notices; replace hard-coded host colors with semantic tokens when tokens are added. |
| Landing compositions | Site header, CTA and contact form usage | Reference only. Do not restyle or turn landing sections into app primitives. |

The repository currently contains only `/` and `__root`; authenticated routes and app layout do not exist yet. The product brief requires Dashboard, Clientes, Indústrias, Produtos, Transportadoras, Orçamentos, Pedidos, Relatórios and Configurações. This inventory defines their shared UI without inventing business-state transitions.

## Required app components and variants

| Component/composition | Required variants and anatomy | Required states |
|---|---|---|
| App shell / Sidebar | shadcn `Sidebar`; expanded desktop rail, collapsible icon rail, active item, grouped nav, footer/account area. Use existing `Sheet` behavior on mobile. Top context bar contains mobile trigger, breadcrumb/context title and page actions. | Expanded/collapsed, current/selected, hover, focus-visible, disabled/unauthorized, mobile open/closed, skeleton while identity/permissions load. |
| Page header | Eyebrow/breadcrumb, Newsreader title, optional description, primary action, overflow actions. Actions wrap below copy on narrow screens. | Normal, action loading/disabled, long title and narrow viewport. |
| Button | Existing landing variants plus app `secondary`, `outline`, `ghost`, `destructive`, and `icon`; sizes `sm`, `default`, `lg`, `icon` in addition to retained landing sizes. | Rest, hover, active, focus-visible, disabled, loading (`aria-busy`, stable width), destructive. |
| KPI card | Card header, concise label, primary value, optional trend, comparison period and optional action. Values remain text in SSR/loading fallback. | Populated, loading skeleton, unavailable/error, selected/drill-down focus. No decorative chart without useful data. |
| Status tabs | Radix/shadcn Tabs; `all` plus domain statuses, optional count, horizontally scrollable on mobile. URL owns selected tab/filter. | Selected (`aria-selected`), unselected, hover, focus-visible, disabled, count-loading, overflow. |
| Status badge | `neutral`, `info`, `warning`, `success`, `destructive`; icon is optional and never the sole signal. | Default and compact; status semantics are fixed below. |
| Data toolbar | Search, faceted filters, active-filter chips, result count, clear-all, column visibility and export/primary action. Search/filter state belongs in URL query parameters. | Idle, typing/debounced, filtered, no matches, loading, error, disabled while mutation blocks refresh. |
| Data table | shadcn `Table` plus TanStack Table composition: sortable header, optional selection checkbox, primary cell link, status cell, numeric alignment, row actions and pagination. Sticky header is optional; horizontal overflow is mandatory rather than crushed columns. | Loading rows, populated, empty collection, empty filtered result, fetch error, selected row(s), hover, keyboard focus, disabled action, sorted ascending/descending, partial/all selection. |
| Pagination | Previous/next and page/total summary; page-size Select on dense lists. Use Button/Select rather than a second pagination library. | First/last disabled, current page, focus-visible, loading. |
| Form field | Existing Field + Input/Textarea, and shadcn Select/Checkbox/Switch as appropriate. Label, required marker, control, description, inline error. Two-column desktop groups collapse to one column. | Pristine, hover, focus-visible, filled, invalid, valid when confirmation is useful, disabled, read-only, async validating and submitting. Errors use `aria-invalid` and `aria-describedby`. |
| Combobox/facet picker | shadcn Popover + Command; searchable list, optional multi-select checkmarks and clear action. | Closed/open, query loading, no options, no matches, selected, active option, disabled, fetch error. Radix owns focus/keyboard behavior. |
| Detail summary | Card sections, definition lists, status badge, related records and audit/history list. Primary actions remain in page header. | Loading skeleton, populated, missing/not-found, fetch error, empty related section, restricted action. |
| Create/edit screen | Route-level form with page header; sticky action footer only when needed on long forms. Do not use a modal for a full entity form. | Create, edit loading, dirty, validation errors, submitting, success redirect/toast, server error, unsaved-change guard. |
| Alert / Empty state | Inline Alert for recoverable warning/error/success/info. Empty composition contains Phosphor icon, title, explanation and at most one primary plus one secondary action. | First-use empty, no search results, permission-limited, loading handoff, recoverable error. |
| Destructive confirmation | shadcn AlertDialog, explicit entity/action wording, cancel receives initial safe focus, destructive confirm supports loading. | Closed/open, focus trap, confirm loading/disabled, server error retained in dialog, success close/toast. Never use `window.confirm`. |
| Toast | Existing Sonner host; success, warning and error messages with concise next step. | Enter/visible/dismiss; reduced motion; no toast as the only record of a blocking error. |
| Chart | shadcn Chart wrapper over Recharts; line for time series, horizontal bar for ranked entities, stacked bar only for meaningful composition. Title, date range, legend, tooltip and textual summary/table fallback. | Loading skeleton, populated, empty period, fetch error, highlighted/selected series, keyboard-accessible summary. Never encode series by color alone. |

## State behavior contract

Every interactive app surface must implement the applicable states below. Omitting a state requires a component-level test proving it cannot occur.

| State | Required behavior |
|---|---|
| Hover / active | Subtle color, border or elevation change using house easing. Hover must not reveal the only available action. Active feedback may be instant; avoid layout movement in dense tables. |
| Focus-visible | Visible 2 px minimum token-backed ring/outline with 2 px separation where needed. Preserve logical tab order, Escape dismissal and arrow-key behavior supplied by Radix. |
| Selected/current | Use semantic fill or border plus text/weight and the relevant ARIA state (`aria-current`, `aria-selected`, checked state). Do not use color alone. |
| Disabled/read-only | Preserve legible text, remove pointer events only when truly disabled, expose native/Radix disabled semantics, and explain unavailable destructive actions when useful. Read-only values remain selectable. |
| Loading | Keep surrounding layout stable. Use Skeleton for first load, inline spinner/progress for a user-triggered mutation, and `aria-busy` on the affected region. Do not replace the whole app shell. |
| Empty | Distinguish an empty collection from zero search results. First-use empty offers creation; filtered empty offers clear filters; neither displays a blank table. |
| Error | Inline near the failed region with retry when recovery is possible. Form errors stay beside fields; destructive-dialog errors stay in the dialog; a toast may supplement but not replace them. |
| Success | Persist updated content/status, announce concise confirmation, and restore focus to the resulting heading, row or trigger as appropriate. |

## Fixed semantic status meanings

Domain labels may be refined by the domain model, but their visual meaning must use these buckets consistently:

| Semantic bucket | Use for | Must not mean |
|---|---|---|
| `neutral` | Draft, inactive, archived, unknown/not started | Failure or approval |
| `info` | Issued/sent, converted, in progress, informational | Success or warning |
| `warning` | Pending approval, expiring, attention required, open aging work | Destructive failure |
| `success` | Active, approved, completed, paid/fulfilled when domain rules confirm it | Mere progress |
| `destructive` | Rejected, canceled, failed, overdue with material risk, deletion | Routine pending work |

Status text and an icon/shape must accompany color in charts, badges and table cells.

## Proposed semantic token contract

Add these variables to the existing light `:root` and map each color through `@theme inline` as `--color-<name>`. Raw values below are implementation inputs, not a second palette.

| UX requirement | Proposed variables | Proposed value / existing source |
|---|---|---|
| App canvas/surfaces | `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground` | Existing paper/ink/white mappings |
| Sidebar | `--sidebar`, `--sidebar-foreground`, `--sidebar-muted-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring` | `#012c4b`, `#fff`, `#b3c0c9`, `#eecaa0`, `#012c4b`, `rgb(255 255 255 / 0.16)`, `#eecaa0` |
| Focus | `--focus-ring`, `--focus-halo` and existing `--ring` bridge | `#034f83`, `rgb(6 156 255 / 0.16)`; baltic remains the halo/brand accent, not the sole thin outline |
| Table | `--table-header`, `--table-row-hover`, `--table-row-selected`, `--table-row-selected-foreground`, `--table-divider` | `#f6f3ec`, `#f7fbfe`, `#edf7ff`, `#12314c`, existing `--color-line` |
| Neutral status | `--status-neutral`, `--status-neutral-foreground`, `--status-neutral-border` | `#eef2f4`, `#40586b`, `#cbd5dc` |
| Info status | `--status-info`, `--status-info-foreground`, `--status-info-border` | `#e6f4ff`, `#034f83`, `#9ed8ff` |
| Success | `--success`, `--success-foreground`, `--success-border` | `#dcfce7`, `#166534`, `#86efac` |
| Warning | `--warning`, `--warning-foreground`, `--warning-border` | `#fef3c7`, `#713f12`, `#f5cf69` |
| Destructive | `--destructive`, `--destructive-foreground`, `--destructive-surface`, `--destructive-border` | Keep existing action `#c2410c`; add `#fff`, `#ffedd5`, `#fdba74`; destructive surface text uses `#9a3412` |
| Charts | `--chart-1` through `--chart-6`, plus `--chart-grid`, `--chart-axis`, `--chart-tooltip`, `--chart-tooltip-foreground` | `#034f83`, `#166534`, `#9a3412`, `#6d28d9`, `#a16207`, `#40586b`; line/ink tokens for grid/axis; white/ink tooltip |

Meaningful text contrast pairs (WCAG relative-luminance calculation, normal-text target 4.5:1):

| Foreground / background | Ratio | Rule |
|---|---:|---|
| ink `#12314c` / paper `#f6f3ec` | 12.07:1 | Body text |
| ink / white | 13.38:1 | Card and table text |
| muted `#5c7286` / paper | 4.51:1 | Minimum passing muted text; do not lower opacity |
| muted / white | 4.99:1 | Secondary card text |
| white / blue `#034f83` | 8.57:1 | Primary action |
| white / baltic `#069cff` | 2.91:1 | **Fails normal text and 3:1 non-text edge target**; use baltic only as a broad halo/accent, never as a text-button fill or sole thin focus indicator |
| navy `#012c4b` / sand `#eecaa0` | 9.29:1 | Sidebar selected/accent and warm actions |
| white / navy | 14.35:1 | Sidebar primary text |
| sidebar muted `#b3c0c9` / navy | 7.72:1 | Sidebar secondary text |
| success foreground `#166534` / surface `#dcfce7` | 6.49:1 | Success badge/alert |
| warning foreground `#713f12` / surface `#fef3c7` | 7.79:1 | Warning badge/alert |
| destructive surface foreground `#9a3412` / `#ffedd5` | 6.38:1 | Error badge/alert |
| info foreground `#034f83` / `#e6f4ff` | 7.65:1 | Info badge/alert |
| ink / selected row `#edf7ff` | 12.33:1 | Selected table rows |

Chart swatches are categorical marks, not text colors. Thin lines and small marks must meet 3:1 against their immediate background; pair pale fills with a darker outline. Tooltips and the adjacent textual summary carry exact values.

## Smallest missing shadcn source set

Install source into `src/components/ui`; do not import a packaged UI kit. Preserve generated Radix keyboard, ARIA, focus, portal and disabled behavior, then tune only with the semantic tokens above.

1. `sidebar` (reuse existing Button, Input and Sheet; add its generated `use-mobile` support), `separator`, `skeleton`, and `tooltip` dependencies.
2. `card`, `badge`, and `tabs` for KPI/status surfaces.
3. `table`, `checkbox`, `select`, and `dropdown-menu` for data grids and row/column controls.
4. `popover` + `command` for searchable/faceted pickers; do not hand-roll a combobox.
5. `alert-dialog` for destructive confirmation and `alert` for persistent inline feedback.
6. `switch` for boolean configuration fields.
7. `chart` for the Recharts accessibility/config bridge.

Do **not** add shadcn Form (the project uses TanStack Form), Dialog for full create/edit flows, another Sheet, another toast system, or structural-only Breadcrumb/Pagination/Empty wrappers. Those last three are app compositions made from semantic HTML and the listed Button/Card primitives and have no behavior worth duplicating. If a later validated UX requirement needs a modal editor, calendar/date picker or radio group, add its official shadcn/Radix source then rather than preinstalling it.

## Implementation and verification boundary

- Shared source primitives stay in `src/components/ui`; app-specific Sidebar groups, DataTable toolbar/columns, KPI cards and entity forms stay in an authenticated app feature/layout, not in the landing feature.
- Use CVA only for real public variants listed here. Use `data-state` from Radix rather than parallel React state for open/selected visuals.
- Test each applicable state in focused component tests or the repository's eventual demo surface: hover/focus-visible, selected/open, disabled, loading, empty, error, success, warning and destructive.
- Automated contrast checks must assert the listed pairs; visual QA must include keyboard-only navigation, 200% zoom, reduced motion and mobile Sheet focus restoration.
- Run `bun run check` after implementation. This document alone changes no production UI.

## Integration verification record

Validated on 2026-08-17 against the final semantic-token bridge, shadcn/Radix source primitives, authenticated demo fixtures, and the public landing page.

- `bunx vitest run --config vitest.config.ts tests/unit/style-tokens.test.ts tests/unit/ui-primitives.test.ts tests/unit/accessibility-primitives.test.tsx tests/unit/responsive-primitives.test.tsx` — 86 assertions passed. The 67 token assertions cover all 40 Tailwind mappings, 20 normal-text pairs, all six chart marks, and the thin focus indicator.
- The automated contrast range for normal text is 4.51:1 through 14.35:1 (the exact meaningful pairs are recorded above). This applies the stricter 4.5:1 normal-text threshold, so the inventoried large-text cases also exceed their 3:1 threshold. Every chart mark and the focus ring separately pass the 3:1 non-text contrast threshold against their immediate light surfaces; baltic remains explicitly rejected as a sole thin indicator at 2.91:1 against white.
- `bunx playwright test --project=chromium tests/e2e/landing.spec.ts tests/e2e/accessibility.spec.ts` — 13 tests passed. This covers axe serious/critical findings, keyboard activation and focus restoration for the mobile Sheet, tab selection, reduced-motion emulation, form-error exposure, no-JS content, and landing reflow at 1440, 1024, 768, 430, 390, 360, and 320 CSS px.
- `bun run test:visual:update` followed by `bun run test:visual` — all 11 reviewed baselines passed on the confirming run: landing desktop/tablet/mobile, mobile navigation Sheet, authenticated catalog desktop/mobile, destructive dialog, quote detail, controls/chart/files tablet/mobile, and loading/empty/error states.
- Source audit confirmed the app primitives use Jost through `font-sans`, Newsreader through `font-display`, Phosphor's SSR entry with `weight="light"`, and named `z-header`/`z-overlay` utilities. No raw numeric overlay utility, second UI kit, or hand-rolled Radix substitute was found in the integrated primitive layer.
- `bun run check` — passed end to end: content, TypeScript, ESLint (warnings only), 510 unit tests, dependency audit, production/prerender build, public-bundle budget, and production-header checks.
