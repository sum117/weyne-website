# 002: Client state, grid, chart, and exports

## Question

Given the repository's pinned TanStack Start, React 19, Bun, and TypeScript stack, can TanStack Query, TanStack Table, shadcn/Recharts, React PDF, and ExcelJS run without changing the public landing page or leaking export-only code into the browser?

## Approach

- exercise Query + a Start server-function-compatible callback + Table v9 + shadcn/Recharts in one SSR/hydration test;
- generate representative PDF and XLSX files under Bun;
- build separate browser and server graphs and inspect the client graph for exporter packages and a server-only sentinel;
- run the repository gate and protected-directory checks after concurrent architecture work settles.

The complete evidence, caveats, versions, commands, and alternatives are recorded in `docs/architecture-spike-client-data-exports.md`.

## Verdict: VALIDATED WITH CONSTRAINTS

### What worked

- Query/Table/chart SSR and React 19 hydration.
- PDF 1.3 generation with `@react-pdf/renderer`.
- Valid Office Open XML generation with ExcelJS.
- Browser graph excluded both export libraries and the server sentinel.

### What did not work as a pure SSR visual

- Recharts cannot render its final responsive SVG without a client layout. The SSR result is a deterministic wrapper; essential values must also be semantic HTML.

### Recommendation for the real build

Use server functions for Query callbacks, Table v9's explicit feature API for grids, shadcn's chart wrapper for progressive visualizations, and server-only modules for PDF/XLSX generation.
