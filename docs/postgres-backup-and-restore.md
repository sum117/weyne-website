# PostgreSQL backup and restore operations

## Contract

Weyne uses PostgreSQL custom-format logical dumps. `deploy/postgres/backup.sh` records one immutable bundle per successful run:

- `database.dump` — `pg_dump --format=custom`, compressed, without owner or ACL statements;
- `counts.tsv` — exact row counts for every non-system table from the same exported repeatable-read snapshot as the dump;
- `manifest.env` — backup identity, UTC timestamp, source database, format, and tool version (no connection string or credential);
- `SHA256SUMS` — SHA-256 for the dump, counts, and manifest.

A bundle is first written as a hidden partial directory and renamed to `weyne-<UTC>-<random>.backup` only after all files and checksums exist. `STATUS=complete` is required for retention and restore. Logs are single-line key/value events and never print passwords or connection URLs.

## Security and storage requirements

These are release requirements, not suggestions:

1. `/srv/weyne/backups/postgres` must be a dedicated encrypted-at-rest filesystem or encrypted block volume. The scripts intentionally do not create plaintext copies outside that mount. If the storage provider does not guarantee encryption at rest, deployment must stop.
2. Mount the directory only into the one-shot operations containers. Host mode is `0700`; bundle files are `0600`. Owner is the dedicated `weyne-ops` account. Application and tunnel containers receive no backup mount.
3. Replicate completed bundles to a second encrypted failure domain with authenticated TLS. Replication is downstream of the atomic rename and must copy the complete directory. Never replicate `.partial` or `.backup.lock` entries. The separate object-storage recovery policy owns reconciliation.
4. Credentials exist only as root-owned runtime files under `/etc/weyne/secrets` (`0600`). Compose mounts them as secrets. Do not put passwords in Git, Compose environment values, command arguments, backup metadata, or alert payloads.
5. The backup role needs `CONNECT`, `USAGE` on application schemas, `SELECT` on all application tables/sequences, and default privileges for future objects. It must not own the database or have write/DDL roles. The restore-drill role needs `CREATEDB`, connectivity to the maintenance database, and permission to restore the dump; use a dedicated role, never the application role.
6. Traffic to a remote PostgreSQL server must enforce TLS (`PGSSLMODE=verify-full` plus the runtime CA path). For the production same-host private Compose network, no database port is published.

Example role preparation (operator-only; adapt schema names through reviewed migrations):

```sql
CREATE ROLE weyne_backup LOGIN;
GRANT CONNECT ON DATABASE weyne TO weyne_backup;
GRANT USAGE ON SCHEMA public TO weyne_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO weyne_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO weyne_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO weyne_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO weyne_backup;
CREATE ROLE weyne_restore_operator LOGIN CREATEDB;
```

Set passwords interactively or through the secret manager; never place values in the SQL history.

## Retention and pruning

Defaults are 14 bundles and 30 days. A completed bundle is pruned when it exceeds either limit: its chronological rank is greater than `RETAIN_COUNT`, or its recorded age is greater than `RETAIN_DAYS`. The newest bundle is therefore retained by the positive count floor. Partial, malformed, unrelated, and incomplete directories are ignored.

Preview safely:

```sh
./postgres/prune-backups.sh --dry-run /srv/weyne/backups/postgres 14 30
```

Pruning runs only after a new bundle is complete. An atomic `mkdir` lock at `.backup.lock` makes overlap fail visibly with exit 75 and `reason=overlapping_job_lock_exists`; it does not silently skip. Normal and signal cleanup remove the lock. After a host/container hard kill, inspect logs and running jobs before manually removing a confirmed-stale lock.

## Install the daily schedule

Operator-only production steps:

1. Copy `deploy/postgres-backup.env.example` to `/etc/weyne/postgres-backup.env`; set the PostgreSQL host/port, the existing private Docker network on which that host is resolvable, and absolute runtime paths. The operations stack is intentionally independent of the application/tunnel Compose file, so it does not require application image or Cloudflare variables. Mode `0600`, owner `root:weyne-ops`.
2. Create the encrypted backup mount and the two password files. Set directory mode `0700` and secret modes `0600`.
3. Optionally place `ALERT_WEBHOOK_URL` in `/etc/weyne/postgres-backup-alert.env` (`0600`). With no webhook the failure is still prominent in the journal; production must connect either this webhook or an external systemd failure monitor.
4. Copy the three units from `deploy/systemd/` to `/etc/systemd/system/`, then run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now weyne-postgres-backup.timer
sudo systemctl list-timers weyne-postgres-backup.timer
sudo systemctl start weyne-postgres-backup.service
sudo journalctl -u weyne-postgres-backup.service -n 100 --no-pager
```

The timer runs daily at 03:15 UTC with up to 15 minutes of jitter, is persistent across downtime, and invokes the one-shot Compose operations service. `OnFailure` records a visible journal error and optionally posts a secret-free webhook alert.

## Manual backup

From `/opt/weyne/deploy`:

```sh
docker compose --env-file /etc/weyne/postgres-backup.env \
  -f docker-compose.postgres-ops.yml \
  --profile operations run --rm postgres-backup
```

Success reports `status=succeeded`, `backup_id`, UTC creation time, and artifact path. Any missing tool/secret, connection error, lock conflict, dump/count/checksum failure, or prune failure exits nonzero.

## Automated restore drill

Select a complete bundle; never point at an individual dump file. The target is generated with a mandatory `weyne_restore_` prefix, must not exist, and must differ from the source database. The script creates that clean database, verifies artifact checksums before any database connection, restores with `--exit-on-error`, recomputes all table counts, compares them byte-for-byte, reports totals, and drops the disposable database. It never drops or cleans an existing database.

```sh
export RESTORE_DATABASE=weyne_restore_$(date -u +%Y%m%dT%H%M%SZ)
docker compose --env-file /etc/weyne/postgres-backup.env \
  -f docker-compose.postgres-ops.yml \
  --profile operations run --rm \
  -e RESTORE_DATABASE="$RESTORE_DATABASE" \
  postgres-restore-drill /backups/weyne-YYYYMMDDTHHMMSSZ-random.backup
```

Expected final event:

```text
operation=postgres_restore_drill status=succeeded backup_id=... backup_created_at=... restore_database=weyne_restore_... checksum=verified tables_verified=... rows_verified=... disposable_database_removed=true
```

Set `KEEP_RESTORE_DATABASE=true` only in an isolated staging environment when an operator needs forensic inspection; then explicitly drop it after review. Production drills must keep the default cleanup.

### Corruption and failure behavior

A modified dump, counts file, or manifest fails checksum verification with exit 65 before connecting. A restore error, pre-existing target, row-count mismatch, or cleanup/connection prerequisite error is also nonzero. Preserve the structured output and `journalctl` excerpt as drill evidence, but never attach secret files.

## Local acceptance rehearsal

Docker Desktop/Engine is required. This creates representative `customers` and `quotes` data in a disposable PostgreSQL 17 container, takes a backup, restores it into a clean database, verifies two tables/five rows, corrupts a copy, and requires the corrupt restore to be visibly nonzero:

```sh
bash scripts/verify-postgres-backup.sh
```

The final line must include:

```text
acceptance=passed ... checksums=verified counts=verified corrupt_backup=visible_nonzero
```

## Recovery procedure and decision points

1. Declare the incident and stop application writes. Record desired recovery point, selected `backup_id`, `CREATED_AT_UTC`, and incident owner.
2. Confirm the bundle is complete, available in both failure domains if possible, and passes `sha256sum -c SHA256SUMS`. Abort on any mismatch; select an older verified bundle and escalate.
3. Run the restore drill above. Abort promotion if dump restoration or counts fail. A checksum-only success is not enough.
4. Restore the selected bundle into a new recovery database, never over production. Apply only reviewed forward migrations compatible with the target application image.
5. Point a staging application instance at the recovery database and validate login, representative records, quotes/orders, attachments metadata, and critical totals. Record application-level evidence.
6. Promote through a reviewed database endpoint/configuration switch. Keep the old production database read-only until the recovery is accepted. Roll back by switching the endpoint back; do not mutate both databases during the decision window.
7. Rotate any credentials exposed by the incident, re-enable writes, run a fresh backup, and confirm the next scheduled timer and off-host replication.

Current objective: daily schedule gives a nominal RPO of 24 hours plus timer jitter; target drill RTO is 60 minutes. Actual RPO/RTO depend on encrypted off-host replication and dataset growth and must be measured quarterly. Escalate missing/corrupt backups, inability to create a clean target, row-count differences, or a drill exceeding 60 minutes to the production owner; do not waive an invariant to meet the clock.

## Quarterly evidence checklist

- selected backup identity and UTC timestamps;
- systemd unit exit status and structured backup output;
- SHA-256 verification result;
- restored table and row totals plus application invariants;
- proof the disposable target was removed;
- deliberate corrupt-copy nonzero result;
- retention dry-run and actual retained bundle list;
- encrypted-volume and off-host replication status;
- duration, observed RPO/RTO, gaps, owner, and follow-up task IDs.
