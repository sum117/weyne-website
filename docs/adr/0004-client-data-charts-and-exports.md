# ADR 0004: Client data, grids, charts, and exports

- Status: Accepted with constraints
- Date: 2026-08-17
- Owners: Weyne application maintainers

## Context

Authenticated screens need server-state caching, data grids, charts, and PDF/XLSX output. The chosen packages must hydrate correctly with React 19 and Start SSR, preserve semantic server-rendered content, and avoid putting heavy exporters or private data assembly in the browser bundle.

## Decision

- Use `@tanstack/react-query` `5.101.4` for asynchronous server state. A stable `QueryClient` exists per browser session and per SSR request. Server functions are query/mutation functions; query keys include every server-owned filter, sort, pagination, and identity/authorization dimension.
- Use `@tanstack/react-table` `9.1.2` for application grids. This is v9: use its explicit `tableFeatures`, `createColumnHelper<typeof features, T>()`, and `useTable` APIs. Do not copy v8 `useReactTable` examples. Feed query rows directly to Table rather than mirroring them into another state store.
- Use Recharts `3.10.1` only through the shadcn-backed `src/components/ui/chart.tsx` primitives. Charts enhance semantic SSR content; essential totals and labels must also exist in a table, summary, or accessible text because responsive SVG layout completes after hydration.
- Use `@react-pdf/renderer` `4.6.1` for PDFs and ExcelJS `4.4.0` for formatted `.xlsx` workbooks.
- PDF/XLSX generation is server-only behind an authorized server function or server route. Load permitted records on the server, dynamically import generators when useful, neutralize spreadsheet formula prefixes for user-controlled values, and stream small results or place larger results in authorized private storage. Do not import exporters from client components.

## Package additions

`@tanstack/react-query@5.101.4`, `@tanstack/react-table@9.1.2`, `recharts@3.10.1`, `@react-pdf/renderer@4.6.1`, and `exceljs@4.4.0`, plus the repository-owned shadcn chart wrapper.

## Supported validation commands

- Hydration integration: `bunx vitest run --config vitest.config.ts tests/unit/dependency-stack.test.ts`.
- Generate reproducible export artifacts: `bun scripts/spikes/generate-client-dependency-artifacts.tsx artifacts/architecture-spike`.
- Validate workbook container: `unzip -t artifacts/architecture-spike/sales-report.xlsx`.
- Validate the full client/server/prerender split: `bun run build:app` and then the repository-required `bun run check`.

## Constraints and consequences

- Query state is not a second domain store. Domain validation and authorization remain on the server.
- SSR prefetch/dehydration is selective: use it where first-paint data justifies the integration cost, not by default for every query.
- Recharts `ResponsiveContainer` cannot determine a browser viewport during SSR. `initialDimension` stabilizes the wrapper, while SVG is a hydration enhancement.
- PDF fonts/assets must be deterministic and server-readable; do not fetch remote fonts on the request hot path.
- ExcelJS works under Bun for generation, but production execution is in the Node-compatible server graph. Large exports require bounded queries and a job/streaming design rather than an unbounded request allocation.
- Actual build evidence excluded React PDF, ExcelJS, fontkit/pdfkit, export scripts, and server sentinels from the browser graph. Bundle checks must keep enforcing that split.

## Rejected alternatives

- Client-side PDF/XLSX generation: increases initial bundle weight, exposes assembled private data, and gives weak memory/long-job control.
- CSV as the required spreadsheet output: does not satisfy formatted `.xlsx`; CSV may be added only as a separate explicit raw export.
- TanStack Table v8 examples: incompatible with the validated installed v9 API.
- Chart-only reporting: hydration-dependent SVG cannot be the sole representation of essential values.
- A parallel REST/GraphQL API for Query: duplicates the accepted server-function boundary.
- A second client state store for query rows: creates competing caches and synchronization bugs.

## Validation evidence

[`docs/architecture-spike-client-data-exports.md`](../architecture-spike-client-data-exports.md) and [`spikes/002-client-state-grid-chart-exports/README.md`](../../spikes/002-client-state-grid-chart-exports/README.md) record (`t_239aa5fe`):

- React Query SSR seed and hydration without diagnostics;
- TanStack Table v9 rows and shadcn/Recharts SVG after hydration;
- a valid one-page PDF and valid Office Open XML workbook generated under Bun;
- a 0.54 MB isolated Query/Table/Recharts browser bundle with no exporter leakage;
- a separate 2.78 MB server export bundle;
- a successful full application build with exactly `/` prerendered and no design-handoff changes.
