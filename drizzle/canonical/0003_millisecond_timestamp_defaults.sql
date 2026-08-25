-- weyne:migration compatibility=expand previous-app-compatible=true
-- Truncate timestamptz defaults and stored values to millisecond resolution.
--
-- PostgreSQL `now()` resolves to microseconds, but every timestamp that leaves
-- this system round-trips through a JavaScript `Date`, which only carries
-- milliseconds. Keyset pagination encodes that truncated Date into its cursor,
-- so a stored microsecond value compared as strictly greater than the cursor
-- derived from it and the boundary row repeated on the following page.
--
-- Truncating at the source makes the stored precision equal the precision the
-- application can represent, which restores the keyset invariant
-- `(sort_column, id)` uniquely identifies a page boundary. Existing rows are
-- backfilled so cursors stay correct across the upgrade.
--
-- This is expand-only: it rewrites DEFAULT expressions and normalizes existing
-- values. No column is dropped, renamed, or retyped, so the previous
-- application image keeps working against the migrated schema.

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = current_schema()
      AND t.table_type = 'BASE TABLE'
      AND c.data_type = 'timestamp with time zone'
      AND c.column_default LIKE '%now()%'
      AND c.column_default NOT LIKE '%date_trunc%'
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I SET DEFAULT date_trunc(''milliseconds'', now())',
      target.table_name,
      target.column_name
    );

    EXECUTE format(
      'UPDATE %I SET %I = date_trunc(''milliseconds'', %I) WHERE %I <> date_trunc(''milliseconds'', %I)',
      target.table_name,
      target.column_name,
      target.column_name,
      target.column_name,
      target.column_name
    );
  END LOOP;
END
$$;
