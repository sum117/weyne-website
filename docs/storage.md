# Private S3-compatible object storage

Server-side object storage uses the AWS SDK through
`src/lib/storage/s3.server.ts`. Feature code depends only on this S3-compatible
adapter; selecting MinIO, Cloudflare R2, or another compatible provider does not
require provider-specific imports.

Never prefix these variables with `VITE_`: credentials are server-only secrets.

## Runtime variables

| Variable | Required | Purpose | Local default |
|---|---:|---|---|
| `S3_ENDPOINT` | No | Provider endpoint. Omit for AWS S3; set the MinIO or R2 endpoint otherwise. | `http://127.0.0.1:9000` |
| `S3_REGION` | Yes | Signing region. R2 commonly uses `auto`; MinIO uses `us-east-1` here. | `us-east-1` |
| `S3_BUCKET` | Yes | Private bucket name. | `weyne-private` |
| `S3_ACCESS_KEY_ID` | Yes | S3-compatible access key. | local-only value in the example file |
| `S3_SECRET_ACCESS_KEY` | Yes | S3-compatible secret key. | local-only value in the example file |
| `S3_FORCE_PATH_STYLE` | No | `true` for MinIO/path-style endpoints; otherwise `false`. | `true` |
| `S3_SIGNED_URL_TTL_SECONDS` | No | Presigned download lifetime, from 1 through 604800 seconds. | `900` |

`parseS3Config(process.env)` validates and normalizes these values,
`createS3Client(config)` creates the AWS SDK client, and
`createObjectDownloadUrl(client, config, key)` applies the configured URL
lifetime. Invalid configuration errors never include credential values.

For Cloudflare R2, use the account's S3 API endpoint and credentials, set the
region required by R2, and normally leave path-style addressing disabled. Keep
the bucket private; signed URLs are the application-controlled access path.

## Local MinIO

Prerequisites: Docker with Compose and Bun.

```bash
cp deploy/.env.storage.example deploy/.env.storage
bun run storage:up
bun run storage:smoke
```

- API: `http://127.0.0.1:9000`
- Console: `http://127.0.0.1:9001`
- Stop while preserving the named data volume: `bun run storage:down`
- Remove local data deliberately: `bun run storage:down -- --volumes`

`storage:up` waits for MinIO and then runs the idempotent `minio-init` service.
The init step creates the configured bucket with `mc mb --ignore-existing`,
explicitly applies `mc anonymous set none`, and prints bucket metadata. Repeated
starts therefore preserve data while reasserting that anonymous access is
disabled. Do not add a public bucket policy or an `anonymous set download`
bootstrap command.

## Privacy smoke check

`bun run storage:smoke` performs all of the following against the configured
endpoint:

1. authenticates with the AWS SDK and checks the bucket;
2. writes and reads a random temporary object through authenticated SDK calls;
3. requests both the bucket and object URLs without credentials and requires an
   explicit HTTP 401 or 403 denial;
4. deletes the temporary object in a `finally` block.

A successful run reports both anonymous HTTP statuses. A 2xx, redirect, 404, or
any other response fails the check rather than treating an ambiguous result as
private.

The local Compose file is development/test infrastructure only. Production R2
credentials belong in the server runtime's secret store, never in a committed
environment file or client bundle.

## Production protection policy

The production provider is Cloudflare R2. The private application bucket is the
working copy; it is **not** a backup. Protection independent of PostgreSQL is a
second, bucket-scoped R2 backup bucket in a separate Cloudflare account, copied
daily by an operator-owned job. The backup account must have separate owners and
billing recovery contacts from the application account.

The supported protection layers are:

1. `rclone copy`, never `sync`, copies the primary bucket to the backup bucket
   every day. Object keys are immutable identifiers, so replacement is an
   incident rather than a supported update path. The job uses `--immutable` and
   must fail on a same-key content mismatch.
2. The backup bucket has an R2 bucket-lock rule for all application prefixes for
   90 days. R2 documents that bucket locks prevent deletion and overwriting and
   take precedence over lifecycle deletion. This limits damage even if the
   copier credential is compromised.
3. A backup-bucket lifecycle rule expires objects after 120 days. The longer
   lock wins while active. No lifecycle deletion rule is permitted on the
   primary application prefixes.
4. The live inventory reconciliation below runs daily after the copy and after
   every database restore. It detects divergence; it never deletes or rewrites
   either system.

Provider references, verified 2026-08-17:

- <https://developers.cloudflare.com/r2/buckets/bucket-locks/>
- <https://developers.cloudflare.com/r2/buckets/object-lifecycles/>

### Operator-only provisioning

These are production control-plane actions. Test them on a staging bucket
first. Do not paste tokens into commands, shell history, Compose files, CI
variables, or this repository.

1. Create the backup bucket in the backup Cloudflare account.
2. Create a source credential scoped to the primary bucket with object
   list/read only. Create a distinct destination credential scoped only to the
   backup bucket with object list/write. Neither credential is the application's
   runtime credential. Store all values in the deployment secret manager.
3. Configure a 90-day bucket lock and a 120-day lifecycle expiration on the
   backup bucket. Use `wrangler r2 bucket lock list <backup-bucket>` and
   `wrangler r2 bucket lifecycle list <backup-bucket>` to capture verification
   output. Abort provisioning if the lock is absent, disabled, scoped to the
   wrong prefix, or shorter than 90 days.
4. Configure two `rclone` S3 remotes entirely through injected environment
   variables. At minimum inject the following; access and secret keys come from
   the secret manager, while endpoint and bucket values are ordinary runtime
   configuration:

   ```text
   RCLONE_CONFIG_WEYNE_PRIMARY_TYPE=s3
   RCLONE_CONFIG_WEYNE_PRIMARY_PROVIDER=Cloudflare
   RCLONE_CONFIG_WEYNE_PRIMARY_ACCESS_KEY_ID=<secret>
   RCLONE_CONFIG_WEYNE_PRIMARY_SECRET_ACCESS_KEY=<secret>
   RCLONE_CONFIG_WEYNE_PRIMARY_ENDPOINT=<primary R2 S3 endpoint>
   RCLONE_CONFIG_WEYNE_BACKUP_TYPE=s3
   RCLONE_CONFIG_WEYNE_BACKUP_PROVIDER=Cloudflare
   RCLONE_CONFIG_WEYNE_BACKUP_ACCESS_KEY_ID=<secret>
   RCLONE_CONFIG_WEYNE_BACKUP_SECRET_ACCESS_KEY=<secret>
   RCLONE_CONFIG_WEYNE_BACKUP_ENDPOINT=<backup R2 S3 endpoint>
   PRIMARY_S3_BUCKET=<primary bucket>
   BACKUP_S3_BUCKET=<backup bucket>
   ```

   The scheduled command is:

   ```sh
   rclone copy "weyne-primary:${PRIMARY_S3_BUCKET}" \
     "weyne-backup:${BACKUP_S3_BUCKET}" \
     --checksum --immutable --fast-list --log-format json
   ```

   Redact remote URLs and object keys before forwarding logs to alerting.
5. Schedule the copy daily at 02:00 UTC and reconciliation at 03:00 UTC. Alert
   on any non-zero copy exit. A copy failure does not authorize deletion or
   bypassing the lock.

The operations owner owns the job, credentials, daily alerts, and quarterly
restore drill. The application owner owns the complete database reference
query. The data owner approves any permanent orphan purge. Two people must
approve reducing retention, removing a lock, or deleting from the backup
bucket.

### Retention and recovery expectations

| Control | Contract |
|---|---|
| Copy frequency / object RPO | Daily; at most 24 hours for an object that reached the primary bucket before a successful run |
| PostgreSQL RPO | Defined by the database backup runbook; it is not assumed to match object-copy time |
| Object recovery RTO | Four hours during staffed operations, provided the object exists in the backup bucket |
| Backup immutability | 90 days from object creation in the backup bucket |
| Backup expiration | 120 days; bucket lock takes precedence if rules overlap |
| Orphan observation grace | Seven days and two consecutive daily reports before a human may propose deletion |
| Automated deletion | Forbidden; reconciliation is read-only and no output is a deletion instruction |

Logical deletion hides an object from users before any physical purge. A
physical purge from the primary bucket is operator-controlled and must wait at
least seven days. Backup retention is not shortened when the primary object is
deleted. Legal hold or an active incident suspends all purges.

## Inventory reconciliation

`scripts/reconcile-object-storage.ts` takes a repeatable-read PostgreSQL
snapshot of storage-bearing rows, lists the complete live bucket with paginated
`ListObjectsV2`, and compares the sets. The database query covers active product
attachments, active product-photo variants, and completed quote PDF artifacts.
When another table gains an object key, adding it to this query is part of that
schema change's acceptance criteria.

Run it with runtime-injected `DATABASE_URL` plus the server-only `S3_*`
variables listed above:

```sh
STORAGE_ORPHAN_GRACE_DAYS=7 bun run storage:reconcile
```

Exit codes are `0` for a clean report, `2` for discrepancies, and `1` for an
operational/configuration failure. Standard output is one JSON event suitable
for alerting. It contains only truncated SHA-256 fingerprints for object keys
and record locators, never raw keys, record IDs, credentials, connection URLs,
or provider error messages. Results are sorted and deduplicated, so rerunning
against unchanged snapshots is stable.

- `missing_object` / `critical`: PostgreSQL requires an object absent from the
  live inventory. Freeze destructive maintenance, rerun once to exclude a
  transient boundary, then restore the key from the backup bucket or restore a
  database snapshot whose reference set matches storage.
- `orphaned_object` / `warning`: an object older than the configured grace
  period has no active database reference. Investigate upload/audit history.
  Do not delete it from this report. A data-owner-approved purge requires two
  consecutive reports at least 24 hours apart and a separate change record.
- Recent unreferenced objects are counted but not alerted as orphans. This
  absorbs uploads committed after the database snapshot and delayed database
  writes.

For secure diagnosis, use `source` to select the named table on an operator
workstation, hash each candidate `object_key` and `source:id` locally with
SHA-256, and match the first 16 hexadecimal characters to the report. Do not
put the resulting raw key in tickets or alert payloads.

### Different capture times

The script captures PostgreSQL first and storage second. It cannot make a
distributed atomic snapshot. An upload committed between captures appears as a
recent unreferenced object and is covered by the seven-day grace. A deletion
between captures can appear missing; rerun after application writes settle
before remediation. Missing objects remain critical because an orphan superset
is safe, while a database reference without bytes is not.

For disaster recovery choose database recovery time `Tdb`, then use the first
successful object copy completed at or after `Tdb`. Restore the database and
required objects into isolated recovery targets, run reconciliation there, and
promote only when there are no missing objects. Older backup-only objects may
remain as non-destructive orphans until retention expires. Never force the
object bucket back to an earlier timestamp merely to eliminate orphans.

### Safe fake-object demonstration

This command uses only in-memory fake references and inventory. It requires no
database, bucket, Docker, or credentials and performs no network or delete
operation:

```sh
bun run storage:reconcile:test
```

Expected: exit `0` with a redacted JSON report containing exactly one
`missing_object`, one `orphaned_object`, and
`"destructiveActionsPerformed":false`. The fake run intentionally reports
discrepancies while succeeding so it can be used in drills. The focused unit
test is `bun run test tests/unit/object-storage-reconciliation.test.ts`.

### Restore and reconcile

1. Stop writes for the affected feature and preserve the report and copy-job
   run ID. Do not disclose raw keys in the incident channel.
2. Confirm the discrepancy with a second live reconciliation. For a missing
   object, locate the fingerprint securely and copy that exact key from the
   locked backup bucket to an isolated recovery bucket. Verify size, checksum
   metadata where available, and application-level MIME validation.
3. If the recovered bytes match the database metadata, copy the object to the
   primary bucket under the same immutable key and rerun reconciliation. If no
   valid backup exists, restore PostgreSQL plus objects into isolation from a
   known compatible pair; do not silently drop the reference.
4. For an orphan, first prove that no active, soft-deleted, in-flight, audit, or
   restored record owns it. Keep it through the grace period. A separately
   reviewed purge may delete only from primary; backup lock/lifecycle remains
   authoritative.
5. Resume writes only after the critical count is zero and the owner records
   checksums/counts, recovery timestamps, and any accepted orphan warnings.
