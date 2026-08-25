# PostgreSQL query-plan profiling — report, commission, and dashboard paths

Kanban task `t_8963f08e`. Companion to `docs/performance-baseline.md`, which
defined the representative fixture scale and left PostgreSQL evidence to this
card. All measurements below were captured on the local disposable
`profile_perf` schema (PostgreSQL 17.6) seeded at the **standard** fixture
scale: 40 representatives, 10,000 products, 25,000 quotes, 25,000 orders,
150,000 order lines. Synthetic data only; the seed scripts are versioned in
`artifacts/performance/profiling/`.

## Reproduce

```sh
docker compose -f deploy/docker-compose.database.yml up -d   # local Postgres 17
tar -cf - drizzle artifacts/performance/profiling \
  | docker exec -i weyne-database-postgres-1 sh -c 'mkdir -p /tmp/prof && tar -xf - -C /tmp/prof'
docker exec weyne-database-postgres-1 psql -U weyne_dev -d weyne_dev \
  -f /tmp/prof/artifacts/performance/profiling/seed-schema.sql
docker exec weyne-database-postgres-1 psql -U weyne_dev -d weyne_dev \
  -f /tmp/prof/artifacts/performance/profiling/seed-data.sql      # ~5 s
docker exec weyne-database-postgres-1 psql -U weyne_dev -d weyne_dev \
  -f /tmp/prof/artifacts/performance/profiling/apply-indexes.sql  # migration under test
docker exec weyne-database-postgres-1 psql -U weyne_dev -d weyne_dev \
  -f /tmp/prof/artifacts/performance/profiling/plans.sql          > before.txt
docker exec weyne-database-postgres-1 psql -U weyne_dev -d weyne_dev \
  -f /tmp/prof/artifacts/performance/profiling/plans-after.sql    > after.txt
```

The committed captures are `plans-before.txt` (pre-migration plans) and
`plans-after.txt` (post-migration plans, including the query-shape change).

## Findings and changes

Every change below has a full `EXPLAIN (ANALYZE, BUFFERS)` pair in the
committed plan files. Timings are medians of three consecutive runs.

### Q1/Q2 — commission totals and grouped page (`commission-report.server.ts`)

Both queries date-filter `orders.created_at`; no index led with `created_at`
(`orders_status_created_idx` requires a status predicate that the admin path
expresses as `<> 'cancelled'`). Before: Seq Scan over all 25k orders plus a
full quotes scan for the join. After `orders_created_idx (created_at, id)`:
Bitmap/Index scan touching only the window (~1,100 of 25k rows).

| Query | Before | After | Notes |
| --- | ---: | ---: | --- |
| Q1 totals | 9.5 ms | 4.3 ms | range scan replaces full orders Seq Scan |
| Q2 grouped page | 10.4 ms | 5.8 ms | same window path as Q1 |

The representative-scoped variant additionally benefits from
`quotes_owner_idx`: the owner filter now resolves via Index Only Scan
(6.4 ms → 3.7–4.0 ms at one month; ~5.2 ms → 4.0 ms unbounded window).

### Q3 — report metrics scoped orders (`report-metrics.server.ts`)

Two findings:

1. **Query shape (kept):** the DISTINCT-ON latest-order-per-client probe
   joined `quotes` solely to re-filter by owner — a `TRUE` predicate for
   admins. The join forced a 25k-row quotes scan inside the probe. The probe
   now filters `orders` directly (admin), or uses an `EXISTS` subquery on
   quotes for representative/read-only scopes, preserving exact semantics.
   Removing the join also lets the pre-existing
   `orders_client_created_idx (client_id, created_at DESC, id DESC)` serve
   the probe's ordering.
2. **Index:** `orders_client_latest_idx` — a partial
   `(client_id, created_at DESC, id DESC) WHERE status <> 'cancelled'` —
   gives the probe a true index-only walk (probe alone: ~10 ms → ~2.8 ms at
   25k orders; statement medians: 44.7/46.5 ms before → 33.9 ms after). The
   plain full-layout index cannot serve the status filter as an index-only
   scan, which is why the partial predicate mirrors the loader's
   cancelled-exclusion exactly.

### Q4 — order lines by bounded IN-list (`report-metrics.server.ts`)

No usable access path existed for `order_lines.order_id` lookups beyond the
composite unique constraint, so every fetch Seq-Scanned all 150k lines.
After `order_lines_order_id_idx (order_id)`: nested-loop index probes, 6 rows
per order (medians 27.0/27.3 ms before → 25.3/26.1 ms warm here; the win
grows with table size because the Seq Scan cost dominates the old plan).
Single-order lookups stay sub-0.1 ms.

### Q5/Q6 — product list and facets (`catalog.service.server.ts`) — no change

Already healthy: partial indexes from `0001_catalog_pricing.sql` serve both
the sorted id-page (0.2 ms) and the facet aggregation. No speculative indexes
added.

## Accepted schema changes

Migration `drizzle/0011_query_plan_indexes.sql` (expand-only, reversible with
`DROP INDEX`; each index is `IF NOT EXISTS` so re-running is safe):

| Index | Justified by | Write/storage cost |
| --- | --- | --- |
| `orders_created_idx (created_at, id)` | Q1, Q2, newest-first lists | ~1.0 MB per 25k orders; one extra B-tree insert per order |
| `order_lines_order_id_idx (order_id)` | Q4, per-order line fetches | ~1.9 MB per 150k lines; one insert per line |
| `quotes_owner_idx (owner_user_id, id)` | representative-scoped reports/commissions | ~1.0 MB per 25k quotes; one insert per quote |
| `orders_client_latest_idx (client_id, created_at DESC, id DESC) WHERE status <> 'cancelled'` | Q3 DISTINCT-ON probe, index-only walk (~10 ms → ~2.8 ms) | partial: excludes cancelled rows from both size and maintenance |

The partial predicate mirrors the loader's cancelled-exclusion exactly;
`0011_query_plan_indexes.sql` documents that coupling.

Rejected candidates (measured, not speculative):

- `orders (client_id, status, created_at DESC, id DESC)` — no plan improvement
  over the client-leading variant; extra column inflates writes.
- `orders (status, created_at DESC, id DESC, client_id)` — still required a
  full sort for DISTINCT ON; redundant with the existing
  `orders_status_created_idx`.
- `orders (client_id, created_at DESC, id DESC)` without the partial
  predicate — byte-for-byte duplicate of the existing
  `orders_client_created_idx`, and its full layout cannot serve the probe's
  status filter as an index-only walk; replaced by the partial variant.

## Regression coverage

`tests/integration/query-plan-indexes.test.ts` (CI-stable, runs against any
test-scoped `TEST_DATABASE_URL`):

1. All accepted indexes exist after migration (a dropped/renamed index fails
   loudly).
2. Line-by-order fetch resolves through `order_lines_order_id_idx`
   (Seq Scan disabled to assert the path itself).
3. Date-window order scans resolve through an index.
4. Representative attribution stays on the owner-leading quote index.

`tests/integration/report-metrics.test.ts` continues to pass against the
shape-changed metrics loader, proving semantic equivalence; the
representative-scope EXISTS rewrite is exercised by the same suite's fixture.

## Budgets

Against `docs/performance-baseline.md` controlled-environment targets, all
profiled queries are comfortably inside budget at standard scale (worst case
~34 ms against the ≤750 ms grouped-report target). The remaining dominant cost
is the Q3 outer projection join, which is bounded by
`MAX_METRIC_SOURCE_ORDERS` and does not warrant further optimization at this
scale. Environment-dependent caveats from the baseline document apply: these
numbers are diagnostic evidence, not hard CI gates.

## Known coupling

`orders_client_latest_idx` is a partial index whose predicate must stay in
lockstep with the report metrics loader's cancelled-exclusion. If the loader
ever counts cancelled orders in the DISTINCT-ON probe, this index silently
stops serving it; `tests/integration/query-plan-indexes.test.ts` pins both
the index's existence and the loader's access path so the drift surfaces in
CI.
