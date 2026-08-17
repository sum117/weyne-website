# Catalog and pricing PostgreSQL acceptance

The catalog/pricing acceptance suite runs against PostgreSQL 17.6, never an
in-memory adapter. It covers the reviewed catalog migrations, the four canonical
price lists, catalog CRUD-with-archive flows, facets and normalized-code search,
Decimal serialization, commission precedence, RBAC/audit behavior, atomic price
history, and deterministic product/price race scenarios. Product media is
intentionally outside this suite and unknown media input is rejected.

## Run locally

Docker must be available. With no database variable configured, the runner
starts a disposable `postgres:17.6-alpine` container, waits for readiness, runs
the tests in isolated schemas, and removes the container afterward:

```sh
bun run test:database -- \
  tests/integration/catalog-schema.test.ts \
  tests/integration/catalog-service.test.ts \
  tests/integration/pricing-service.test.ts \
  tests/integration/catalog-rbac-audit.test.ts \
  tests/integration/catalog-pricing-acceptance.test.ts
```

To reuse an existing CI/test PostgreSQL instance, provide only an explicitly
test-scoped database name through `TEST_DATABASE_URL`:

```sh
TEST_DATABASE_URL='postgresql://weyne_ci:***@127.0.0.1:5432/weyne_ci_test' \
  bun run test:database -- tests/integration/catalog-pricing-acceptance.test.ts
```

The harness rejects non-test database names and creates a random schema per test
file, so parallel files cannot share catalog rows. The CI PostgreSQL service in
`.github/workflows/ci.yml` already uses PostgreSQL 17.6 and the compatible
`weyne_ci_test` database name.

## Apply migrations outside the isolated test harness

The test harness applies `drizzle/0001_catalog_pricing.sql` and
`drizzle/0002_catalog_audit.sql` directly inside its disposable schema. For an
empty operator-controlled or CI database, apply all reviewed migrations with the
server-only application variable before running smoke tests:

```sh
DATABASE_URL='postgresql://user:***@host:5432/database' bun run db:migrate
```

For the persistent local development database, use `bun run db:setup` on first
boot or `bun run db:migrate:local` afterward; see `docs/local-database.md`.
