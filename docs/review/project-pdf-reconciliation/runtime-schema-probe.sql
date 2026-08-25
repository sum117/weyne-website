-- Probes: exact SQL fragments taken from shipped server code, run against the
-- schema that `bun scripts/migrate-database.ts` (drizzle/canonical) creates.
\set ON_ERROR_STOP off

\echo ''
\echo '=== P1 catalog list projection (src/features/app/products/catalog.service.server.ts:288) ==='
SELECT p.internal_code AS "internalCode", p.internal_code_normalized AS "internalCodeNormalized" FROM products p LIMIT 1;

\echo ''
\echo '=== P2 audit viewer quote authorization (src/features/app/audit/audit-activity.functions.ts:99) ==='
SELECT resource_id::text FROM commercial_resource_scopes WHERE resource_type = 'quote' LIMIT 1;

\echo ''
\echo '=== P3 order visibility resolver (src/domain/orders/read-visibility.server.ts) ==='
SELECT 1 FROM commercial_resource_assignments LIMIT 1;

\echo ''
\echo '=== P4 quote PDF artifact store (src/lib/quotes/pdf-artifact-postgres.server.ts) ==='
SELECT 1 FROM quote_pdf_artifacts LIMIT 1;

\echo ''
\echo '=== P5 quote conversion immutable version history (src/lib/orders/quote-conversion.server.ts:172) ==='
SELECT 1 FROM quote_versions LIMIT 1;

\echo ''
\echo '=== P6 quote lifecycle command ledger (src/lib/quotes/lifecycle-postgres.server.ts) ==='
SELECT 1 FROM quote_lifecycle_commands LIMIT 1;

\echo ''
\echo '=== P7 order attachments (src/lib/orders/attachment-repository.server.ts) ==='
SELECT 1 FROM order_attachments LIMIT 1;

\echo ''
\echo '=== P8 price history (src/lib/catalog/pricing.server.ts) ==='
SELECT 1 FROM product_price_history LIMIT 1;

\echo ''
\echo '=== P9 catalog audit (src/features/app/products/catalog.service.server.ts:377) ==='
SELECT 1 FROM catalog_audit LIMIT 1;

\echo ''
\echo '=== P10 order state audit (src/domain/orders/history-source.server.ts) ==='
SELECT 1 FROM order_state_audit LIMIT 1;

\echo ''
\echo '=== P11 order line taxes (src/lib/orders/quote-conversion.server.ts) ==='
SELECT 1 FROM order_line_taxes LIMIT 1;

\echo ''
\echo '=== CONTROL: tables the production schema DOES create ==='
SELECT 1 FROM quotes LIMIT 1;
SELECT 1 FROM order_lines LIMIT 1;
SELECT 1 FROM audit_events LIMIT 1;
