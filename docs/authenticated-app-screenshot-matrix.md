# Weyne authenticated app screenshot matrix

**Status:** normative capture contract for implementation review and visual QA

**Scope:** authenticated application only; the public `/` landing page remains outside this matrix

**UI language:** pt-BR

**Business timezone:** `America/Fortaleza`

## 1. Authority and current route truth

This matrix operationalizes `docs/authenticated-app-ux-spec.md`. The UX specification and the canonical domain contract define target behavior; screenshots prove that an implementation renders that behavior at a named viewport and deterministic data state. Screenshots do not create a route, permission, metric, or workflow rule.

At review time, the generated route tree exposes these authenticated URLs:

| URL | Current classification | Screenshot implication |
| --- | --- | --- |
| `/app` | Implemented runtime/start placeholder, not the target authenticated shell | May be captured as implementation evidence, but must not be accepted as shell parity. |
| `/app/produtos` | Implemented early catalog surface with empty route data | Component fixtures may validate product behavior; the route is not complete until it uses the shared shell and server-backed canonical data. |
| `/app/relatorios` | Implemented experimental Phase 2 report surface | Keep out of Phase 1 navigation and release acceptance. It may be captured only as a labelled experimental fixture against the Phase 2 metric contract. |

All other paths below are target route contracts. A row becomes an executable screenshot requirement when its route is implemented. Until then it is a downstream implementation/QA fixture specification, not evidence that the route exists.

## 2. Capture protocol

Every accepted capture MUST:

1. use Chromium with `locale: pt-BR`, `timezoneId: America/Fortaleza`, light color scheme, device scale factor 1, and reduced motion;
2. wait for fonts, route loaders, and the intended stable state; disable animation and transition duration without hiding content;
3. use the named fixture and role projection below; freeze dates, IDs, ordering, and generated numbers;
4. exclude the browser chrome and avoid masks unless a separately documented nondeterministic third-party surface makes one unavoidable;
5. use full-page capture for ordinary routes and viewport capture for portalled overlays, sticky behavior, or focus/overflow evidence;
6. include the shell unless the row is explicitly a component fixture;
7. preserve visible focus in keyboard-state captures and never use hover as the only way to reveal an action;
8. be reviewed before a baseline update. A changed baseline is evidence to inspect, not an automatic fix.

For each executable row, visual comparison runs twice after a baseline update. Both passes MUST match. Keyboard, focus return, live-region announcements, URL normalization, authorization, and server behavior still require behavioral tests; a screenshot is only the visual evidence named in the matrix.

## 3. Viewport set

The existing `--breakpoint-nav` at 900 CSS px and the content adaptation at 640 CSS px are the boundaries. The canonical set intentionally uses one representative width per mode plus boundary pairs only where a behavior changes.

| ID | Viewport | Purpose |
| --- | ---: | --- |
| `D1440` | 1440 × 1000 | Wide desktop: expanded 264px sidebar, 32px gutter, full useful columns, 3–4 KPI columns when Phase 2 applies. |
| `D1024` | 1024 × 900 | Compact desktop: collapsible sidebar, 24px gutter, controlled table overflow. |
| `NAV900` | 900 × 900 | Inclusive desktop side of the navigation breakpoint. Shell-only boundary evidence. |
| `NAV899` | 899 × 900 | Mobile-Sheet side of the navigation breakpoint. Shell-only boundary evidence. |
| `T768` | 768 × 1024 | Intermediate layout: Sheet navigation, reduced table columns, selective two-column forms. |
| `CONTENT640` | 640 × 900 | Inclusive intermediate side of the content breakpoint. Representative-route boundary evidence. |
| `CONTENT639` | 639 × 900 | Stacked mobile side of the content breakpoint. Representative-route boundary evidence. |
| `M390` | 390 × 844 | Canonical phone: 16px gutters, stacked records/forms, touch targets, Sheet navigation. |
| `MIN320` | 320 × 800 | Minimum reflow stress test: no clipped essential content or page-level two-dimensional scroll. |

`D1440`, `T768`, and `M390` are the ordinary route widths. `D1024` is added only for desktop overflow or dense forms. `NAV900/NAV899` are captured once against the shared shell, not once per route. `CONTENT640/CONTENT639` are captured once per distinct adaptation pattern (list, form, KPI/chart), not once per entity. `MIN320` is a stress capture for the shell, quote line editor, and the densest representative route.

At 200% browser zoom, run behavioral reflow checks at a 1280px physical viewport (640 CSS px) and at a 640px physical viewport (320 CSS px). Do not create duplicate image baselines when `CONTENT640` and `MIN320` already show the same settled geometry; retain zoom as test evidence.

## 4. Canonical actors and deterministic data

| Fixture | Canonical setup | Purpose |
| --- | --- | --- |
| `ADMIN` | Admin user “Ana Martins”; all records and F1/F2/workflow projections; create/archive/restore and legal workflow actions enabled. | Full management affordances and destructive/validation variants. |
| `REP` | Representative “Carolina Weyne”; owns/has assignment only to the named Cliente Alpha records; F1 visible in owned commercial documents; commission and credit limit hidden. | Permission-filtered navigation, lists, detail, quote creation/edit, and redaction. |
| `REP_EMPTY` | Representative “João Silva”; no owned or assigned customers, quotes, or orders; active catalog remains readable under the canonical projection. | Genuine first-use commercial-list and wayfinding states without contradicting `REP` data. |
| `READ` | Read-only user “Rafael Lima”; explicit assignment to one customer, quote, and order; operational/status projection only; no mutations, attachments, F1, or F2. | Restricted controls and redacted detail without pretending data is empty. |
| `CATALOG_DENSE` | 31 active synthetic products across at least 3 industries and all four price lists; 1 archived product visible only to `ADMIN`; long code/description and one missing current price. The first four stable records are `PROD-001` “Detergente concentrado profissional 5 L”, `PROD-002` “Papel toalha interfolhado premium”, `PROD-003` “Álcool antisséptico 70%”, and `PROD-004` “Sabonete líquido neutro 5 L”. | Pagination, sorting, facets, long text, overflow, archive state, and price availability. |
| `CUSTOMERS_MIXED` | 26 active customers across PE/PB/CE and multiple segments/representatives; one archived customer for `ADMIN`; one customer with long legal name and no optional contact data. | Search/facets, pagination, missing values, archive, and long labels. |
| `QUOTE_WORKFLOW` | One quote in each canonical state (`draft`, `sent`, `approved`, `rejected`, `expired`, `converted`, `cancelled`); deterministic numbers `ORC-2026-000041` onward. Draft has 8 lines and one line error. Sent `ORC-2026-000042` has 12 immutable lines at positions 1–12, cycling `PROD-001`…`PROD-004` three times while retaining each product's fixed unit/packaging. Quantity is the position as a six-place Decimal string. Unit prices cycle `10.000000`, `20.000000`, `30.000000`, `40.000000`; line and overall discount rates and freight are zero; tax snapshot arrays are empty. Line totals are `10.00`, `40.00`, `90.00`, `160.00`, `50.00`, `120.00`, `210.00`, `320.00`, `90.00`, `200.00`, `330.00`, `480.00`; gross/net/grand total is `2100.00`. | Status tabs, legal actions, quote editor, overflow, immutable detail, filtered results. |
| `ORDER_WORKFLOW` | One order in each canonical state (`open`, `confirmed`, `invoiced`, `completed`, `cancelled`), sourced from distinct quotes now in `converted`; deterministic numbers `PED-2026-000011` onward. The open order copies the same 12-line Decimal snapshot pattern and `2100.00` total defined in `QUOTE_WORKFLOW`, has three ordered history events, and attachments `pedido-cliente-alpha.pdf` (1.2 MB), `comprovante-entrega.jpg` (860 KB), and `observacoes.txt` (2 KB). | Read-oriented detail, explicit transitions, attachment locality, overflow. |
| `REPORT_JUL_2026` | Exact July 2026 fixture from `docs/domain/reporting-metric-contract.md`; 3 reportable orders, 2 customers, BRL 600.015000 sales and 30.015000 commission before presentation rounding. | Experimental Phase 2 KPI/chart/table reconciliation only. |

Use reserved `.example` email domains and obviously synthetic phone/tax identifiers in fixtures. Values MUST satisfy the canonical schemas but MUST NOT be presented as real Weyne customer data. Decimal values travel as canonical strings and display in pt-BR.

## 5. Shared shell and cross-cutting captures

These rows cover behavior shared by every authenticated route and therefore MUST NOT be duplicated for each page.

| ID | Surface | Viewport | Data/role | Primary capture | Meaningful variants |
| --- | --- | --- | --- | --- | --- |
| `SHELL-01` | Desktop shell | `D1440` | `ADMIN` | Expanded 264px navy sidebar, active Início item, grouped destinations, 64px context bar, breadcrumb, account footer, and one primary action. | `D1024` collapsed 72px rail with tooltips and visible focus on an icon destination. |
| `SHELL-02` | Navigation breakpoint | `NAV900`, `NAV899` | `REP` | Paired captures proving desktop sidebar at 900px and Sheet trigger/no desktop sidebar at 899px. | No per-route repetition. |
| `SHELL-03` | Mobile navigation | `M390`, viewport capture | `REP` | Open left Sheet with active destination, matching order/labels, internal nav scroll, account footer, overlay, and focus inside. | `MIN320` open Sheet; post-close focus on `Abrir navegação` is behavioral evidence plus a focused-trigger capture. |
| `SHELL-04` | Permission-aware navigation | `D1440` | `READ` | Restricted destination/action set and read-only account role; no admin-only controls. | Forbidden direct-route state is covered by `SET-02`, not by a second sidebar image. |
| `SHELL-05` | Long context | `M390` | `ADMIN` | Truncated long breadcrumb/current label, visible full-text primary action, no horizontal page scroll. | Overflow menu open with destructive item separated and inside viewport. |
| `A11Y-01` | Keyboard focus | `D1024` | `ADMIN` | Visible focus on sidebar trigger, then representative list search/sort/row menu states as separate element crops or named captures. | Tabs, Popover/Command, AlertDialog safe cancel, and Sheet focus are captured only on their owning representative rows. |
| `A11Y-02` | Minimum reflow | `MIN320` | `READ` | Shell plus densest read-only detail with one-column content, reachable controls, unclipped focus, and no page-level horizontal scroll. | 200% zoom is behavioral evidence as described in Section 3. |

## 6. Phase 1 route matrix

“Primary” is the default accepted baseline. Variants are additional baselines only when they prove distinct geometry, state, permission, or interaction. Generic initial loading, fetch error, forbidden, and not-found anatomy is assigned to representative routes in Section 7 and then tested behaviorally on every route; do not generate identical skeleton/Alert screenshots for every entity.

### 6.1 Início

| Route | Viewport(s) | Canonical setup | Primary screenshot | Meaningful variants |
| --- | --- | --- | --- | --- |
| `/app` | `D1440`, `M390` | `REP`; Phase 1 modules available according to permission | Concise authenticated wayfinding surface inside the full shell; no invented KPIs or charts. | First-run guidance with `REP_EMPTY`; shell loading while identity/permissions resolve. Current runtime placeholder is implementation evidence only, not this acceptance baseline. |

### 6.2 Clientes

| Route | Viewport(s) | Canonical setup | Primary screenshot | Meaningful variants |
| --- | --- | --- | --- | --- |
| `/app/clientes` | `D1440`, `M390` | `CUSTOMERS_MIXED`, `ADMIN` | Populated list with search, status/facets, active result count, entity columns, pagination, and create action; mobile uses stacked records. | First-use empty (`REP_EMPTY`); filtered empty with echoed query/facets and `Limpar filtros`; populated filtered result; `T768` reduced columns; row overflow open; archived filter for `ADMIN`. |
| `/app/clientes/novo` | `D1024`, `M390` | `REP`, empty valid defaults | Dense-but-breathable create form with minimum identity first and explicit `Criar cliente`. | Submit validation summary + inline errors with first invalid field focused; server save error preserving values; submitting state; `CONTENT640/CONTENT639` form adaptation. |
| `/app/clientes/$customerId` | `D1440`, `M390` | Cliente Alpha from `CUSTOMERS_MIXED`, `ADMIN` | Identity/status, contact/address, representative, related documents, and admin audit visibility. | `READ` redaction; long notes/missing optional values; archive AlertDialog open with safe cancel focus; local related-record empty; representative fetch error. |
| `/app/clientes/$customerId/editar` | `D1024`, `M390` | Active Cliente Alpha, `ADMIN` | Populated edit form with explicit save/cancel and stable action region. | Dirty-navigation confirmation; stale-data conflict; archived record read-only/no edit route; successful result focus is behavioral evidence. |

### 6.3 Indústrias

| Route | Viewport(s) | Canonical setup | Primary screenshot | Meaningful variants |
| --- | --- | --- | --- | --- |
| `/app/industrias` | `D1440`, `M390` | 12 active and 2 archived industries, `ADMIN`; long brand/name | Populated list with legal/trade name, optional brand/tax ID, active/archive facet, and efficiently available product count. | Search result; filtered empty; archive filter; mobile stacked records. Reuse generic list loading/error anatomy. |
| `/app/industrias/nova` | `D1024`, `M390` | `ADMIN` | Create form with legal identity, optional trade name, tax ID, address, notes, brand, and logo; no invented contact or commission field. | Required-name validation and duplicate tax-ID server error. |
| `/app/industrias/$industryId` | `D1440`, `M390` | Industry A with active products, `ADMIN` | Identity, active catalog metadata, related products, and admin-only commission context where canonical. | Empty related products; archived historical label; restricted non-admin projection. |
| `/app/industrias/$industryId/editar` | `D1024` | Active Industry A, `ADMIN` | Populated edit groups and permitted archive action. | Archive blocked by integrity conflict; dirty guard. Mobile form behavior is already proven by Clientes. |

### 6.4 Produtos

| Route | Viewport(s) | Canonical setup | Primary screenshot | Meaningful variants |
| --- | --- | --- | --- | --- |
| `/app/produtos` | `D1440`, `T768`, `M390` | `CATALOG_DENSE`, `ADMIN` | Populated catalog with code/description, industry, unit, active state, relevant price availability, filters, sorting, pagination, and per-row actions. | `D1024` controlled table overflow with focus ring visible; long text; missing current price; archived filter; filtered result; first-use empty; initial loading and recoverable error as representative generic captures. |
| `/app/produtos/novo` | `D1024`, `M390` | `ADMIN` | Create form with identity, industry, unit, optional catalog/tax fields, and asset sections subordinate to identity. | Validation with conditional dimension unit; asset upload error localized; duplicate internal code. |
| `/app/produtos/$productId` | `D1440`, `M390` | Active product with image, technical sheet, four current prices, `ADMIN` | Product identity, catalog facts, assets, current price-list values, and admin actions. | `REP` without commission; `READ` without prices; archived historical state; missing asset/current price. |
| `/app/produtos/$productId/editar` | `D1024` | Active product, `ADMIN` | Populated edit form with pricing/version actions visually separated from operational fields. | Price update validation/server conflict; destructive archive confirmation. Mobile field adaptation reuses the product-create capture. |

### 6.5 Transportadoras

| Route | Viewport(s) | Canonical setup | Primary screenshot | Meaningful variants |
| --- | --- | --- | --- | --- |
| `/app/transportadoras` | `D1440`, `M390` | 8 active and 1 archived carriers, `ADMIN` | Intentionally small list profile: name, active state, search, and archive facet. | First-use empty; filtered empty; mobile records. Do not add CNPJ/contact/location columns, logistics KPIs, or workflow. |
| `/app/transportadoras/nova` | `D1024`, `M390` | `ADMIN` | Minimal create form matching the canonical carrier fields. | Required-name and duplicate normalized-name errors. |
| `/app/transportadoras/$carrierId` | `D1440` | Carrier used by historical quote, `ADMIN` | Compact identity/detail and related historical reference without invented operations. | Archived state; not-found representative capture (`STATE-04`). |
| `/app/transportadoras/$carrierId/editar` | `D1024` | Active carrier, `ADMIN` | Minimal populated edit form. | Dirty guard; archive confirmation. Other responsive form geometry is already covered. |

### 6.6 Orçamentos

| Route | Viewport(s) | Canonical setup | Primary screenshot | Meaningful variants |
| --- | --- | --- | --- | --- |
| `/app/orcamentos` | `D1440`, `M390` | `QUOTE_WORKFLOW`, `ADMIN` | Operational list with canonical status tabs/counts, number, customer, representative, dates, total, pagination, and actions. | Filtered `sent` result; filtered empty; status-tab keyboard focus; search/facet Popover open with no matches; row overflow; `READ` projection without F1; background refresh retaining rows. |
| `/app/orcamentos/novo` | `D1440`, `M390`, `MIN320` | `REP`; active owned customer; 8-line draft setup | Full create flow with customer/price list/carrier fields, searchable product picker, line editor, totals, and explicit create action. Mobile lines become labeled stacks and totals follow the list. | Product picker open/search result; line validation + summary; no current price; server save error preserving 8 lines; submitting; long-line overflow; dirty guard. |
| `/app/orcamentos/$quoteId` | `D1440`, `M390` | Sent quote from `QUOTE_WORKFLOW`, `ADMIN` | Number/status/customer/representative/validity/list/carrier, immutable lines and totals, timeline, and explicit PDF/actions. | Draft legal actions; approved convert confirmation; rejected/cancelled reason; converted order link; PDF generation/loading/error local state; `READ` redaction; 12-line desktop overflow. |
| `/app/orcamentos/$quoteId/editar` | `D1440`, `M390` | Draft quote, `REP` | Populated editable line editor with current snapshots and permitted controls only. | `ADMIN` manual-price/discount controls with reason; quote changed from draft conflict; non-draft route-level unavailable state; line removal confirmation with safe focus. |

### 6.7 Pedidos

| Route | Viewport(s) | Canonical setup | Primary screenshot | Meaningful variants |
| --- | --- | --- | --- | --- |
| `/app/pedidos` | `D1440`, `M390` | `ORDER_WORKFLOW`, `ADMIN` | List with number, source quote, customer, representative, canonical status, operational date, total, and row actions; no create button. | Status-filter result; filtered empty; `READ` redacted totals; long source/number; mobile stacked records. |
| `/app/pedidos/$orderId` | `D1440`, `M390` | Open order with 12 lines/history/attachments, `ADMIN` | Read-oriented immutable commercial snapshot, source quote, status/history, explicit legal commands, and attachment region. | `REP` limited actions/no commission; `READ` no F1/attachments; confirmed/invoiced/completed/cancelled action sets; attachment upload progress/error localized; long line-item overflow; cancellation AlertDialog. |

There is no `/app/pedidos/novo` or free-form order edit route. A screenshot fixture or navigation affordance for either path is a defect.

### 6.8 Configurações

| Route | Viewport(s) | Canonical setup | Primary screenshot | Meaningful variants |
| --- | --- | --- | --- | --- |
| `/app/configuracoes` | `D1440`, `M390` | `ADMIN` | Authorized settings index grouping account, business, access, and fixed-list settings that actually exist. | Long subsection navigation; save success; no unrelated entity CRUD. |
| `/app/configuracoes/$section` | `D1024`, `M390` | `ADMIN`; representative/user or fixed price-list metadata section | Dense form/list appropriate to the named section with durable inline result. | Validation; destructive/disable confirmation; conflict; permission-limited direct access (`STATE-05`). Only implemented subsections receive baselines. |

## 7. Representative state and interaction assignment

This table prevents a combinatorial baseline suite while ensuring every required state has visual evidence. Every route still needs behavioral coverage for applicable states.

| ID | Required behavior | Owning capture | Additional test obligation |
| --- | --- | --- | --- |
| `STATE-01` | Initial loading geometry | `/app/produtos`, `D1440` | Assert shell/context stable and list region `aria-busy`. |
| `STATE-02` | Recoverable fetch error | `/app/produtos`, `D1440` | Retry restores/announces region without losing URL state. |
| `STATE-03` | First-use vs filtered empty | `/app/clientes`, `D1440` | Verify distinct copy/action and toolbar focus retention. |
| `STATE-04` | Route not found | `/app/transportadoras/$carrierId`, `D1440` | Focus route heading and expose safe return link. |
| `STATE-05` | Forbidden/permission-limited | `/app/configuracoes/$section`, `D1440`, `READ` | No leaked settings details; safe destination. |
| `STATE-06` | Form validation/save error/submitting | `/app/clientes/novo`, `D1024` | Error-summary links, `aria-invalid`, value preservation, duplicate-submit prevention. |
| `STATE-07` | Background refresh | `/app/orcamentos`, `D1440` | Keep prior rows, focus, toolbar, and scroll; settled count announcement. |
| `STATE-08` | Destructive dialog | `/app/clientes/$customerId`, `T768` | Safe cancel initial focus, trap/Escape/return, server error retained in dialog. |
| `STATE-09` | Searchable facet states | `/app/orcamentos`, `D1440` | Open, loading, no options, no matches, selected; keyboard arrows/Escape/focus return. |
| `STATE-10` | Status tab overflow/keyboard | `/app/orcamentos`, `M390` | Horizontal cue, no wrapping; Radix arrow semantics and URL ownership. |
| `STATE-11` | Table overflow and focus | `/app/produtos`, `D1024` | Table-only horizontal scroll; no page scroll; focused action and primary identity remain reachable. |
| `STATE-12` | Mobile stacked list | `/app/clientes`, `M390` | Semantic list/articles, labels, status, 2–3 decision fields, and action reachability. |
| `STATE-13` | Quote line responsive editor | `/app/orcamentos/novo`, `M390` and `MIN320` | Add/remove focus placement, Decimal input, no clipped errors/actions. |
| `STATE-14` | Redacted projection | Quote/order detail, `READ` | Assert F1/F2, attachments, actors/notes are absent as required—not visually blank placeholders. |

## 8. Later-phase dashboard and reports matrix

These captures are gated. They MUST NOT be used to justify Phase 1 navigation or invented production data. Execute them only after the corresponding Phase 2 route/data contract is enabled, or label them clearly as experimental component fixtures.

| Route/surface | Viewport(s) | Canonical setup | Primary screenshot | Meaningful variants |
| --- | --- | --- | --- | --- |
| `/app` dashboard mode | `D1440`, `T768`, `M390` | Approved dashboard metrics derived from one synchronized snapshot; not yet defined by Phase 1 | 3–4 decision-driving KPI cards plus approved chart/list using identical scope, dates, freshness, units, and drill-down. | Geometry-matched loading; unavailable metric (never fake zero); empty period; chart error; `CONTENT640/CONTENT639` KPI adaptation. |
| `/app/relatorios` | `D1440`, `M390` | `REPORT_JUL_2026`, `ADMIN` | Report tabs, explicit date/status/representative scope, reconciled KPI cards, and a horizontal sales-by-industry bar chart: Indústria A `300.010000`, Indústria B `300.005000`, with the same exact values in the adjacent table. | `REP` scope; `READ` without commission; filtered empty; recoverable error; chart tooltip/keyboard summary; mobile exact-value table as primary representation. |


The July fixture MUST reconcile to `docs/domain/reporting-metric-contract.md`: 3 reportable orders, 2 customers, BRL `600.015000` sales and `30.015000` commission before display rounding; rendered sales are `R$ 600,02`. `READ` receives no commission.

## 9. Coverage audit against the UX specification

| Requested area | Matrix evidence |
| --- | --- |
| Desktop sidebar and top context bar | `SHELL-01`, `SHELL-02`, `SHELL-05` |
| Mobile Sheet navigation | `SHELL-02`, `SHELL-03` |
| KPI cards and charts | Gated Phase 2 dashboard/report rows; explicitly absent from Phase 1 Início |
| Status tabs | Orçamentos list and `STATE-10` |
| Faceted/searchable tables | Clientes, Produtos, Orçamentos lists; `STATE-09`, `STATE-11` |
| List/detail/create/edit patterns | Each Phase 1 entity family; explicit order exception |
| Focus and keyboard behavior | `A11Y-01`, `SHELL-03`, `STATE-06`, `STATE-08`–`STATE-10`, plus behavioral obligations |
| Dense-but-breathable forms | Cliente create/edit, product create, quote editor, settings section |
| Empty/loading/error/success/permission states | `STATE-01`–`STATE-08` and route-specific local variants |
| Responsive breakpoints and overflow | Section 3, shell boundary pair, `STATE-11`–`STATE-13` |
| Accessibility | Capture protocol, shell/A11Y rows, semantic and behavioral obligations in Sections 2, 3, and 7 |

## 10. Acceptance rules

A route is screenshot-ready only when:

- its path and data state exist without fixture-only production claims;
- the primary baseline and every applicable distinct variant in its row are implemented;
- generic states assigned in Section 7 are reused semantically, with route-specific copy and actions;
- the shell and content do not duplicate baseline coverage without a distinct assertion;
- keyboard and assistive-technology behavior has tests in addition to focused visual evidence;
- Phase 2 captures remain gated and labelled until their data/navigation contracts are approved;
- visual diffs are reviewed against Weyne tokens and this UX contract, not against third-party product screenshots.

The current component-fixture suite in `tests/visual/` is useful implementation evidence, but it is not a substitute for this route matrix: it omits the authenticated shell, canonical route loaders/permissions, URL-owned state, and most route-level transitions. Extend it incrementally as routes become executable rather than manufacturing all target routes inside one test fixture.