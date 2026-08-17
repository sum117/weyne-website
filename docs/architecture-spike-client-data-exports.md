# Client data, grids, charts, and document exports spike

**Status:** Validated with constraints

**Task:** `t_239aa5fe`

**Validated toolchain:** Bun 1.3.14, TypeScript 5.9.3, React/React DOM 19.2.7, TanStack Start 1.168.32, TanStack Router 1.170.18

This spike validates the application-facing data stack and the two required document outputs without changing the public landing-page composition or the frozen design handoff.

## Decisions

| Capability | Selected package | Validated version | Result |
| --- | --- | ---: | --- |
| Server-state cache | `@tanstack/react-query` | 5.101.4 | **Validated.** A server-function-compatible query callback SSR-rendered from a seeded query cache and hydrated without a mismatch. |
| Application grids | `@tanstack/react-table` | 9.1.2 | **Validated with migration caveat.** V9 uses `tableFeatures`, `createColumnHelper<typeof features, T>()`, and `useTable`; do not copy v8 `useReactTable` examples. |
| Charts | `recharts` through `src/components/ui/chart.tsx` | 3.10.1 | **Validated.** The shadcn chart wrapper and a bar chart SSR-rendered a stable responsive shell and produced SVG after hydration. |
| PDF | `@react-pdf/renderer` | 4.6.1 | **Validated server-only.** Bun generated a readable one-page PDF. |
| Spreadsheet | `exceljs` | 4.4.0 | **Validated server-only.** Bun generated a valid Office Open XML workbook with typed rows and currency formatting. |

The retained package additions are `@tanstack/react-query`, `@tanstack/react-table`, `recharts`, `@react-pdf/renderer`, and `exceljs`. The shadcn chart registry addition is `src/components/ui/chart.tsx`; it uses the repository's existing `cn` helper and CSS-first tokens.

## Query, server-function, Table, and chart boundary

`tests/support/dependency-server-function.ts` proves at typecheck time that a TanStack Start `createServerFn` result satisfies the zero-argument asynchronous query-function contract consumed by `DependencyStackExample`. The example feeds Query's result directly to Table rather than copying rows into a second state store.

`tests/unit/dependency-stack.test.ts` exercises the combined React 19 path:

1. seed Query's server cache;
2. `renderToString` the Query provider, Table v9 grid, and shadcn Recharts wrapper;
3. hydrate the same markup with `hydrateRoot`;
4. assert the hydration effect, two table rows, chart SVG, and absence of hydration diagnostics.

The chart has an important SSR constraint: Recharts `ResponsiveContainer` cannot fully lay out SVG from a server viewport. The shadcn wrapper's `initialDimension` produces deterministic wrapper dimensions, but the actual SVG is a post-hydration enhancement. Essential totals must remain in semantic SSR markup (table, summary, or accessible text), never only in the chart.

For the real `/app` shell:

- create one stable `QueryClient` per browser session and per SSR request;
- use TanStack Start server functions as query/mutation functions, keeping authorization and data access in the handler;
- include every server-owned grid state slice in the query key;
- feed query rows directly into Table;
- prefetch/dehydrate only where first-paint SSR data is worth the additional integration; the spike does not require a second REST or GraphQL boundary.

## Server-only exports and bundle boundary

PDF and spreadsheet generation must execute on the Node/Bun server runtime, behind an authorized server function or server route. Neither package should be imported by a client component. This keeps document CPU/memory work, private data assembly, temporary paths, and any object-storage credentials outside the browser.

The spike generated:

- `artifacts/architecture-spike/sales-report.pdf` — PDF 1.3, one page, 1,779 bytes;
- `artifacts/architecture-spike/sales-report.xlsx` — valid Excel 2007+ ZIP package, 6,588 bytes.

`bun build tests/support/dependency-stack-example.tsx --target=browser` produced a 0.54 MB uncompressed test bundle containing Query/Table/Recharts. Its source and metafile contain no `exceljs`, `@react-pdf`, `fontkit`, `pdfkit`, export-script path, or server sentinel. Building the export entry for Node produced a separate 2.78 MB server bundle, confirming why the exporters should not enter the client graph.

Recommended production shape:

1. authorize the export request in a server function;
2. load only permitted records on the server;
3. dynamically import the PDF or XLSX generator from a `.server.ts` module if the route does not always export;
4. stream/return a download response for small files, or write to private object storage and return a short-lived authorized download for larger jobs;
5. never pass database, auth, or object-storage credentials into `VITE_*` variables.

Runtime caveats:

- `@react-pdf/renderer` font registration and asset loading must use server-readable, deterministic assets; remote font fetching should not be part of a request hot path.
- ExcelJS's Node file writer works under Bun 1.3.14. Large exports should use bounded queries and a server-side job/streaming strategy rather than constructing an unbounded workbook during a browser request.
- Both packages target the project's Node-compatible server container. They are not approved for an edge-worker runtime.
- Generated documents must escape/format user data deliberately. Spreadsheet cells beginning with formula prefixes require neutralization when values can be user-controlled.

## Reproducible evidence

```text
bunx vitest run --config vitest.config.ts tests/unit/dependency-stack.test.ts
# 1 file / 1 test passed

bun scripts/spikes/generate-client-dependency-artifacts.tsx artifacts/architecture-spike
# emitted sales-report.pdf and sales-report.xlsx

file artifacts/architecture-spike/sales-report.pdf artifacts/architecture-spike/sales-report.xlsx
# PDF document, version 1.3, 1 page
# Microsoft Excel 2007+

unzip -t artifacts/architecture-spike/sales-report.xlsx
# No errors detected in compressed data

bun build tests/support/dependency-stack-example.tsx --target=browser \
  --outdir=artifacts/architecture-spike/client-bundle --minify \
  --metafile=artifacts/architecture-spike/client-metafile.json
# 644 modules; 0.54 MB entry

bun run build:app
# client + SSR builds passed; prerender crawled and emitted exactly `/`
```

The repository-level `bun run check` remains the final combined gate. The upstream baseline passed immediately before concurrent architecture children began. This task ran the gate both before and after its changes, but neither local result represented an isolated dependency-spike state: the first attempt observed a sibling production-runtime test before its implementation existed; the final attempt reached TypeScript and reported unrelated in-flight errors across sibling quote, order, database, UI, and integration-test work. Focused typecheck/lint, the hydration test, both bundle builds, document validation, and the full application/prerender build pass for this task's surface. The collision and final combined-gate state are recorded on the task rather than misreported as dependency failures.

The Chromium smoke run passed six landing behavior/SEO/SSR/WhatsApp tests. Five accessibility/app-route tests failed against concurrent shared-worktree changes (contrast/focus and unfinished `/app` surfaces); this spike did not modify landing route or section source. `git diff` is empty for `docs/design-handoff/`, `src/features/landing/`, `src/routes/index.tsx`, and `src/routes/__root.tsx`.

## Rejected alternatives

- **Client-side PDF/XLSX generation:** rejected for bundle weight, exposure of assembled private data, weak control over long-running work, and browser memory variability. Both libraries technically have browser-facing surfaces; that is not the selected boundary.
- **CSV as the spreadsheet implementation:** rejected because the requirement is a formatted `.xlsx` workbook. CSV remains appropriate only for a later explicit raw-data export.
- **A second REST/GraphQL API layer for Query:** rejected for this application. TanStack Start server functions already provide the typed application boundary.
- **TanStack Table v8 examples:** rejected against the installed v9 package. V9's explicit feature registration is the validated API.
- **Chart-only reporting:** rejected because responsive SVG is hydration-dependent and cannot carry the sole representation of essential values.

## Verdict: VALIDATED WITH CONSTRAINTS

All five selected dependencies run on the pinned React/TanStack/Bun/TypeScript stack. Query, Table, and shadcn/Recharts can share an SSR/hydration path. PDF and XLSX generation work under Bun but belong exclusively to the server graph. The application build still statically prerenders `/`, the client output excludes export-only modules, and the protected design handoff is untouched. The downstream architecture consolidation must rerun the combined green gate after all sibling implementations settle.
