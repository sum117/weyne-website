# Release reconciliation against `project.pdf`

Kanban task `t_d5d2fe7f`. This document maps every requirement stated in
`project.pdf` to implemented behavior and to acceptance evidence. It supports a
go/no-go decision.

**Verdict: NO-GO.** Three release blockers stop this candidate. Each blocker is
current-scope Phase 1 or Phase 2 work. No blocker is reclassified as Phase 3.

## 1. Source and candidate identity

| Item | Value |
| --- | --- |
| Requirement source | `project.pdf`, 16 sections, 5 pages |
| Source location | `C:\Users\jvcal\Downloads\Documents\Receipts-and-Statements\project.pdf` |
| Source in repository | No. The file is not tracked in this repository. |
| Prior extraction | `docs/domain/project-pdf-requirements-inventory.md` (task `t_2689e61a`) |
| Candidate branch | `development` |
| Candidate HEAD | `d8979ee67e45f2ca1d036362691d2bc5b2bd6a2b` |
| Candidate tree hash | `7604640be869a3a39a6e4528d76fa50489c7ab4e` |
| Uncommitted paths | 57 (24 modified, 33 untracked) |
| Reconciled on | 2026-08-21 |

The candidate is a working tree, not a commit. Twenty-four tracked files are
modified and thirty-three files are untracked. The untracked set includes
production source (`src/features/app/users/**`,
`src/lib/server/readiness.server.ts`) and a production migration
(`drizzle/canonical/0003_millisecond_timestamp_defaults.sql`). A release built
from `git archive HEAD` would omit them. Identify the candidate by tree hash
until the tree is committed.

## 2. Disposition legend

- **SATISFIED** — implemented, reachable by a user, and covered by evidence.
- **PARTIAL** — implemented at one layer only. Not reachable end to end.
- **FAILED** — required by the current phase and not delivered.
- **DEFERRED (Phase 3)** — listed by `project.pdf` §15 or §16 as future work.
- **N/A** — not a product requirement.

"Reachable" means a signed-in user can perform the action in the running
application. Code that exists but that no route mounts is not reachable.

## 3. Release blockers

### B1 — No authentication exists. Severity: critical

`better-auth` version 1.6.29 is a declared dependency. It has zero imports in
`src/`, `tests/`, and `scripts/`. No auth configuration, no auth handler route,
and no session adapter exist.

Every authenticated server function resolves its actor through a stub that
returns `null`:

```
src/features/app/orders/order.functions.ts:99         function authenticate(): CommercialActor | null { return null }
src/features/app/audit/audit-activity.functions.ts:61 function authenticate(): Promise<AuditRequester | null>
src/features/app/reports/report.functions.ts:264      function authenticate(): ReportActorScope | null
src/features/app/reports/report-export.functions.ts:60
src/features/app/reports/commission-report.functions.ts:69
src/features/app/quotes/quote-pdf.functions.ts:109
src/features/app/orders/order-attachment.functions.ts:142
src/lib/settings/settings.functions.ts:162
src/lib/settings/document-logo.functions.ts:132
src/features/app/carriers/carrier.functions.ts:160
src/features/app/industries/industry.functions.ts:147
src/features/app/users/user-management.functions.ts:155
```

The stubs fail closed, which is the correct security posture. The consequence is
that all thirty-seven exported server functions return `UNAUTHENTICATED` or
`FORBIDDEN` for every caller. No business operation can complete in production.

The board agrees. Card `t_74974065` is blocked with this reason: "no supported
authentication flow exists — better-auth is installed but has zero imports
anywhere, no auth config/handler route, no auth session wiring in /app". The
production auth card `t_99c2f9fb` has never completed.

Authentication is Phase 1 infrastructure. `project.pdf` §2 defines three user
profiles. It is not Phase 3.

### B2 — The production migration path does not create the schema the code queries. Severity: critical

Two migration sets exist in this repository.

- `drizzle/canonical/` holds four migrations. `migrateDatabase()` runs this
  folder (`src/lib/db/migrate.server.ts:184`). The production Compose file runs
  `node dist/server/migrate.js`, which calls it
  (`deploy/docker-compose.weyne.yml:20`). This is the only path that runs in
  production.
- `drizzle/*.sql` holds twenty feature-slice migrations. No production code path
  runs them. Most integration tests apply them by explicit file name through
  `tests/support/postgres-harness.ts`.

I verified the divergence empirically. I started PostgreSQL 17.6 in a disposable
container, ran `bun scripts/migrate-database.ts` against it, and executed the
exact SQL fragments the shipped server code issues. Evidence:
`artifacts/runtime-schema-probe.sql` and `artifacts/runtime-schema-probe.out`.

The production schema has twenty-six tables plus the migration ledger. These
relations are queried by shipped server code and do not exist after a production
migration:

| Missing relation | Queried by | Feature lost |
| --- | --- | --- |
| `commercial_resource_scopes` | `audit-activity.functions.ts:99`, `visibility.server.ts`, `security-service.server.ts`, `pdf-artifact-postgres.server.ts` | Record-scope authorization |
| `commercial_resource_assignments` | `read-visibility.server.ts`, `visibility.server.ts`, `security-service.server.ts` | Representative record scope |
| `commercial_security_audit` | `security-service.server.ts` | Security audit trail |
| `quote_pdf_artifacts` | `pdf-artifact-postgres.server.ts` | Quote PDF storage (§12) |
| `quote_snapshots` | `pdf-artifact-postgres.server.ts` | PDF immutability |
| `quote_versions` | `quote-conversion.server.ts:172`, `quote-repository.server.ts` | Quote version history |
| `quote_audit` | `quote-conversion.server.ts:191`, `quote-audit-repository.server.ts` | Quote audit trail |
| `quote_lifecycle_commands` | `lifecycle-postgres.server.ts` | Quote approval idempotency (§4) |
| `quote_transition_history` | `lifecycle-postgres.server.ts` | Quote state history |
| `quote_conversion_commands` | `quote-conversion.server.ts:363` | Conversion idempotency (§9) |
| `order_attachments`, `order_attachment_audit`, `secure_order_attachments` | `attachment-repository.server.ts`, `security-service.server.ts` | Order attachments (§9) |
| `order_state_audit` | `history-source.server.ts`, `quote-conversion.server.ts:328` | Order history (§9) |
| `order_line_taxes` | `quote-conversion.server.ts`, `read-repository.server.ts` | Order IPI detail (§9) |
| `product_price_history` | `pricing.server.ts` | Price history (§11) |
| `catalog_audit` | `catalog.service.server.ts:377`, `pricing.server.ts` | Catalog audit trail |
| `product_attachments`, `product_photo_variants` | `schema/catalog.ts` | Photos, data sheet, FISPQ (§7) |
| `industry_profiles` | `schema/catalog.ts` | Industry commission profile (§6) |

One column also diverges. `catalog.service.server.ts:288` selects
`p.internal_code_normalized`. The production `products` table has no such column.
PostgreSQL rejects that query:

```
ERROR:  column p.internal_code_normalized does not exist
```

The integration suite does not catch this. Each integration test names the
feature-slice migrations it needs, so each test builds a schema that the
production migrator never builds. The suite proves the code works against a
schema that production will not have.

This is a Phase 1 and Phase 2 defect. `project.pdf` §14 lists these tables.

### B3 — The application has no user interface for any business module. Severity: critical

The router exposes six routes (`src/routeTree.gen.ts`):

| Route | Content |
| --- | --- |
| `/` | Public marketing landing page. Complete. |
| `/app` | Static SSR placeholder. Its own copy says "A estrutura está pronta para receber os módulos autenticados." |
| `/app/padroes` | Shared component examples. Not a business surface. |
| `/app/produtos` | `<ProductCatalog products={[]} canManage={false} />`. The empty array is a literal in the route. |
| `/app/relatorios` | `<ReportsShell ... representatives={[]} />` with no `renderReport`. It always renders the empty table. |
| `/app/configuracoes/auditoria` | Audit viewer. Its server function fails closed, so it always renders the unauthorized state. |

`project.pdf` §3 lists nine modules. Seven have no route: Dashboard, Clientes,
Indústrias, Transportadoras, Orçamentos, Pedidos, and Configurações beyond
audit.

Presentation components exist but no route mounts them. Verified unmounted:
`quote-list.tsx`, `quote-detail.tsx`, `quote-lifecycle.tsx`,
`quote-conversion.tsx`, `quote-catalog-picker.tsx`,
`quote-line-item-editor.tsx`, `quote-pdf-controls.tsx`, `client-detail.tsx`,
`product-form.tsx`, `product-detail.tsx`, `product-pricing.tsx`,
`order-attachments-panel.tsx`, `sales-report-tabs.tsx`, `commissions-tab.tsx`,
and `ui/sidebar.tsx`.

The primary flow of §4 — Cliente → Orçamento → Aprovação → Pedido → PDF →
Relatórios — cannot be executed by any user through the application.

## 4. Requirement matrix

### §1 Objective

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Centralize clients, products, industries, orders, quotes, commissions, reports on one platform | FAILED | Domain services exist. No route mounts them. See B3. |
| Responsive platform | PARTIAL | `/` and the four `/app` surfaces are responsive and pass the axe scan (`docs/qa/accessibility-keyboard-review.md`). The absent modules cannot be assessed. |

### §2 User profiles

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Administrador | PARTIAL | `user_role` enum ships `admin`. No login exists. See B1. |
| Representante Comercial | PARTIAL | `user_role` ships `representative`; `representatives` table exists. No login. |
| Consulta/Leitura | PARTIAL | `user_role` ships `read_only`; report scope denies commissions to it (`report-metrics.ts`). No login. |
| Role permission matrix | PARTIAL | `docs/domain/role-permission-matrix.md` is specified and complete. No central guard enforces it; each service holds its own check. Threat model T02 marks this P0 and open. |

### §3 System modules

| Module | Disposition | Evidence |
| --- | --- | --- |
| Dashboard | FAILED | No route, no component, no server function. Board card `t_242de962` never ran. |
| Clientes | FAILED | `customers` table ships. No client service, no route. Only `client-detail.tsx` exists, unmounted. |
| Indústrias | PARTIAL | Query and mutation services plus real-Postgres coverage ship. No route. |
| Produtos | PARTIAL | Catalog service and UI component ship. Route serves a hardcoded empty list. Query is broken against the production schema (B2). |
| Transportadoras | PARTIAL | Contracts, persistence, and services ship. No route. |
| Orçamentos | PARTIAL | Numbering, snapshots, Decimal engine, lifecycle, duplication, and PDF ship. No route. Tables missing from production (B2). |
| Pedidos | PARTIAL | Conversion, lifecycle, commission facts, and attachments ship. No route. Tables missing from production (B2). |
| Relatórios | PARTIAL | Canonical metric boundary and three sales tabs plus commissions tab ship. Route renders the empty shell only. |
| Configurações | FAILED | Settings service and document-logo pipeline ship. No settings route. Only the audit sub-page has a route, and it fails closed. |

### §4 Main flow

| Step | Disposition | Evidence |
| --- | --- | --- |
| Cliente → Orçamento | FAILED | No client module and no quote route. |
| Orçamento → Aprovação | PARTIAL | `quote_status` ships `approved`; `lifecycle.server.ts` implements the transition. `quote_lifecycle_commands` is absent from production (B2). No UI. |
| Aprovação → Pedido | PARTIAL | Idempotent conversion ships and is covered by `tests/integration/quote-to-order-conversion.test.ts`. `quote_conversion_commands` is absent from production (B2). No UI. |
| Pedido → PDF | PARTIAL | Both templates render. Artifact tables are absent from production (B2). |
| PDF → Relatórios | PARTIAL | Metric boundary reconciled (`docs/acceptance/reporting-metric-reconciliation.md`). Not wired to a route. |

### §5 Client registration

Every field named by §5 exists in the production `customers` table: `legal_name`,
`trade_name`, `tax_id`, `state_registration`, `street_address`, `postal_code`,
`city`, `state`, `phone`, `whatsapp`, `email`, `contact_name`, `segment`,
`credit_limit`, `notes`.

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Client fields persisted | SATISFIED (schema) | Verified in the live probe database. |
| Client create, edit, list, archive | FAILED | No service and no route. Cards `t_a0250686` and `t_256300dc` never ran. |

### §6 Industry registration

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Legal name, trade name, CNPJ, address, notes | SATISFIED (schema) | `industries` table in the probe database. |
| Default commission | PARTIAL | `commission_rules` ships with a `commission_scope` enum of `industry_default` and `product_override`. `industry_profiles` is absent from production (B2). |
| Industry management UI | FAILED | Services ship. No route. |

### §7 Product registration

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Internal code, manufacturer code, description, brand, category, NCM, CEST, EAN, DUN, packaging, unit, net and gross weight, dimensions, IPI, ICMS, PIS, COFINS | SATISFIED (schema) | All columns present in the probe `products` table. |
| Prices 1 to 4 | SATISFIED (schema) | `price_list_key` enum ships `PRICE_1` through `PRICE_4`. Seed creates four canonical price lists. |
| Commission override | SATISFIED (schema) | `commission_source` enum ships `product_override`. |
| Photos, technical sheet, FISPQ | FAILED | `product_assets` exists with a `product_asset_kind` enum. The shipped catalog code targets `product_attachments` and `product_photo_variants`, which production never creates (B2). No upload route. |
| Product catalog UI | PARTIAL | Component ships and passes the axe scan. Route serves an empty literal. Its list query fails against the production schema (B2). |

### §8 Quotes

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Automatic numbering | PARTIAL | `document_sequences` and transactional numbering ship; `quotes.number` is unique. No UI. |
| Validity | SATISFIED (schema) | `quotes.valid_until`. |
| Freight | SATISFIED (schema) | `freight_terms`, `freight_amount`. |
| Payment terms | SATISFIED (schema) | `payment_terms`. |
| Carrier | SATISFIED (schema) | `quotes.carrier_id`, `carrier_name_snapshot`. |
| Products | SATISFIED (schema) | `quote_lines` with immutable snapshots. |
| Per-item discount | SATISFIED | `line_discount_rate`, `line_discount_amount_snapshot`. Decimal engine covered by unit tests. |
| Overall discount | SATISFIED | `overall_discount_rate`, `overall_discount_allocation_amount_snapshot`. |
| PDF generation | PARTIAL | Templates render. Artifact tables absent from production (B2). |
| Convert to order | PARTIAL | Implemented and idempotent. Command table absent from production (B2). |
| Duplication | PARTIAL | `duplication.server.ts` ships with `duplicated_from_quote_id`. No UI. |

### §9 Orders

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Automatic conversion from a quote | PARTIAL | See §8. |
| Discount control | SATISFIED (schema) | Order line discount snapshots present. |
| IPI | PARTIAL | `ipi_rate_snapshot` ships on `order_lines`. `order_line_taxes` is absent from production (B2). |
| Commission | SATISFIED (schema) | `commission_rate_snapshot`, `commission_basis_amount_snapshot`, `commission_value_amount_snapshot`, `commission_source_snapshot`. |
| Attachments | FAILED | All three attachment tables are absent from production (B2). No route. |
| History | FAILED | `order_state_audit` is absent from production (B2). `order_events` exists but the shipped history source does not read it. |

### §10 Dashboard

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Month sales, open orders, pending quotes, active clients, top clients, top products, top industries | FAILED | Nothing implements a dashboard. Grouping logic for clients, products, and industries exists inside `report-metrics.ts`, but no card, no KPI, and no route exist. Board card `t_242de962` never ran. This is Phase 2, not Phase 3. |

### §11 Reports

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Sales by client, product, industry | PARTIAL | `sales-report-tabs.tsx` implements all three. No route mounts it. |
| Commissions | PARTIAL | `commissions-tab.tsx` and `commission-report.server.ts` ship. Not mounted. |
| Price history | FAILED | `pricing.server.ts` reads `product_price_history`, which production never creates (B2). No route. |
| Clients without purchase | PARTIAL | `insight-contracts.ts` defines the ninety-day inactive window. No server function and no route consume it. |
| Excel export | PARTIAL | `workbook.server.ts` and two export server functions ship. No route imports them. Not verified by parsing a generated file. |

### §12 Premium commercial PDF

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Layout from the approved mockup | SATISFIED | Rendered artifacts in `docs/review/quote-pdf/`, four PDFs and thirty page rasters. |
| Carol Weyne logo | SATISFIED | Document logo pipeline plus `src/lib/pdf/assets`. |
| Industry logo | SATISFIED | `QuotePdfBrandingSnapshot.industryLogo`. |
| Product photos | SATISFIED | `ProductImage` in `comercial.server.tsx`. |
| Client data | SATISFIED | Customer snapshot fields on `quotes`. |
| Financial summary | SATISFIED | `QuotePdfTotalsSnapshot`. |
| Signatures | SATISFIED | `SignatureBlock`, `QuotePdfSignatureSnapshot`. Visual signature only. Digital signature is Phase 3. |
| Resumida and comercial versions | SATISFIED | `resumida.server.tsx` and `comercial.server.tsx`; both raster sets reviewed. |
| Authorized preview, versioning, download | FAILED | Endpoints exist and fail closed. Their storage tables are absent from production (B2). |

### §13 Design system

| Requirement | Disposition | Evidence |
| --- | --- | --- |
| Primary `#034F83` | SATISFIED | `--color-blue: #034f83` in `src/styles/app.css`. |
| Secondary `#069CFF` | SATISFIED | `--color-baltic: #069cff`. |
| Accent `#EECAA0` | SATISFIED | `--color-sand: #eecaa0`. |
| White background | DEVIATION, accepted | `--background` maps to `--color-paper: #f6f3ec`. The frozen `docs/design-handoff/DESIGN_SPEC.md` specifies the warm paper tone. Cards use white. |
| Arpona Sans Semibold, Rossanova Regular | DEVIATION, documented | Jost and Newsreader ship instead. `docs/app-component-state-inventory.md:10` records the substitution as the approved equivalent. |
| Side menu | FAILED | `src/components/ui/sidebar.tsx` exists. No route mounts it. There is no authenticated shell. |
| Modern layout | SATISFIED | Visual parity reviewed; `docs/visual-regression.md` holds the deterministic suite. |

### §14 Database

Requested tables, against the production migration path:

| Requested table | Production status |
| --- | --- |
| Clientes | Present (`customers`) |
| Indústrias | Present (`industries`) |
| Produtos | Present (`products`) |
| Transportadoras | Present (`carriers`) |
| Orçamentos | Present (`quotes`) |
| Itens Orçamento | Present (`quote_lines`) |
| Pedidos | Present (`orders`) |
| Itens Pedido | Present (`order_lines`) |
| Tabelas de Preço | Present (`price_lists`, `product_prices`) |
| Comissões | Present (`commission_rules`) |
| Usuários | Present (`users`, `sessions`, `accounts`, `verifications`, `representatives`) |
| Anexos | Present (`attachments`), but the shipped attachment code targets tables production never creates (B2) |

Disposition: PARTIAL. The twelve requested entities exist. Nineteen further
relations that shipped code depends on do not. See B2.

### §15 Future features — deliberate Phase 3 exclusions

Each item below is excluded because `project.pdf` §15 lists it as future and §16
places Financeiro and Integrações in Phase 3. None is current-scope work
relabelled.

| Item | Disposition | Why excluded |
| --- | --- | --- |
| WhatsApp integration | DEFERRED (Phase 3) | §15 future list. The public landing page keeps a manual WhatsApp link only, which is the marketing conversion path, not a system integration. |
| Digital signature | DEFERRED (Phase 3) | §15 future list. §12 requires visual signature fields in Phase 1, and those ship. The inventory records the distinction at §7.2. |
| ERP integration | DEFERRED (Phase 3) | §15 and §16. `docs/adr/0003` excludes external system integration from the first release. |
| Financial integration | DEFERRED (Phase 3) | §16 puts Financeiro in Phase 3. `credit_limit` stays informative and blocks nothing, per the inventory at §5.1. |
| Android and iOS application | DEFERRED (Phase 3) | §15 future list. The delivered product is a responsive web application. |
| Client portal | DEFERRED (Phase 3) | §15 future list. No customer login role exists, by design. |

Board evidence: the seven Phase 3 planning cards `t_af46fe71`, `t_1dcfb9d5`,
`t_064927a2`, `t_e09b3a09`, `t_d9fe6891`, `t_4ff17e78`, and `t_c7d9f5ef` are
archived and never ran. The exclusion is deliberate and recorded.

Also excluded by decision, not by phase: no tax engine and no fiscal document
issuance. `project.pdf` §7 and §9 list IPI, ICMS, PIS, and COFINS as product
data only. The inventory at §5.3 forbids inferring an engine from those fields.
The `invoiced` order status is an operational milestone only.

### §16 Development priority

| Phase | Scope | Disposition |
| --- | --- | --- |
| Phase 1 | Registrations, quotes, orders, PDF | FAILED. Domain and persistence layers largely ship. No module is reachable. Attachment, artifact, and audit tables are absent from production. |
| Phase 2 | Dashboard, reports, price history | FAILED. Dashboard absent. Reports unmounted. Price history broken against the production schema. |
| Phase 3 | Finance, integrations | DEFERRED, correctly. |

## 5. Gate evidence

I re-ran the gates rather than trusting the prior reports.

| Gate | Command | Result | Evidence |
| --- | --- | --- | --- |
| Full check | `bun run check` | PASS, exit 0 | `artifacts/check-run.log` |
| Unit tests | inside `bun run check` | 116 files, 1038 tests, all pass | `artifacts/check-run.log:271` |
| Content, preview mode | `bun run check:content` | PASS, 2 warnings | Re-run 2026-08-21 |
| Content, release mode | `WEYNE_RELEASE=1 bun run check:content` | PASS, 2 warnings | Re-run 2026-08-21 |
| Lint | inside `bun run check` | 0 errors, 80 warnings | `artifacts/check-run.log:114` |
| Secret scan | `check:secrets` | 0 errors, 4 warnings, 0 bundle findings | `artifacts/check-run.log:419` |
| Public bundle budget | `check:bundle` | 0 violations, 227 KB gzip total | `artifacts/check-run.log` |
| Production headers | `check:headers` | PASS | `artifacts/check-run.log` |
| Production migration | `bun scripts/migrate-database.ts` on PostgreSQL 17.6 | PASS, 4 applied | Live probe, this task |
| Runtime schema probe | `psql -f artifacts/runtime-schema-probe.sql` | 11 of 11 probes fail | `artifacts/runtime-schema-probe.out` |

Completed hardening work, accepted as evidence:

| Area | Card | Artifact |
| --- | --- | --- |
| Threat model and LGPD | `t_ee0adb0e` | `docs/security/threat-model.md`, `docs/privacy/lgpd-data-inventory.md` |
| Logging redaction and retention | `t_26b28a46` | `src/lib/server/log-redaction.ts` |
| Headers and dependency audit | `t_deedb9f8` | `docs/security/production-headers-and-dependencies.md` |
| Accessibility and keyboard | `t_5bf3f426`, `t_096e6f95` | `docs/qa/accessibility-keyboard-review.md` |
| Visual parity | `t_e502b1de` | `docs/visual-regression.md` |
| Landing bundle budget | `t_d78ae073` | `docs/performance/public-landing-bundle.md` |
| Query plans | `t_8963f08e` | `docs/performance-profiling.md` |
| Client cache | `t_ec426661` | `docs/performance/client-cache-hardening.md` |
| Backup and restore | `t_0eb853af` | `docs/postgres-backup-and-restore.md` |
| Migration safety and rollback | `t_dcd1f8f9` | `docs/operations/migrations-and-rollback.md` |
| Immutable images | `t_ca57d5f0` | `.github/workflows/publish.yml` |
| Clean build validation | `t_35945041` | `docs/review/release-validation-t_35945041.md` |

These gates are real. They test the surfaces that exist. They do not test the
absent modules, so they cannot substitute for product acceptance.

## 6. Contradictions found

**C1. The completed-gate premise does not match the board.**
This card's brief describes the security, accessibility, performance, and
operations gates as already complete, which is true. It implies the product
underneath them is complete, which is not. The board holds 323 tasks: 147 done,
159 scheduled, 6 blocked, 4 running, 7 archived. Of the 159 scheduled tasks, 131
have never started a run. Every P0 authentication, RBAC, and app-shell card and
every P1 management-UI card sits in that set.

**C2. The release-validation report overstates the release-mode gate.**
`docs/review/release-validation-t_35945041.md:217` states the release-mode
content gate is not satisfied, because the Instagram and LinkedIn URLs are
absent. I re-ran it. `WEYNE_RELEASE=1 bun run check:content` exits 0. Those two
issues are warnings in `content.schema.ts:127`, not errors. The gate passes. The
same paragraph asks for CNPJ confirmation; the shipped value
`05.095.383/0001-42` is structurally valid, verified by check-digit computation
in `artifacts/cnpj-check.py`. Business ownership of that number still needs a
human confirmation, but it is not a gate failure.

**C3. The integration suite proves the wrong schema.**
Thirty-one integration files pass against real PostgreSQL. Most build their
schema from feature-slice migrations that production never applies. Green
integration tests therefore do not evidence that production works. See B2.

**C4. Two migration sets carry colliding ordinals.**
`drizzle/` contains `0002`, `0003`, `0004`, `0005`, and `0009` twice each. The
production runner in `src/lib/db/migrate.server.ts:78` requires unique
`NNNN_name.sql` ordering and would reject that folder. The folder survives only
because production never reads it. The operations runbook
`docs/operations/migrations-and-rollback.md` documents `drizzle/NNNN_name.sql` as
the production contract, which is now wrong; production reads
`drizzle/canonical/`.

**C5. The candidate is not committed.**
Fifty-seven paths are uncommitted, including production source and a production
migration. `publish.yml` builds from a checkout. A release cut today would ship a
different artifact than the one validated.

## 7. Missing evidence

| Item | Status |
| --- | --- |
| Playwright on Firefox and WebKit | Not evidenced in this task. The config declares three projects. Sibling card `t_b6fecdfc` is still running. |
| Excel export verified by parsing | Not evidenced. No card has parsed a generated workbook. |
| Backup and restore drill on the candidate | Not evidenced. Sibling card `t_766952cf` is still running. |
| Container health from a clean start | Not evidenced here. Same sibling card. |
| Lighthouse targets | Not evidenced. |
| Role-based end-to-end journey | Impossible today. Card `t_1f64bc08` blocked three times for the same reason: no authentication and no routes. |
| Production image digest and source SHA | Not produced. Card `t_9b7c6b47` has not run. |

## 8. Go/no-go

**NO-GO.**

Three critical blockers stand: B1 no authentication, B2 production schema
divergence, B3 no business user interface. Any one of them alone prevents a
release. Together they mean the deployed application would serve a marketing
page, a placeholder, an empty catalog, an empty report shell, and an audit page
that refuses every request.

What the release does have is a sound foundation: a validated canonical schema, a
safe forward-only migration runner with an advisory lock and checksum ledger, an
exact Decimal calculation engine, two complete PDF templates, a reconciled metric
boundary, a hardened public landing page, and working operations runbooks. The
gates that were run are honest and they pass.

Minimum work to reconsider, in order:

1. Land production authentication and session lifecycle. Card `t_99c2f9fb`.
2. Fold every feature-slice migration into `drizzle/canonical/` as ordered expand
   migrations, then re-run the runtime schema probe until all eleven probes pass.
   Update `docs/operations/migrations-and-rollback.md` to name the real folder.
3. Rebuild the integration harness on the production migration path so the suite
   proves the schema that ships.
4. Build the authenticated shell and the module routes: clients, industries,
   carriers, products, quotes, orders, reports, settings, dashboard.
5. Commit the tree, then re-run this reconciliation against a commit SHA.

Items 1 through 4 are Phase 1 and Phase 2 scope. None may be moved to Phase 3.
