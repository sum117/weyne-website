# Modern CRM and dashboard interaction benchmark

Accessed: 2026-08-17

## Scope and method

This benchmark is deliberately narrow: it records interaction concepts that can inform an authenticated Weyne application. It does **not** recommend copying product branding, proprietary assets, dark-theme styling, decorative effects, or adding another UI kit. The public Weyne landing page is out of scope.

Evidence came from current official documentation, official open-source references, and publicly accessible product guidance. “Transfer” below means the underlying hierarchy or behavior is useful; it does not mean visual imitation.

## Directional synthesis

1. **Use Linear's hierarchy as the primary interaction model.** Keep persistent destinations quiet, put view-specific controls next to the content they affect, and make frequent navigation/search actions keyboard-accessible. Linear separates workspace search from in-view search, encodes filters in shareable URLs, and saves filtered views.[10][11][13]
2. **Use Stripe's clarity as the primary content model.** Lead with account-level outcomes, keep high-value notices close to the overview, and make list-to-detail relationships explicit. Stripe documents a stable primary sidebar, customizable overview widgets, filtered/exportable transaction lists, and customer rows that open complete customer histories.[15]
3. **Use shadcn as composable source primitives, not as a visual template.** Its dashboard block composes a sidebar, context header, KPI cards, chart, and data table; its table guide explicitly treats each data table as use-case-specific rather than forcing one universal component.[8][9]

## Actionable findings

| Concept | Transferable pattern for Weyne | Why it transfers | Caveat | Evidence |
| --- | --- | --- | --- | --- |
| Information hierarchy | Use three stable levels: application destinations in the sidebar; page identity, breadcrumbs, and primary action in a compact context bar; filters, tabs, and view controls immediately above the working surface. | It keeps “where am I?”, “what can I do?”, and “what subset am I viewing?” visually distinct. Linear's documentation itself separates sidebar domains from find/filter tools, while Stripe separates account navigation from page-level lists and details.[10][11][15] | Do not reproduce Linear's density or Stripe's product taxonomy; Weyne's navigation must reflect its own routes and roles. | Linear search/filters; Stripe web dashboard |
| Desktop navigation | Keep a persistent left sidebar with a visible active destination, grouped labels, and a controlled collapse mode. Allow personal favorites only if Weyne eventually has enough destinations to justify them. Twenty supports per-user ordering, folders, hidden items, favorites, and a command menu; shadcn's source sidebar exposes header/content/footer/rail/inset/trigger as separate parts and supports a keyboard toggle.[1][17] | A stable sidebar reduces route switching cost in data-heavy work, while composable parts let Weyne preserve its own tokens and Phosphor icons. | Custom ordering and folders add state and governance cost; defer them until route volume makes a fixed information architecture insufficient. | Twenty navigation; shadcn Sidebar |
| Mobile navigation | Replace the desktop sidebar with a Sheet-style navigation opened from the context bar; preserve the same destination order and labels. Reserve a bottom bar only for a very small set of daily actions validated by usage. Linear Mobile allows users to prioritize and pin frequently used destinations in a bottom toolbar.[14] | A Sheet preserves desktop information architecture without squeezing labels into icons; the Linear reference shows the value of prioritizing frequent mobile destinations. | Do not copy Linear's customizable bottom bar in the first release. Customization can hide critical Weyne destinations and increases persistence complexity. | Linear Mobile navigation; shadcn Sidebar/Sheet composition |
| Context bar | Keep the bar short and route-specific: sidebar trigger, breadcrumb or page title, optional scope/status, then one primary action and a compact overflow. The shadcn sidebar block pairs a trigger, separator, and responsive breadcrumb above the content inset.[8] | It makes navigation and current task context available without competing with the data surface. | Hide ancestral breadcrumb segments on narrow screens; never wrap the primary action into an ambiguous icon-only control. | shadcn blocks (`sidebar-07`, `sidebar-03`) |
| KPI cards | Show only decision-driving metrics, ideally 3–4 at once, with label, current value, comparison period, and restrained trend treatment. Twenty recommends starting with a few actionable metrics, and Stripe places business analytics plus important unresolved notices on the overview.[5][15] | Weyne operators need a fast health scan before opening detailed lists. | A KPI card is not a miniature report. Avoid vanity metrics, unlabeled percentages, and color-only meaning. Personalizable widgets are a later-stage feature, not a first-release requirement. | Twenty dashboards; Stripe web dashboard |
| Status tabs | Use tabs for stable, mutually exclusive workflow states with counts when they aid triage; keep ad-hoc criteria in filters. Within detail pages, use tabs to separate coherent record domains such as overview, activity, related records, and files. Twenty documents record tabs and widgets, while Odoo uses consistent due-state semantics across activity views.[2][7] | Tabs make common states scannable and predictable; filters remain available for less common combinations. | Tabs must not duplicate sidebar routes or become a second navigation tree. Counts need an explicit scope and must update with the same filters as the list. | Twenty record pages; Odoo activities |
| Search model | Provide two named scopes: global search for cross-entity navigation and in-view search for the current list. Make scope visible in placeholder text and preserve the query when opening and returning from a record. Linear uses `/` for workspace search and Cmd/Ctrl+F for current-view search, with Escape clearing the in-view query.[10] | Sales users switch between “find this account anywhere” and “narrow what I am already reviewing”; combining both behaviors in one field is ambiguous. | Do not promise fuzzy search, full-text comments, or 500-result behavior unless Weyne's backend actually supports it. | Linear search |
| Faceted filtering | Put common facets in a searchable filter popover, render active criteria as removable chips, expose “clear all,” and store filter state in the URL. Offer saved views only after the base model is stable. Linear updates views immediately, supports searchable properties, AND/OR groups, and shareable URL state; Twenty documents typed operators and saved view variants; Odoo demonstrates type-aware values, nested AND/OR rules, grouping, favorites, and shared searches.[4][6][11] | CRM users repeatedly slice by status, owner, territory, date, and related entity; visible chips and URLs make the result understandable and shareable. | Start with comprehensible AND behavior and a small facet set. Nested boolean builders are powerful but expensive to explain, validate, and support. | Linear filters; Twenty filters; Odoo search/filter/group |
| Data tables | Build tables per entity from shared primitives: explicit column definitions, sorting, filtering, pagination, column visibility, row selection, and contextual row actions. Preserve a useful first column when horizontal overflow is unavoidable. shadcn explicitly recommends use-case-specific tables and demonstrates all of those behaviors, including a “No results” row; Twenty supports column show/hide, resize, reorder, grouping, and large-dataset scanning.[3][9] | Weyne can reuse behavior and accessibility contracts without forcing every entity into one oversized “universal” component. | Do not import another table kit. Decide server/client ownership for sort, filter, and pagination per route; do not expose controls the data source cannot honor. | shadcn Data Table; Twenty Table Views |
| List → detail flow | Make the row's primary label open the full record and keep secondary actions in a labeled overflow menu. Preserve list query, filter, sort, page, and scroll state on return. For high-frequency review, consider an optional preview panel after the base flow is proven. Stripe's customer list opens a detailed customer history; Linear Peek previews details while arrow keys move through adjacent list items.[12][15] | Users can inspect many accounts or opportunities without repeatedly rebuilding their working set. | Preview is enhancement, not a replacement for a canonical detail route; it needs robust focus management and must not hide critical actions. | Linear Peek; Stripe customers |
| Detail pages | Lead with record identity, status, owner, and primary action; organize the rest into overview, activity timeline, related records, and supporting files/notes. Sentry's issue detail uses a high-level header, filtered graph, contextual sidebar, and deep event content; Twenty composes tabs from fields, relations, timeline, tasks, notes, files, and charts.[2][16] | A representative or manager needs the current state first and evidence/history second. | Sentry is intentionally information-dense; Weyne should copy its progressive disclosure, not its debugging-specific volume or layout. | Twenty record pages; Sentry issue details |
| Create/edit flow | Keep creation focused on the minimum valid fields; reveal secondary sections after identity and status are established. Use one clear submit action, inline field errors, and a page-level error summary or alert for failures. Odoo's activity form begins with type, summary, due date, assignee, and note before optional scheduling behavior; shadcn provides composable Alert content with an explicit action.[7][21] | Short forms improve capture speed while still permitting richer follow-up data in edit/detail views. | Do not infer automatic save from Odoo. Weyne must choose and communicate either explicit save or autosave consistently, including dirty-state and failure behavior. | Odoo activities; shadcn Alert |
| Charts | Use line/area for time trends, bars for category comparison, and aggregate cards for a single value. Always show title, scope, period, units, and a text/table path to exact values. shadcn's chart primitive remains compositional over Recharts, centralizes human-readable labels and color tokens, and requires a measurable container for responsiveness; Sentry updates counts and graphs from the same search/environment/time scope.[16][18] | Weyne can keep charts subordinate to decisions and synchronized with the surrounding filters. | Avoid decorative pies, gauges, dual axes, and excessive series. Do not add Recharts merely because the reference uses it; first check the authenticated app's existing dependencies and chart needs. | shadcn Chart; Sentry issue details |
| Keyboard behavior | Support standard Tab/Shift+Tab, Enter/Space activation, Escape dismissal, and arrow navigation within menus/tabs. Add only discoverable app shortcuts: global search, in-view search, sidebar toggle, and optionally create. Linear documents search and clearing behavior, Stripe exposes a `?` shortcut reference, and shadcn Sidebar documents Cmd/Ctrl+B.[10][15][17] | A small, coherent set accelerates repetitive CRM work without making keyboard use mandatory. | Never override browser/editor conventions; show shortcut hints in tooltips or menus and provide a visible help surface before adding sequences. | Linear, Stripe, shadcn Sidebar |
| Responsive behavior | At the app breakpoint, swap the sidebar for a Sheet, collapse breadcrumbs to the current page, stack KPI cards, and move low-priority table columns into row detail or controlled horizontal overflow. Keep the primary action and active filters reachable without horizontal scrolling. shadcn's dashboard block changes gaps/padding by breakpoint and its Sidebar exposes separate desktop/mobile widths; Linear Mobile prioritizes a small set of destinations.[8][14][17] | This preserves task continuity instead of treating mobile as a scaled-down desktop table. | Exact breakpoints must come from Weyne's existing token system and content stress tests, not copied pixel values. Mobile data tables may require a list/card representation when comparison across columns is no longer the primary task. | shadcn blocks/Sidebar; Linear Mobile |
| Empty states | Distinguish “no records yet” from “no results for current filters.” For first-use emptiness, explain the value and offer one primary create/import action; for filtered emptiness, echo the query/facets and offer clear filters. shadcn's Empty composition separates media, title, description, and action, while its Data Table demonstrates an explicit no-results row.[9][19] | The user can tell whether to create data or change the current view. | Avoid decorative illustrations and multiple competing CTAs. Permission-restricted emptiness must say that access, not absence, is the cause. | shadcn Empty and Data Table |
| Loading states | Preserve the destination's structure with localized skeletons for cards, rows, and detail sections; keep the context bar and existing filters interactive when possible. shadcn defines Skeleton as a loading placeholder and demonstrates card/text/avatar composition.[20] | Stable geometry reduces layout shift and maintains orientation during route or filter changes. | Skeletons should match real content geometry and stop promptly; use a small spinner only for indeterminate action-local waits. Never present stale KPI values as newly loaded. | shadcn Skeleton |
| Error states | Keep recoverable errors in context with a plain-language title, consequence, and a retry or corrective action. Preserve entered form data and current filters. shadcn Alert composes icon, title, description, and action and includes a destructive failure variant.[21] | Users can recover without losing their working set or wondering whether a mutation succeeded. | Toasts alone are insufficient for blocking load/save failures. Do not use destructive color for warnings or empty states; provide a trace/reference ID only when support can use it. | shadcn Alert |

## What to carry into the UX specification

### Required defaults

- Persistent desktop sidebar; mobile Sheet replacement; one compact route context bar.
- A maximum of one visually dominant primary action per page region.
- Global search and in-view search as distinct, labeled scopes.
- URL-backed list state for query, filters, sort, page, and selected status tab.
- Entity-specific tables composed from shared Weyne/shadcn primitives.
- Canonical list → detail → create/edit routes with list-state restoration.
- Synchronized chart, count, tab, and table scopes; no unlabeled metrics.
- Explicit first-use empty, filtered-empty, loading, and recoverable-error states.
- Visible focus, complete keyboard reachability, Escape dismissal, and discoverable shortcuts.

### Conditional enhancements

- Saved/favorited views after filter semantics stabilize.
- Detail preview/peek after canonical detail routes and focus behavior are proven.
- Sidebar personalization only when route volume warrants it.
- User-configurable KPI widgets only after a stable default overview exists.
- Advanced nested AND/OR filters only for demonstrated operational need.

## Transfer guardrails

- Preserve Weyne's existing palette, typography, spacing, easing, shadows, Phosphor icons, Tailwind v4 CSS-first tokens, and shadcn source-component approach.
- Do not copy Linear's or Sentry's dark visual treatment, Stripe's brand language, Odoo's product taxonomy, Twenty's icons/assets, or any proprietary product screenshots.
- Do not install a second UI kit. Translate the behaviors into existing primitives and add only narrowly scoped source components when a proven interaction requires them.
- Treat every cited surface as evidence of a pattern, not as permission to reproduce its visual identity.

## Source table

All sources were accessed on **2026-08-17**.

| ID | Product / official surface | Exact URL |
| --- | --- | --- |
| [1] | Twenty — Navigation | https://docs.twenty.com/user-guide/layout/capabilities/navigation |
| [2] | Twenty — Record Pages | https://docs.twenty.com/user-guide/layout/capabilities/record-pages |
| [3] | Twenty — Table Views | https://docs.twenty.com/user-guide/views-pipelines/capabilities/table-views |
| [4] | Twenty — Filters & Sorting | https://docs.twenty.com/user-guide/views-pipelines/capabilities/filters-and-sorting |
| [5] | Twenty — Dashboards | https://docs.twenty.com/user-guide/dashboards/overview |
| [6] | Odoo 19 — Search, filter, and group records | https://www.odoo.com/documentation/19.0/applications/essentials/search.html |
| [7] | Odoo 19 — Activities | https://www.odoo.com/documentation/19.0/applications/essentials/activities.html |
| [8] | shadcn/ui — Blocks (dashboard/sidebar references) | https://ui.shadcn.com/blocks |
| [9] | shadcn/ui — Data Table | https://ui.shadcn.com/docs/components/base/data-table |
| [10] | Linear — Search | https://linear.app/docs/search |
| [11] | Linear — Filters | https://linear.app/docs/filters |
| [12] | Linear — Peek preview | https://linear.app/docs/peek |
| [13] | Linear — Custom Views | https://linear.app/docs/custom-views |
| [14] | Linear — Mobile navigation changelog | https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile |
| [15] | Stripe — Web Dashboard | https://docs.stripe.com/dashboard/basics |
| [16] | Sentry — Issue Details | https://docs.sentry.io/product/issues/issue-details/ |
| [17] | shadcn/ui — Sidebar | https://ui.shadcn.com/docs/components/base/sidebar |
| [18] | shadcn/ui — Chart | https://ui.shadcn.com/docs/components/base/chart |
| [19] | shadcn/ui — Empty | https://ui.shadcn.com/docs/components/base/empty |
| [20] | shadcn/ui — Skeleton | https://ui.shadcn.com/docs/components/base/skeleton |
| [21] | shadcn/ui — Alert | https://ui.shadcn.com/docs/components/base/alert |

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
