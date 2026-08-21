# Reconciliation evidence — `project.pdf` release matrix

Supporting evidence for
[`../project-pdf-release-reconciliation.md`](../project-pdf-release-reconciliation.md)
(Kanban task `t_d5d2fe7f`, 2026-08-21).

These files live under `docs/` because `artifacts/` is gitignored and this
evidence must survive a clean checkout.

## Files

| File | What it proves |
| --- | --- |
| `runtime-schema-probe.sql` | Eleven SQL fragments copied from shipped server code, plus three control queries. |
| `runtime-schema-probe.out` | The result. All eleven probes fail; all three controls pass. |
| `verify-runtime-schema.py` | Scans `src/**` for table names in raw SQL and compares them with a live production-migrated database. |
| `schema-divergence.py` | Compares tables created by `drizzle/canonical/` with those created by `drizzle/*.sql`. |
| `cnpj-check.py` | Check-digit validation of the CNPJ shipped in `src/features/landing/content.ts`. |

## Reproduce the schema probe

Requires Docker and Bun. It does not touch any existing database.

```sh
docker run -d --name weyne-recon-pg \
  -e POSTGRES_PASSWORD=recon -e POSTGRES_USER=recon -e POSTGRES_DB=recon \
  -p 55439:5432 postgres:17.6-alpine

# Apply only the production migration path.
DATABASE_URL="postgresql://recon:recon@127.0.0.1:55439/recon" \
  bun scripts/migrate-database.ts

docker cp docs/review/project-pdf-reconciliation/runtime-schema-probe.sql \
  weyne-recon-pg:/tmp/p.sql
docker exec weyne-recon-pg psql -U recon -d recon -f /tmp/p.sql

docker rm -f weyne-recon-pg
```

Expected result today: the migrator applies four migrations and reports
`migration.process_succeeded`. The probe then reports one missing column and ten
missing relations. The three control queries return zero rows without error.

The probe passes only when every relation the shipped code queries is created by
`drizzle/canonical/`.
