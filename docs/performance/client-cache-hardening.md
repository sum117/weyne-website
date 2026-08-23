# Client caching audit and heavy-module split report

Recorded 2026-08-21 during the client-caching hardening card (`t_ec426661`).
Companion to `docs/performance/public-landing-bundle.md`, which covers the
public `/` route.

## Audit scope

TanStack Query usage across list, report, and dashboard surfaces:

| Surface | Module | Query key shape | Stale/cache behavior |
| --- | --- | --- | --- |
| Quote catalog picker | `src/features/app/quotes/quote-data.ts` | `['quote-data', 'catalog', stableRequest]` with sorted facet arrays | Shared defaults (30 s stale / 5 min gc); keys are deterministic per page, price list, search, and facets |
| Quote pricing | same | `['quote-data', 'quote', quoteId]` | One aggregate read per quote |
| Quote lifecycle | `src/features/app/quotes/quote-lifecycle-data.ts` | `['quotes', 'list'|'detail', …]` | Optimistic setQueryData reconciliation followed by targeted invalidation with `refetchType: 'none'` |
| Sales report tabs | `src/features/app/reports/sales-report-tabs.tsx` | `['sales-report-page', request]` | `placeholderData` keeps the previous page visible while paging; server-paginated, bounded pages only |
| Commissions tab | `src/features/app/reports/commissions-tab.tsx` | `['reports', 'comissoes', request]` | Same placeholder pattern; one request per committed filter/sort/page state |
| Audit viewer | `src/features/app/audit/audit-activity-viewer.tsx` | `['audit', 'activity', serializedRequest]` | URL-committed filters produce stable keys; placeholder keeps prior rows during navigation |

Findings that needed no change:

- All query keys are stable and serializable; array-valued request fields are
  sorted before keying, so equivalent requests share one cache entry.
- Result sizes are bounded by construction: every surface is server-paginated
  with explicit page caps, and no query fetches an unbounded dataset.
- Deduplication and cancellation are handled by TanStack Query itself
  (`queryFn` promises are shared per key; in-flight requests cancel on
  unmount/key change). No custom caching layer exists or is needed.
- The shared provider (`src/lib/query/app-query-provider.tsx`) installs one
  client per browser session and never shares cache state across SSR requests.
- Mutations invalidate precisely elsewhere: quote lifecycle transitions patch
  list/detail projections immediately and mark both stale without forcing
  refetches of unrelated queries.

## Defect fixed: catalog over-invalidation on recalculation

`quoteRecalculationMutationOptions.onSuccess` invalidated
`quoteDataKeys.catalogs()` — every cached catalog page across every price
list, search term, and facet combination — even though recalculation reads
catalog data but never mutates products, prices, or facets. A user editing a
long quote after browsing the picker would trigger a burst of catalog
refetches on their next visit to the picker.

The fix narrows invalidation to `quoteDataKeys.quote(result.quoteId)`, the
only read model the mutation actually changes. Regression test:
`tests/integration/quote-catalog-data.test.ts` ("invalidates only the
recalculated quote…").

### Request-count effect

Scenario: user browses three catalog pages, edits quote lines (one
recalculation), then reopens the picker at page one.

| | Before | After |
| --- | ---: | ---: |
| Requests triggered by the recalculation | 1 (pricing) + N cached catalog pages invalidated | 1 (pricing) |
| Catalog requests when the picker remounts within staleTime | up to 3 refetches | 0 (cache still fresh) |

Interaction latency effect is the removal of those redundant round trips;
there is no added work anywhere else.

## Heavy-module boundary

PDF rendering (`@react-pdf/renderer`, pdfkit/fontkit), spreadsheet assembly
(`exceljs`), charting (`recharts`), and S3 storage (`@aws-sdk/client-s3`) are
all reached exclusively through `.server` modules or handler-scoped dynamic
imports inside `createServerFn` bodies. No client component imports them, so
no lazy-loading wrappers were required — adding any would be complexity
without a defect.

Verification:

1. Full production build (`bun run build:app`) emits 17 client chunks. A
   marker scan over every emitted chunk finds zero occurrences of
   `@react-pdf`, `pdfkit`, `fontkit`, `exceljs`, `recharts`, or
   `@aws-sdk/client-s3`.
2. That scan is now automated: `scripts/check-public-bundle.ts` gained a
   whole-graph boundary check (`HEAVY_CLIENT_MODULE_MARKERS`) that fails the
   build if any heavy server-only module appears in ANY client chunk, not just
   the prerendered public route. Unit tests cover the violation and pass
   paths.

## Chunk sizes (after)

Public route (`dist/client/index.html` graph), unchanged by this card:

| Budget | Actual | Ceiling |
| --- | ---: | ---: |
| Initial JavaScript raw | 687,179 B | 735,000 B |
| Initial JavaScript gzip | 209,718 B | 225,000 B |
| JavaScript + CSS gzip | 227,118 B | 245,000 B |

Whole-build inventory: 17 JavaScript chunks, largest 424,188 B raw
(134,941 B gzip). Application route chunks remain lazy (`app_.relatorios`,
`app_.produtos`, `app_.configuracoes_.auditoria`, `app_.padroes` load via
dynamic import) and contain none of the heavy markers. Machine-readable
measurement: `artifacts/performance/bundle-after-hardening.json`.

## Gates run

- `bun run test` — 115 files, 1030 tests, all passing (includes the new
  invalidation and boundary tests)
- `bunx vitest run --config vitest.integration.config.ts tests/integration`
  — passing (database-dependent specs skip without a local database)
- `bun run build` — content check, typecheck, lint, unit tests,
  dependency audit, full build, bundle gate, secrets gate
- `bun scripts/check-public-bundle.ts` — zero violations

Pre-existing typecheck/lint errors exist in other cards' concurrently edited
files (e.g. `tests/quote-workflow/*`, `scripts/production-server.ts`). They
are present with and without this card's changes and are untouched here.
