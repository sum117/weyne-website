-- weyne:migration compatibility=expand previous-app-compatible=true
-- Query-plan indexes for the report, commission, and dashboard paths
-- (kanban t_8963f08e). Every index is justified by a measured
-- EXPLAIN (ANALYZE, BUFFERS) before/after pair recorded in
-- artifacts/performance/profiling/ and summarized in
-- docs/performance-profiling.md.
--
-- All are expand-only: they never rewrite table rows, are invisible to
-- existing query semantics, and are reversible with DROP INDEX.

-- Date-range scans behind the commission totals/page and the report window.
-- Before: full orders Seq Scan + filter (~9.5 ms at 25k orders); after:
-- Bitmap/Index scan on the range (~4.4 ms), and index-only for unqualified
-- range probes. Also serves newest-first order lists.
CREATE INDEX IF NOT EXISTS orders_created_idx
  ON orders (created_at, id);

-- Line fetch by parent order. The only pre-existing path into order_lines
-- was the unique (order_id, line_number) constraint; its composite layout
-- still forced a 150k-row Seq Scan whenever the IN-list exceeded the cache.
CREATE INDEX IF NOT EXISTS order_lines_order_id_idx
  ON order_lines (order_id);

-- Representative attribution flows through quotes.owner_user_id; every
-- representative-scoped report/commission query filtered quotes by owner via
-- Seq Scan. Owner-leading keeps the RBAC probe cheap without disturbing the
-- quote-number and source lookups that already have indexes.
CREATE INDEX IF NOT EXISTS quotes_owner_idx
  ON quotes (owner_user_id, id);

-- DISTINCT-ON latest-order-per-client probe in the report metrics loader.
-- The plain orders_client_created_idx exists but its full layout cannot
-- serve the probe's `status <> 'cancelled'` filter as an index-only walk;
-- this partial variant can, cutting the probe from ~10 ms to ~2.8 ms at
-- 25k orders. The predicate must mirror the loader's cancelled-exclusion.
CREATE INDEX IF NOT EXISTS orders_client_latest_idx
  ON orders (client_id, created_at DESC, id DESC)
  WHERE status <> 'cancelled';
