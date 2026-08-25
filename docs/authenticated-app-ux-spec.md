# Weyne authenticated application UX specification

**Status:** implementation-ready product and interaction contract

**Scope:** authenticated application only

**Language:** UI and business copy in pt-BR; code identifiers in English

**Benchmark access date:** 2026-08-17

## 1. How to read this specification

The keywords **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative:

- **MUST / MUST NOT** — required for the authenticated application.
- **SHOULD** — preferred default; deviation needs a documented product, data, or accessibility reason.
- **MAY** — optional enhancement, not required for the first complete flow.

This document defines a target contract. It does not claim that every route or component already exists. The repository state rechecked during validation exposes `/`, `/app`, `/app/produtos`, and `/app/relatorios`; `/` remains the public landing page and is excluded from this specification. `/app` is currently a runtime placeholder, `/app/produtos` is an early catalog surface, and `/app/relatorios` is an experimental Phase 2 report surface. None is a completed shared app shell. The existence of the report route does not promote reports into Phase 1 navigation or release scope. The canonical domain contract makes cadastros, orçamentos, pedidos, and quote PDF the Phase 1 scope; dashboard, reports, exports, and price-history UI are later-phase capabilities.

The benchmark provides interaction evidence, not a license to copy visual identity.

Linear informs hierarchy, search, filters, and optional peek behavior.[10][11][12]

Stripe informs overview and list-to-detail clarity, while shadcn provides source-owned composition.[8][9][15]

Twenty and Odoo inform record, table, filter, and activity patterns.[2][3][6]

Sentry informs progressive disclosure in dense details.[16]

## 2. Product boundaries and route contract

### 2.1 Non-negotiable boundaries

- The public `/` landing page **MUST NOT** be redesigned, restyled, or absorbed into the app shell.
- The app **MUST** remain light-only until dark mode is separately approved.
- Implementers **MUST NOT** add a second UI kit. Use source-owned shadcn/Radix primitives in `src/components/ui`, Tailwind v4 CSS-first tokens in `src/styles/app.css`, and app compositions in `src/features/app`.
- UI copy **MUST** use the canonical pt-BR business terms: Cliente, Indústria, Produto, Transportadora, Orçamento, Pedido, Tabela de preço, and Representante.
- Routes and controls **MUST** be permission-aware, but hiding a control is not authorization. Every server function and data boundary must enforce permissions independently.
- Phase 1 **MUST NOT** present dashboard metrics, reports, financial processing, fiscal issuance, ERP integration, or price-history UI as implemented capabilities.

### 2.2 Canonical route families

The following is the target information architecture. “Phase 1” rows are normative once that module is implemented. “Later” rows define visual behavior but **MUST NOT** be exposed as functional navigation until their data contracts exist.

| Navigation label | Canonical route family | Phase | Required route pattern |
| --- | --- | --- | --- |
| Início | `/app` | Shell now; dashboard later | Today: authenticated start/wayfinding surface. Later: dashboard with KPI and charts. |
| Clientes | `/app/clientes` | Phase 1 | list, `/novo`, `/$customerId`, `/$customerId/editar` |
| Indústrias | `/app/industrias` | Phase 1 | list, `/nova`, `/$industryId`, `/$industryId/editar` |
| Produtos | `/app/produtos` | Phase 1 | list, `/novo`, `/$productId`, `/$productId/editar` |
| Transportadoras | `/app/transportadoras` | Phase 1 | list, `/nova`, `/$carrierId`, `/$carrierId/editar` |
| Orçamentos | `/app/orcamentos` | Phase 1 | list, `/novo`, `/$quoteId`, and `/$quoteId/editar` only while editable |
| Pedidos | `/app/pedidos` | Phase 1 | list and `/$orderId`; no direct-create route and no free-form edit route |
| Relatórios | `/app/relatorios` | Later | An experimental route exists, but it remains out of Phase 1 navigation/release acceptance; expose overview and report-specific deep links only when the Phase 2 contract is enabled. |
| Configurações | `/app/configuracoes` | Phase 1 as needed | account/business/access subsections defined by permissions; not a dumping ground for entity CRUD |

Representatives and users are administrative concepts, not first-level navigation in the current contract. If user administration is implemented, it **SHOULD** live under Configurações. Price lists are fixed Phase 1 records and **SHOULD** be managed from the relevant product/pricing context rather than becoming an extra sidebar destination.

### 2.3 URL-owned view state

List routes **MUST** validate and own these search parameters when applicable:

- `q`: in-view text query;
- `status`: selected status tab or status facet;
- entity-specific facets such as `industry`, `representative`, or date range;
- `sort`: canonical column key and direction;
- `page` and `pageSize` for server pagination;
- `columns` only if column visibility is intentionally shareable.

Defaults **MUST** be omitted from generated URLs. Unknown or unauthorized facet values **MUST** normalize safely rather than crashing. Opening a detail and returning **MUST** restore query, filters, sort, page, and useful scroll position. URL-backed filters make views understandable and shareable, as demonstrated by Linear, Twenty, and Odoo.[4][6][11]

Saved views and preview-pane state are **MAY** enhancements after the base semantics are stable.[12][13]

Sidebar personalization and configurable dashboard widgets are also optional later work.[1][5]

## 3. Visual foundation

### 3.1 Color and surfaces

App components **MUST** consume the existing semantic bridge rather than scatter raw hex values:

| Role | Existing token or utility | Required use |
| --- | --- | --- |
| App canvas | `bg-background` / `--background` (`paper`) | Main authenticated canvas |
| Primary text | `text-foreground` / `--foreground` (`ink`) | Body, table cells, headings |
| Secondary text | `text-muted-foreground` | Supporting copy; never lower opacity below the existing contrast |
| Cards and overlays | `bg-card`, `bg-popover` | Data and floating surfaces |
| Primary action | `bg-primary text-primary-foreground` (`blue`/white) | One dominant action per page region |
| Warm accent | `bg-secondary`, `bg-accent` (`sand`) | Selected sidebar item, restrained emphasis, not a second primary action |
| Focus | `ring-focus-ring` plus `ring-focus-halo`; global `:focus-visible` | Visible focus; baltic is a halo/accent, not white text background |
| Dividers | `border-border`, `border-table-divider` | Default separation instead of decorative elevation |
| States | `status-*`, `success-*`, `warning-*`, `destructive-*` | Badges and alerts with text/icon redundancy |
| Charts | `chart-1` through `chart-6`, grid/axis/tooltip tokens | Data marks and supporting chrome |

The palette **MUST** preserve `#034F83`, `#069CFF`, and `#EECAA0`, with navy, paper, ink, muted, and line tokens already established in `app.css`. Landing gradients and expressive landing shadows **MUST NOT** be reused for routine app chrome. App cards **SHOULD** use a one-pixel semantic border and flat white surface. Elevation is reserved for portalled popovers, menus, sheets, dialogs, or a genuinely floating sticky action surface; repeated new elevation must become a CSS-first token rather than an arbitrary value.

### 3.2 Typography

- Jost (`font-sans`) **MUST** be the UI typeface for navigation, forms, tables, labels, buttons, badges, and body copy.
- Newsreader (`font-display`) **SHOULD** appear only in page titles, the authenticated wordmark, and large KPI values. It **MUST NOT** appear in table cells, controls, helper copy, or dense metadata.
- Page title: desktop `text-3xl` with approximately 1.15 line height; narrow screens `text-2xl`.
- KPI value: `text-3xl` to `text-4xl`, tabular numerals where available.
- Section title: `text-lg font-semibold` in Jost unless it is the page's only display heading.
- Body and form controls: `text-sm` to `text-base`; default dense app body is 14px/20px, never below 14px for essential content.
- Labels and table headers: 12–14px with medium or semibold weight. Uppercase tracking **MAY** be used only for short eyebrow labels, not paragraphs or table headers.
- Numeric tables **MUST** use right alignment and tabular numerals; currency and percentages **MUST** include units in accessible text.

### 3.3 Spacing, radii, controls, and motion

Use Tailwind's existing spacing scale; do not create a parallel spacing vocabulary.

| Element | Desktop | Narrow/mobile |
| --- | ---: | ---: |
| App content gutter | 24px; 32px at wide desktop | 16px |
| Major section gap | 24–32px | 20–24px |
| Card padding | 20–24px | 16px |
| Form field vertical gap | 16px | 16px |
| Two-column form gap | 20–24px | single column |
| Default control height | 40px | 44px for touch-critical controls |
| Compact toolbar control | 36px, desktop only | 44px |
| Table row | 48px minimum | 52px minimum if retained as a table |
| Icon | 18–20px default | same; target remains at least 44px |

Use the existing semantic radius chain derived from `--radius: 0.75rem`. Cards use `rounded-lg`; controls use `rounded-md`; pills are reserved for status badges, active-filter chips, and deliberately pill-shaped actions. Dense product UI **MUST NOT** inherit 20–26px landing-card radii everywhere.

State changes **MUST** use `--ease-house`. Hover/focus/selection transitions should complete in roughly 120–200ms. Sheets and dialogs may use 180–240ms. No data or task-critical state may depend on animation, and the existing reduced-motion reset **MUST** remain authoritative.

## 4. Authenticated shell

### 4.1 Desktop sidebar

At `nav` (900px) and wider, the app **MUST** use a persistent left sidebar composed from shadcn `Sidebar` parts.[17]

**Anatomy, top to bottom:**

1. Header: Weyne wordmark and optional compact organization label.
2. Primary navigation: Início; Cadastros group (Clientes, Indústrias, Produtos, Transportadoras); Comercial group (Orçamentos, Pedidos); later Relatórios.
3. Flexible spacer.
4. Footer: Configurações if authorized, then user/account menu with name and role.
5. Rail/trigger: collapse/expand affordance with accessible name and tooltip.

**Sizing and behavior:**

- Expanded width: 264px. Collapsed icon rail: 72px. The content inset fills the remaining viewport.
- The sidebar **MUST** be navy (`bg-sidebar`) with white primary text and the sidebar-muted token for supporting labels.
- The active destination **MUST** use sand background/navy text plus `aria-current="page"`; it cannot rely on color alone.
- Group labels disappear when collapsed; every icon-only destination then has a tooltip and accessible name.
- Phosphor icons use the SSR entry and `weight="light"`. Active state may increase weight only if the label and background remain present.
- Unauthorized destinations **MUST** be omitted. Temporarily unavailable destinations may be disabled only when the explanation is useful and visible.
- Sidebar collapse **MAY** persist per user. Destination order and grouping **MUST NOT** be user-customizable in Phase 1.
- `Cmd/Ctrl+B` **MAY** toggle the sidebar only if a visible tooltip or shortcut-help surface documents it.[17]

The sidebar follows the benchmark's stable-destination hierarchy without copying Twenty's personalization or another product's taxonomy.[1][17]

### 4.2 Top context bar

The context bar **MUST** remain visible at the top of the content inset and use a restrained card/background surface with a bottom border.

**Anatomy:** sidebar trigger on mobile or collapsed desktop; breadcrumb; optional status/scope text; flexible spacer; one primary page action; overflow menu for secondary actions.

- Height: 64px desktop and 56px narrow screens, excluding wrapped mobile actions.
- It **MUST NOT** duplicate the full page title. Breadcrumbs answer location; the page header below answers task and identity.
- Desktop breadcrumbs may show up to three meaningful levels. On narrow screens show only parent (when useful) and current page; visually truncate long labels, preserving the full value in accessible text/title where appropriate.
- A primary action uses a text label (`Novo orçamento`, not a lone plus icon). It remains reachable without horizontal scrolling.
- Secondary actions belong in an accessible DropdownMenu. Destructive actions are separated and require AlertDialog confirmation.
- When the context bar is sticky, it **MUST** remain below the existing global skip-link layer and must not cover focused content.

This separation of stable navigation, route context, and view controls follows the hierarchy visible in shadcn's sidebar/dashboard compositions and the benchmark synthesis.[8]

### 4.3 Mobile Sheet navigation

Below 900px, the desktop sidebar **MUST** disappear and the same information architecture **MUST** open in the existing left-side `Sheet`.

- Trigger target: at least 44 by 44px, first control in the context bar, accessible name `Abrir navegação`.
- Sheet width: `min(320px, calc(100vw - 32px))`; honor safe-area insets.
- Order, labels, icons, active state, permission filtering, and account footer **MUST** match desktop.
- Opening moves focus to the Sheet; Escape and overlay close it; closing returns focus to the trigger. Choosing a destination closes it after navigation.
- Body scroll **MUST** be locked while open. Long navigation scrolls inside the Sheet without moving the underlying page.
- A mobile bottom navigation bar **MUST NOT** be introduced in Phase 1. Prioritized bottom navigation is a later, usage-validated possibility, not a benchmark copy.[14]

## 5. Page hierarchy and route patterns

### 5.1 Shared page header

Every route surface **MUST** begin with one `h1` and this hierarchy:

1. optional short eyebrow or breadcrumb context;
2. Newsreader page title;
3. optional one-sentence description, freshness, or ownership context;
4. page-level action group.

Desktop places copy and actions on one row. Below 640px, actions move below the copy, become full-width only when needed, and preserve one visually dominant action. List toolbars, status tabs, and filters follow the page header; they do not occupy the title row.

### 5.2 List pattern

All entity lists **MUST** use this order:

1. page header and permitted create action;
2. optional KPI summary only when it changes a decision;
3. stable status tabs when the entity has mutually exclusive workflow states;
4. search/filter toolbar and active-filter chips;
5. result count/freshness message;
6. entity-specific table or narrow-screen record list;
7. pagination.

The primary record name/code opens the canonical detail route. Clicking whitespace in a row **MAY** open detail only if selection and text copying remain unambiguous. Secondary row actions live in a labeled overflow menu that is keyboard reachable without hover. A universal all-entity table **MUST NOT** be built; shared table behavior is composed with route-specific columns, as shadcn recommends.[9]

### 5.3 Detail pattern

Record details **MUST** use progressive disclosure:

- Identity header: primary name/number, status badge, owner/representative when relevant, primary permitted action, overflow.
- Summary card: high-value immutable or current facts.
- Tabs only for coherent domains: `Visão geral`, `Atividade`, `Relacionados`, `Anexos` when data exists.
- Definition lists for labeled values; tables for repeated related records; an ordered timeline for auditable state transitions.
- Archived related entities remain visibly labeled as historical and are not silently presented as active.
- Long notes wrap; identifiers and document numbers may be copied; raw UUIDs remain secondary metadata.
- Missing record is a route-level not-found state. Forbidden access is not disguised as an empty record.

Orçamento detail **MUST** prioritize number, status, cliente, representante, validity, price list, carrier, line items, totals, and PDF/actions. Commercial content becomes read-only after the canonical workflow says it is immutable. Pedido detail **MUST** show its source orçamento, immutable line snapshots, operational status/history, and attachments. It has no direct-create or unconstrained edit affordance. This content-first progression transfers from Twenty record pages and Sentry issue detail without importing their visual density.[2][16]

### 5.4 Create and edit pattern

Full entity creation and editing **MUST** use canonical routes, never a modal. The minimum valid identity fields appear first; secondary contact, address, tax, logistics, notes, and audit sections follow in meaningful groups.

- Maximum readable form width: 960px; dense related-record editors may use the wider page surface.
- Desktop uses two columns only for short, independent fields. Long text, legal names, addresses, notes, error summaries, and line editors span both columns.
- Required fields are declared in text/markup, not only by an asterisk. Optional fields may be labeled `Opcional` when ambiguity matters.
- One primary action uses explicit copy: `Criar cliente`, `Salvar alterações`, or `Criar orçamento`.
- `Cancelar` is secondary and returns to the preserved origin when safe.
- Explicit save is the default. Autosave **MUST NOT** be introduced inconsistently.
- Dirty navigation triggers an accessible confirmation. Browser unload protection supplements but does not replace in-app guards.
- Client validation runs on blur/submit as appropriate. Server errors map to fields when possible and also appear in a page-level summary that links/focuses the invalid field.
- Submission keeps the form stable, sets `aria-busy`, disables duplicate submission, and preserves entered data on failure.
- Success navigates to the resulting detail (or preserved list when editing in place), announces the outcome, and moves focus to the result heading.

The minimum-first composition is informed by Odoo's focused activity form, while persistent alerts use shadcn's explicit action anatomy.[7][21]

### 5.5 Quote line editor

Because an orçamento is a commercial document rather than a simple record, its line editor **MUST** be optimized separately:

- Product picker is a searchable Popover + Command, scoped to active/authorized products.
- Each line exposes product identity, quantity, unit, price source, unit price, permitted discount, and computed totals.
- Decimal and BRL values are formatted for pt-BR display but retain canonical string transport; no floating-point approximation appears in UI logic.
- Totals remain visible near the action area on desktop and follow the line list on mobile.
- Line-level errors remain attached to the line and are repeated in the form summary.
- Narrow screens render each line as a labeled card/stack rather than squeezing every commercial column into an unreadable table.
- Removing a line requires a clear action; confirmation is needed only when the line contains meaningful entered data or the operation cannot be undone before save.

## 6. KPI cards and status tabs

### 6.1 KPI cards

KPI cards are required only for a later-phase dashboard or a list where the value changes triage. They **MUST NOT** be used to decorate Phase 1 pages without a defined metric.

**Anatomy:** concise label; current value; unit; comparison period; trend text/icon; optional drill-down link; freshness or unavailable state.

- Show 3–4 cards per desktop row, two at intermediate widths, and one below 640px.
- Minimum desktop height: 132px. Padding: 20–24px.
- Value uses Newsreader and tabular numerals; all other text uses Jost.
- Trend **MUST** say the direction and comparison (`8% acima dos 30 dias anteriores`), not show an unlabeled arrow or color alone.
- The entire card may be a link only when it has exactly one destination and a clear accessible name.
- Loading preserves the final geometry with Skeleton. Unavailable metrics show `Indisponível` and a recovery/explanation, never `0`.
- Configuration/reordering is a **MAY** enhancement after a useful default dashboard exists.[5][15]

Twenty's recommendation to start with a few actionable metrics and Stripe's overview clarity support this deliberately small set.[5][15]

### 6.2 Status tabs

Use shadcn/Radix `Tabs` only for stable, mutually exclusive workflow slices, for example orçamento or pedido status. Ad-hoc combinations remain facets.[2][7]

- First tab is `Todos` unless the route has a more useful, documented default.
- Each tab label may include a count in the same active-filter scope. Loading counts reserve width or use an accessible placeholder.
- Selection lives in the URL and uses `aria-selected`/Radix semantics.
- Arrow keys move among tabs; Tab enters/leaves the tab list; activation follows the chosen Radix mode consistently.
- On narrow screens, the tab list scrolls horizontally with a visible clipped-edge cue. It **MUST NOT** wrap into multiple rows or hide tabs behind an unlabeled dropdown.
- Counts are supporting text and **MUST NOT** be the sole status name.
- Tabs **MUST NOT** reproduce sidebar destinations or become nested route navigation.

## 7. Search, facets, tables, and pagination

### 7.1 Search scopes

The app **MUST** distinguish:

- **Global search:** cross-entity navigation, invoked from a clearly labeled command/search control; result groups name their entity.
- **In-view search:** narrows the current route only; placeholder names the scope, for example `Buscar clientes`.

`/` **MAY** open global search when focus is not in an editable control. `Cmd/Ctrl+F` **MUST NOT** override the browser find command unless product approval explicitly accepts that trade-off; an in-view search shortcut may instead be shown next to the field. Escape clears an in-view query only while that field or its results own focus. Linear demonstrates why global and current-view search should remain distinct.[10]

Search **MUST** expose backend reality: do not promise fuzzy matching, hidden fields, comments, or unlimited results unless supported. Debounced server search should wait roughly 250–400ms, cancel stale requests, retain the prior surface during refresh, and announce the updated result count without moving focus.

### 7.2 Faceted filters

- Common facets appear in a searchable Popover + Command or typed Select.
- Initial Phase 1 logic is comprehensible AND across facets and OR within a multi-select facet.
- Active criteria appear as removable chips after the toolbar; `Limpar filtros` appears when any non-default criterion is active.
- Each chip names both property and value (`Status: Rascunho`), not only the value.
- Date ranges use explicit start/end labels and pt-BR display.
- Removing a chip or clearing all updates the URL and result count without moving keyboard focus unexpectedly.
- A filter popover returns focus to its trigger on close. Empty option lists, no matches, loading, and fetch error are distinct states.
- Nested boolean builders are optional later enhancements, not Phase 1 requirements.[4][6][11]
- Saved views are likewise deferred until the base filter semantics are stable.[13]

### 7.3 Data table anatomy

Use shadcn `Table` plus TanStack Table. Every entity defines its own column model.[3][9]

**Required anatomy:** semantic caption or accessible name; header row; body; primary link cell; status cell when relevant; numeric cells; optional selection; row overflow action; pagination summary.

- Default row height is at least 48px; header is 44px or greater.
- Header text remains visible and concise. Sortable headers use a real button with label and direction; the current direction is announced with `aria-sort`.
- Text is left-aligned; numbers/currency right-aligned; statuses use Badge; actions occupy the final narrow column.
- Selection uses Checkbox with row-specific accessible labels. A bulk-action bar appears only when selection is non-empty and says how many items are selected.
- Row hover **MUST NOT** reveal the only route to an action. Focus-visible state is at least as clear as hover.
- Column visibility **SHOULD** offer only optional columns. The primary identity, essential status, and actions cannot all be hidden.
- Resize/reorder/grouping are **MAY** enhancements. Do not add them before real user need.
- Server-owned sort, filter, and pagination controls **MUST** not imply client-only completeness.

### 7.4 Overflow and responsive table behavior

- The page **MUST NOT** horizontally scroll as a side effect of a table. The table receives its own labeled overflow container.
- At desktop widths, preserve the primary identity column and action reachability; a sticky first column is permitted only when its background, borders, and keyboard focus remain correct.
- Long text truncates visually with a discoverable full value; never truncate a unique identifier so aggressively that rows become indistinguishable.
- Between 640px and 899px, hide optional columns through the defined column model and expose their values in row detail or the canonical detail page.
- Below 640px, use a stacked record-list/card representation when comparison across columns is no longer the primary task. Keep semantic links, status, two or three decision fields, and actions. A horizontally scrollable table remains acceptable for intrinsically tabular quote line comparison, with a visible instruction and no clipped focus ring.
- Overflow menus **MUST** remain inside the viewport and use portalled shadcn/Radix behavior.

### 7.5 Pagination

Phase 1 lists **SHOULD** use explicit server pagination rather than infinite scrolling.

- Show `Anterior`, `Próxima`, current page, and a result summary. Numbered page buttons are optional when total pages are reliable and useful.
- First/last controls are truly disabled at boundaries.
- Page size may be 25/50/100 on dense lists; the default should be 25 or 50 based on response size.
- Filter or search changes reset to page 1. Sort changes reset only when the current page cannot be preserved safely.
- Loading a page retains table geometry and toolbar state. Focus remains on the invoked pagination control, then the update is announced.

## 8. Forms: dense but breathable

### 8.1 Primitive mapping

- Text and multiline: existing `Input`, `Textarea`, and app-surface `Field` tone.
- Native choice: shadcn `Select`, `Checkbox`, and `Switch` only where semantics match.
- Searchable relation/facet: `Popover` + `Command`; do not hand-roll a combobox.
- Destructive confirmation: `AlertDialog`; never `window.confirm`.
- Persistent feedback: `Alert`; non-blocking confirmation: existing Sonner `Toaster`.
- Full forms: TanStack Form. Do not add shadcn's React Hook Form wrapper.

### 8.2 Field anatomy and content behavior

Each field **MUST** render label, required/optional meaning, control, optional description, and inline error in that order. Errors use `aria-invalid` and `aria-describedby`; the message says what happened and how to fix it. Placeholder text is an example or format hint, never the only label.

- CNPJ, CEP, phone, dates, percentages, decimal quantities, and BRL use pt-BR display conventions while preserving canonical domain values.
- Masking **MUST NOT** prevent paste, deletion, screen-reader comprehension, or submission of normalized values.
- Selectors distinguish no selection from an empty result and from restricted options.
- Read-only fields remain selectable and visually legible; disabled fields are only for values excluded from submission/interaction.
- Async validation is announced and cannot erase a newer value when an older request completes.
- Related entity selectors **MUST** omit archived records for new documents but may show the historical archived selection on existing immutable documents.

### 8.3 Form state transitions

`pristine → dirty → validating → submitting → success/error` is the shared form model.

- A primary submit remains stable in width; spinner and text (`Salvando…`) communicate mutation.
- On validation failure, focus moves to the error summary or first invalid field according to route complexity; all errors remain inspectable.
- On server failure, preserve values, display a persistent Alert near the action region, and focus the alert only when it would not disorient the user.
- On conflict/stale data, show the consequence and offer reload/review. Never silently overwrite.
- Destructive actions begin in the detail overflow, open AlertDialog with safe cancel focus, name the entity and consequence, and keep server errors inside the dialog.

## 9. Empty, loading, error, success, and permission states

Every route and major region **MUST** define the applicable states below. shadcn provides the source anatomy for Empty, Skeleton, and Alert.[19][20][21]

| State | Required presentation | Required action/focus behavior |
| --- | --- | --- |
| First-use empty | Icon, specific title, one-sentence value, one permitted primary action | Create/import only when supported; heading is announced after load |
| Filtered empty | Echo query/facets; no decorative illustration | `Limpar filtros`; focus stays with toolbar |
| Permission-limited | Say access is restricted, not that data is absent | Link to safe destination or support path when available |
| Initial loading | Geometry-matched Skeleton for cards/rows/detail; shell and context remain stable | Affected region has `aria-busy`; avoid repeated live announcements |
| Background refresh | Keep prior content, show subtle progress/freshness | Controls remain available unless mutation safety forbids it |
| Action loading | Spinner/progress within invoking control; stable label width | Prevent duplicate submit, do not disable unrelated navigation |
| Recoverable fetch error | Persistent Alert with consequence and retry | Retry returns focus/announcement to the region |
| Not found | Route-level title and safe return link | Focus page heading after navigation |
| Forbidden | Explicit access message; no leaked record details | Safe return destination |
| Save error | Form values retained; page Alert plus field mapping | Focus summary/alert; retry available |
| Success | Updated visible content and concise toast/live message | Focus resulting heading, row, or restored trigger |

A toast **MUST NOT** be the only evidence of a blocking load/save failure. Skeletons **MUST** match real geometry and stop promptly; stale KPI values must not masquerade as new data.[20][21]

## 10. Charts and dashboard presentation

Charts are a later-phase capability. These rules become normative when dashboard/report metrics are approved.

### 10.1 Selection rules

- Single current value: KPI card, not a chart.
- Trend over ordered time: line chart; area fill only when cumulative magnitude is meaningful.
- Comparison/ranking across entities: horizontal bar chart.
- Composition over time: stacked bar only when every part matters and totals remain readable.
- Pie/donut, gauge, radar, 3D, dual-axis, decorative sparkline, and more than six simultaneous series **MUST NOT** be default choices.

### 10.2 Chart anatomy and synchronization

Use the existing shadcn `Chart` wrapper over Recharts; do not add another chart library.[18]

Every chart **MUST** provide title, question/meaning, unit, date range, filter scope, freshness, legend when needed, tooltip, empty/error/loading states, and an adjacent textual summary or table path to exact values. Its Card uses the same filters and time range as nearby KPI counts and lists. Sentry's coordinated graph/search scope informs this requirement without carrying over debugging density.[16]

- Default card height: 320–400px desktop and 280–340px mobile.
- Container has a measurable width/height so responsive rendering is stable.[18]
- Axis labels are abbreviated visually but exact in tooltip/summary.
- Grid lines use `chart-grid`; labels use `chart-axis`; marks use `chart-1`…`chart-6`.
- Color never stands alone: legend text, line style, marker shape, direct label, or ordered table supplies redundancy.
- Null is not zero. Empty periods are labeled. Partial/stale data is disclosed.
- Tooltips cannot be the only exact-value path and must be keyboard/touch accessible or duplicated in the adjacent table.
- On mobile, legends wrap below the plot, category labels remain readable, and the exact-value table may become the primary representation.

## 11. Responsive contract

The existing `--breakpoint-nav: 56.25rem` (900px) is authoritative for shell navigation.

| Range | Shell | Content behavior |
| --- | --- | --- |
| `< 640px` | Mobile context bar + Sheet | 16px gutters; single-column forms/KPIs; stacked record lists; full-width wrapped action groups |
| `640–899px` | Mobile context bar + Sheet | Two-column KPI grid where content fits; reduced table columns; forms may use two columns selectively |
| `900–1279px` | Desktop sidebar, collapsible | 24px gutters; 2–3 KPI columns; table owns overflow |
| `≥ 1280px` | Desktop sidebar | 32px gutters; 3–4 KPI columns; full entity columns where useful |

- List/table pages may fill the content inset with a practical maximum around 1536px.
- Detail pages **SHOULD** cap readable content around 1200px.
- Forms **SHOULD** cap at 960px except line-item editors.
- Nothing essential may be clipped at 320 CSS px width or 200% zoom. Reflow takes priority over matching desktop geometry.
- Sticky elements must account for safe areas, context-bar height, on-screen keyboards, and visible focused controls.
- Mobile adaptation preserves task and information priority; it is not a uniformly scaled desktop.

## 12. Keyboard, focus, and interaction transitions

### 12.1 Required keyboard contract

- Tab/Shift+Tab traverses all interactive controls in DOM order without keyboard traps.
- Enter activates links/buttons; Space activates buttons, checkboxes, and switches according to native/Radix semantics.
- Escape closes the topmost dismissible popover/menu/Sheet/dialog and restores focus to its trigger.
- Arrow keys operate Tabs, menus, selects, command results, and radio-like controls through their source primitives.
- Table rows do not pretend to be a grid unless cell-level keyboard editing is implemented. Users Tab to real links, selection controls, and actions.
- Shortcuts **MUST NOT** fire while typing in inputs, textareas, selects, comboboxes, or content-editable regions.
- A shortcut-help surface **MUST** exist before adding more than global search, sidebar toggle, and optional create.

### 12.2 Focus placement

- Route navigation moves focus to the new `h1` or a route-announcement target after content is ready; it does not leave focus on a removed sidebar link.
- Opening an overlay moves focus inside; closing restores the invoking control unless the control was removed, in which case focus goes to the nearest stable heading/action.
- Adding a quote line moves focus to its first required field or the new line heading. Removing a line moves focus to the adjacent line or add control.
- Filter and pagination refreshes do not reset focus or scroll to the page top.
- After successful create, focus the record heading. After successful edit, focus the updated heading or confirmation region. After destructive success, focus the list heading or neighboring row.
- Focus rings **MUST** remain visible inside clipped/scrolling regions and over selected/hover surfaces.

## 13. Accessibility requirements

The authenticated application **MUST** meet WCAG 2.2 AA as an implementation target.

- Preserve `lang="pt-BR"`, semantic landmarks, a skip link to app main content, one `main`, and a logical heading outline.
- Every icon-only control has an accessible name and at least a 44 by 44px mobile target.
- Text contrast uses the verified semantic pairs in `app.css`/the component-state inventory. White on baltic is not valid for normal text; baltic remains a halo/accent.
- Status, trend, selection, validation, and chart meaning use text/shape/icon in addition to color.
- `aria-current`, `aria-selected`, `aria-expanded`, `aria-invalid`, `aria-describedby`, `aria-sort`, `aria-busy`, and live regions are applied only where semantics require them.
- Live announcements are concise and throttled: result counts after settled search, mutation outcomes, and blocking errors; not every skeleton or keystroke.
- Tables retain semantic table markup. Stacked mobile records use lists/articles with labeled values rather than fake table roles.
- Form error summaries link to invalid controls. Required, optional, read-only, and disabled meanings are available to assistive technology.
- Sheets, menus, popovers, selects, command lists, Tabs, and AlertDialogs retain Radix focus and keyboard behavior; custom styling must not remove it.
- Touch/pointer interactions have keyboard equivalents. Hover is never the only way to discover content or actions.
- At 200% zoom and 320 CSS px, content reflows with no two-dimensional page scroll and no obscured focus.
- `prefers-reduced-motion` disables nonessential movement while preserving state communication.
- Loading, empty, forbidden, not-found, and error messages are distinguishable in text.

## 14. Component ownership map

| UX need | Required primitive/composition | Ownership |
| --- | --- | --- |
| Sidebar | shadcn `Sidebar`, existing `Sheet`, Tooltip, Separator | primitives in `src/components/ui`; route groups in app shell |
| Context/page header | Button, DropdownMenu, semantic breadcrumb markup | app composition |
| KPI | Card, Skeleton, optional Button/link | app composition |
| Status | Tabs and Badge | primitive semantics; domain mapping in feature |
| Table | Table, Checkbox, Select, DropdownMenu + TanStack Table | shared behavior in `src/components/data-table`; columns in entity feature |
| Facets/relations | Popover + Command | shared picker behavior; options/query in feature |
| Forms | existing Field/Input/Textarea + Select/Checkbox/Switch + TanStack Form | shared fields in `src/components/forms`; schema/form in feature |
| Feedback | Alert, Skeleton, existing Sonner Toaster | primitives plus route-specific copy |
| Destructive action | AlertDialog | primitive plus domain command in feature |
| Charts | shadcn Chart/Recharts | wrapper in UI; metrics/config in report/dashboard feature |

CVA is appropriate only for real public variant APIs such as Button and Badge. Route-specific layout combinations **MUST NOT** become universal primitives merely to avoid repeating a few Tailwind utilities.

## 15. Route-specific application

### 15.1 Clientes

- List identity: legal/trade name, CNPJ/CPF when present, city/UF, contact, responsible representative, active/archived status.
- Common facets: status, representative, UF, segment when canonical data supports it.
- Detail prioritizes identity/contact/address, responsible representative, related orçamentos/pedidos, and audit data by permission.
- Credit limit is optional/informational and permission-sensitive; it **MUST NOT** visually imply automated credit approval.

### 15.2 Indústrias

- List identity: legal/trade name, optional brand and tax ID, active/archived state, and product count if efficiently available. The canonical Phase 1 Industry has no contact field.
- Admin owns create/edit/archive/restore. Non-admin list/details expose only the authorized active catalog projection.
- Detail relates products and active commercial metadata; commission controls remain admin-only and follow domain phase rules.

### 15.3 Produtos

- `/app/produtos` must evolve into the shared shell/list contract rather than remain a standalone page canvas.
- Primary identity: code and description; supporting fields: industry, brand, unit, active/archived status, relevant price availability.
- Product documents/images are supporting detail content, not decorative table thumbnails by default.
- Pricing uses the four canonical lists and versioned backend data; UI must not flatten historical versions into four freely mutable floating-point fields.

### 15.4 Transportadoras

- The minimum canonical profile is intentionally small. The UI **MUST NOT** fabricate a logistics workflow around it.
- List identity: name and active/archived state. Notes belong in detail/edit; the canonical Phase 1 Carrier has no CNPJ, contact, or location fields.
- It is selected optionally in orçamento and excluded from new selectors after archive while remaining visible historically.

### 15.5 Orçamentos

- List defaults to operational triage: number, cliente, representative, status, created/validity dates, total, and actions.
- Status tabs/facets must use canonical quote states and role permissions.
- Detail and edit preserve immutable snapshots and expose only legal transitions. There is no reopen action; correction after sent uses duplicate when permitted.
- Approve/reject/cancel/convert actions use explicit consequence copy and permissions. PDF actions name whether they generate, preview, or download.

### 15.6 Pedidos

- List shows number, source orçamento, cliente, representative, status, created/updated operational date, total, and actions.
- No `Novo pedido` button exists because orders originate only from idempotent quote conversion.
- Detail is read-oriented: immutable commercial snapshot, status history, and attachments. Status transitions are explicit commands, not a generic editable Select.
- Attachment loading/upload/error states remain local to the attachment region and do not block reading the order.

### 15.7 Início, Relatórios, and Configurações

- Until dashboard contracts exist, `/app` is a concise authorized wayfinding/start surface; it **MUST NOT** show invented KPI data.
- When Phase 2 begins, Início follows Sections 6 and 10, and every KPI/chart definition needs owner, unit, time range, comparison, freshness, permission scope, and drill-down.
- Relatórios remains absent/disabled until report and export contracts exist. Disabled navigation is inferior to omission unless explaining an imminent capability is product-approved.
- Configurações groups account, business, access, and fixed-list settings only when implemented and authorized. Dangerous changes require AlertDialog and durable inline results.

## 16. Optional enhancements and explicit non-goals

### Optional after the base contract is proven

- Saved/favorited filtered views.[13]
- Detail preview/peek with adjacent-row keyboard navigation, only after canonical detail routes and focus restoration work.[12]
- Persisted sidebar collapse and, much later, route favorites.[1]
- Configurable KPI dashboard widgets.[5][15]
- Advanced nested AND/OR filters for demonstrated operational cases.[6][11]
- Sticky table header/first column after overflow and contrast testing.

### Not part of this specification

- Public landing changes.
- Dark mode, copied benchmark branding, proprietary screenshots/assets, decorative gradients, glass effects, oversized landing shadows, or animation bloat.
- A second UI kit, a packaged data grid replacing shared primitives, or a second form/toast system.
- Mobile bottom navigation, universal autosave, modal full-record editing, direct order creation, financial/fiscal workflows, or invented dashboard/report data.

## 17. Route screenshot and visual-QA contract

`docs/authenticated-app-screenshot-matrix.md` is the normative capture contract for this specification. It defines the current-versus-target route truth, deterministic roles and data, explicit 900px and 640px boundary widths, primary route captures, non-redundant state assignments, and gated Phase 2 KPI/chart evidence.

Screenshots **MUST NOT** substitute for behavioral tests of authorization, URL normalization, keyboard operation, focus return, live announcements, or server state. Conversely, a component-only fixture **MUST NOT** be accepted as route completion when it omits the authenticated shell, route loader, permissions, or URL-owned state.

## 18. Implementation acceptance checklist

A route is not complete until all applicable items pass:

- [ ] Uses the authenticated shell at the 900px breakpoint and matching mobile Sheet navigation.
- [ ] Has one `h1`, correct page hierarchy, and a reachable primary action.
- [ ] Uses semantic tokens, Jost/Newsreader roles, Phosphor-light icons, existing radii/easing, and no landing-only decoration.
- [ ] Implements populated, initial loading, background refresh, first-use empty, filtered empty, recoverable error, forbidden, and not-found states as applicable.
- [ ] Validates URL list state and restores it across list/detail navigation.
- [ ] Defines entity-specific columns, overflow behavior, mobile adaptation, and server ownership of sort/filter/pagination.
- [ ] Implements explicit create/edit/submission/dirty/error/success behavior.
- [ ] Enforces permission and workflow state in both UI affordances and server boundaries.
- [ ] Passes keyboard-only traversal, overlay focus return, route focus placement, visible focus, reduced motion, 200% zoom, 320px reflow, and automated accessibility checks.
- [ ] Implements the applicable primary and distinct variant captures in `docs/authenticated-app-screenshot-matrix.md`; avoids duplicate baselines that prove no new behavior.
- [ ] Uses no invented business data, status transition, KPI, report, or backend capability.
- [ ] Adds source-owned shadcn primitives only when this contract proves the need; no parallel abstraction or UI kit.

## Sources

[1] https://docs.twenty.com/user-guide/layout/capabilities/navigation
[2] https://docs.twenty.com/user-guide/layout/capabilities/record-pages
[3] https://docs.twenty.com/user-guide/views-pipelines/capabilities/table-views
[4] https://docs.twenty.com/user-guide/views-pipelines/capabilities/filters-and-sorting
[5] https://docs.twenty.com/user-guide/dashboards/overview
[6] https://www.odoo.com/documentation/19.0/applications/essentials/search.html
[7] https://www.odoo.com/documentation/19.0/applications/essentials/activities.html
[8] https://ui.shadcn.com/blocks
[9] https://ui.shadcn.com/docs/components/base/data-table
[10] https://linear.app/docs/search
[11] https://linear.app/docs/filters
[12] https://linear.app/docs/peek
[13] https://linear.app/docs/custom-views
[14] https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile
[15] https://docs.stripe.com/dashboard/basics
[16] https://docs.sentry.io/product/issues/issue-details/
[17] https://ui.shadcn.com/docs/components/base/sidebar
[18] https://ui.shadcn.com/docs/components/base/chart
[19] https://ui.shadcn.com/docs/components/base/empty
[20] https://ui.shadcn.com/docs/components/base/skeleton
[21] https://ui.shadcn.com/docs/components/base/alert
