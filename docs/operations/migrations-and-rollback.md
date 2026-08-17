# Production database migrations and application rollback

This runbook covers the database gate that must complete before a new immutable Weyne application image starts. Database migrations are forward-only. Operators must never edit an applied SQL file or the `public.weyne_schema_migrations` ledger.

## Safety contract

Every `drizzle/NNNN_name.sql` file must:

- use a unique `NNNN_name.sql` filename; execution order is the full filename's bytewise sort order;
- start with `-- weyne:migration compatibility=expand previous-app-compatible=true`; and
- remain additive and usable by both the new image and the immediately previous image.

The preflight validates the local ordering and checksums, PostgreSQL reachability, the configured database user, `CONNECT` plus `USAGE,CREATE` privileges on `public`, and the applied ledger as an exact prefix of the immutable image's plan. It then obtains a PostgreSQL advisory lock. A second deploy fails rather than racing. Each migration and its ledger row commit in one transaction. Any error exits non-zero, leaves later migrations unapplied, and prevents Compose from replacing/starting `app`.

Structured migration logs contain event names, migration IDs, database/user/version metadata, and pending counts. Database URLs are redacted. Do not add SQL parameter values or environment dumps to these logs.

## Normal immutable-image deployment

Prerequisites: an immutable `ghcr.io/sum117/weyne-web@sha256:...` reference, a known-good previous digest, a tested PostgreSQL backup, and runtime-only `.env.weyne` values. `MIGRATION_CLEANUP_RELEASE` must be absent or empty for normal releases.

```sh
cd ~/weyne
cp .env.weyne .env.weyne.rollback
# Edit only WEYNE_IMAGE in .env.weyne to the new digest reference.
docker compose --env-file .env.weyne -f docker-compose.weyne.yml pull
docker compose --env-file .env.weyne -f docker-compose.weyne.yml up -d --wait
```

Expected migration log sequence: `migration.preflight_succeeded`, `migration.lock_acquired`, `migration.plan_validated`, zero or more migration start/success pairs, `migration.completed`, and `migration.process_succeeded`.

Abort if the migration container exits non-zero, the app is not healthy, a checksum/order mismatch appears, or the lock is held. Preserve the previous running app and inspect only redacted logs:

```sh
docker compose --env-file .env.weyne -f docker-compose.weyne.yml ps -a
docker compose --env-file .env.weyne -f docker-compose.weyne.yml logs --no-log-prefix migrate
```

Do not run `app` manually after a failed or partial migration. Correct the migration in a new immutable image; never rewrite a migration already recorded in the ledger.

## Application rollback after an expand migration

Expand migrations are deliberately compatible with the previous image, and database changes are not reversed. Restore the previous immutable digest in `.env.weyne`, pull it, then replace only the application. `--no-deps` is required: the previous image has an older migration plan and must not attempt to migrate a database that is already newer.

```sh
cd ~/weyne
cp .env.weyne.rollback .env.weyne
docker compose --env-file .env.weyne -f docker-compose.weyne.yml pull app
docker compose --env-file .env.weyne -f docker-compose.weyne.yml up -d --no-deps app
docker compose --env-file .env.weyne -f docker-compose.weyne.yml ps app web cloudflared
```

Verify `/healthz` through the private stack and the public tunnel. If the previous app cannot operate against the migrated schema, stop: the migration violated policy. Keep the last healthy app running where possible and escalate to database restore using the disaster-recovery runbook; do not improvise a down migration.

## Contract/cleanup release

Dropping or renaming tables/columns, incompatible type changes, new immediate `NOT NULL` constraints, and truncation are forbidden in expand releases. Cleanup is a separate later release after the rollback window has closed, all application versions that use the old shape are retired, and a fresh backup/restore drill has passed.

Mark that file `compatibility=contract previous-app-compatible=false`. The runner rejects it unless the operator explicitly names that one cleanup release:

```sh
MIGRATION_CLEANUP_RELEASE=NNNN_cleanup docker compose --env-file .env.weyne -f docker-compose.weyne.yml up migrate
```

Then unset `MIGRATION_CLEANUP_RELEASE` before normal operation. A contract migration ends N-1 application rollback compatibility. After it commits, rollback means restoring the pre-cleanup database backup together with the previous immutable image; merely changing `WEYNE_IMAGE` is unsafe.

## Known limits

- Compatibility is guaranteed only for the immediately previous immutable application image and only while all intervening migrations are expand migrations.
- PostgreSQL transactional DDL is required; migrations must not contain operations that cannot run inside the runner's transaction.
- The advisory lock serializes this application's migration runner, not arbitrary manual SQL.
- Successful earlier migrations remain committed if a later migration fails. Deployment remains blocked until a new immutable corrective release safely completes the suffix.
- Database rollback is backup restoration, not reverse SQL. Data written after the backup may be lost and must be reconciled under the disaster-recovery procedure.
