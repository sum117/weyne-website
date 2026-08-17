# Local PostgreSQL workflow

The implemented schema reference is
[`docs/domain/canonical-glossary-er-model.md`](domain/canonical-glossary-er-model.md).
It describes the 25-table `src/lib/db/schema/canonical.ts` model and the
`drizzle/canonical` migration chain. This database is single-organization:
there are no `tenant_id` or `organization_id` columns.

The local database is PostgreSQL 17.6 in Docker Compose. Its fixed database and
user are development-only values committed for predictability. The
localhost-bound service uses PostgreSQL trust authentication so no credential
is stored in Git; production must never use trust authentication. The database
binds only to `127.0.0.1` and persists in the Compose-managed `postgres-data`
volume.

## Prerequisites and environment

Install Bun 1.3+ and Docker Desktop (or Docker Engine with Compose v2). Copy the
example environment once so Vite and server-side development code receive the
same local URL:

```sh
cp .env.example .env
```

The default URL is
`postgresql://weyne_dev@127.0.0.1:5432/weyne_dev`. If port 5432
is occupied, set `WEYNE_DATABASE_PORT` and update the port in `DATABASE_URL` to
the same value. The database lifecycle scripts always construct their own
local-only URL and never consume a production `DATABASE_URL`.

## First boot and normal use

```sh
bun run db:setup          # start, wait, migrate from zero, and idempotently seed
bun run dev
```

The individual steps are available when diagnosing or scripting:

```sh
bun run db:up             # start the persistent PostgreSQL service
bun run db:wait           # fail unless readiness is reached within 60 seconds
bun run db:migrate:local  # wait, then apply every pending reviewed migration
bun run db:seed           # insert/verify the four canonical price lists
bun run db:down           # stop containers while retaining database data
```

`bun run db:migrate` remains the environment-neutral migration command. It
requires an explicitly supplied server-only `DATABASE_URL`; use it for CI or
operator-controlled environments, not for local lifecycle management.

For a non-local PostgreSQL database, the equivalent safe operations are:

```sh
DATABASE_URL='postgresql://user:password@host/database' bun run db:migrate
DATABASE_URL='postgresql://user:password@host/database' bun scripts/seed-database.ts
TEST_DATABASE_URL='postgresql://user:password@host/test_admin' \
  bun run test:database tests/integration/canonical-schema-contract.test.ts
```

The seed is intentionally narrow and repeatable: it creates only the four
permanent `price_lists` rows (`PRICE_1` through `PRICE_4`) with stable IDs and
fails if an existing identity is inconsistent. The canonical integration test
applies both migrations to an isolated real PostgreSQL database and checks
deployed metadata, constraints, indexes, triggers, archive behavior,
numbering, and quote/order snapshots.

## Destructive reset and repeatability

```sh
bun run db:reset
```

This command destroys the `weyne-database_postgres-data` volume, recreates the
service, waits for health, migrates from zero, and applies the idempotent smoke
seed. It is intentionally destructive and must not be used for a database that
contains work you need to preserve. Running it repeatedly must produce the same
schema and seed state.

## Rollback and recovery

Application down migrations are intentionally unsupported. Reviewed migrations
move forward only. During local development, recover from an unwanted schema or
seed state with `bun run db:reset`; there is no local data-preserving rollback
promise. For production rollback, restore a verified backup or snapshot and
follow `docs/operations/migrations-and-rollback.md` rather than using these
local commands.

If startup fails, inspect `docker compose -f deploy/docker-compose.database.yml
ps` and `docker compose -f deploy/docker-compose.database.yml logs postgres`.
A port conflict requires the matching `WEYNE_DATABASE_PORT`/`DATABASE_URL`
change described above.
