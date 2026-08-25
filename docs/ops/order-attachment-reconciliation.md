# Order Attachment Storage Reconciliation (Ops Runbook)

Operational job that reconciles `order_attachments` metadata against private
object storage. It detects three inconsistency classes and, only in apply
mode, performs bounded policy cleanup.

## Inconsistency classes

| Class | Meaning | Default action |
| --- | --- | --- |
| `missing_object` | `ready` attachment row whose stored object is gone | Report as critical; never auto-repaired |
| `abandoned_upload` | `pending` row older than the pending grace window | Apply mode: mark row `failed` |
| `orphaned_object` | Stored object unreferenced past the orphan grace window | Apply mode: delete object |

## Safety model

- **Dry-run is the default.** Without `--apply` nothing is mutated anywhere.
- Active uploads are never flagged: a `pending` row younger than
  `STORAGE_PENDING_GRACE_MINUTES` counts as in-flight.
- Objects uploaded more recently than `STORAGE_ORPHAN_GRACE_DAYS` are never
  considered orphans, which absorbs the metadata-insert/upload race window.
- The job is idempotent: rerunning after a completed pass performs no new
  actions; partial failures are reported (`status: action_errors`) and the
  failed items are simply retried on the next run.
- Reports contain SHA-256 fingerprints of keys/record IDs — never raw object
  keys, filenames, order UUIDs, signed URLs, or credentials.

## Running

```bash
# Dry run (default) — report only
bun scripts/reconcile-object-storage.ts --source=order-attachments

# Apply policy cleanup
bun scripts/reconcile-object-storage.ts --source=order-attachments --apply

# Legacy whole-bucket sweep (product attachments + quote PDFs, report-only)
bun scripts/reconcile-object-storage.ts
```

Exit codes: `0` clean, `2` discrepancies found (dry-run findings or post-run
residue such as missing objects), `1` hard error or cleanup failure
(`action_errors`).

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORAGE_PENDING_GRACE_MINUTES` | 60 | How long a `pending` row may sit before it is treated as abandoned. Must be an integer 1–1440. Set above your worst-case upload duration. |
| `STORAGE_ORPHAN_GRACE_DAYS` | 7 | How old an unreferenced object must be before deletion eligibility. Integer 1–90. Keep ≥ 7 so any in-flight upload plus replication lag fits inside the window. |

Requires `DATABASE_URL` and the standard S3 variables (`S3_REGION`,
`S3_BUCKET`, credentials via the ambient provider chain).

## Scheduling

Run dry-run hourly and apply-mode daily during low traffic, for example:

```cron
0 * * * *  bun scripts/reconcile-object-storage.ts --source=order-attachments
30 4 * * * bun scripts/reconcile-object-storage.ts --source=order-attachments --apply
```

Do not run two apply passes concurrently; the job is safe to retry but not
designed for parallel execution against the same bucket.

## Operator recovery

1. **`missing_object` alerts** — the corresponding order attachment download
   already fails with `ATTACHMENT_NOT_READY`. Restore the object from backup,
   or mark the row `failed` manually if no backup exists. Never re-point the
   row at another order's object key.
2. **Abandoned upload marked `failed`** — user-visible effect is only that the
   unusable upload disappears from active listings. The client can simply
   upload again; no data was lost beyond the failed attempt.
3. **Orphan deleted by mistake** — objects deleted by this job were already
   unreferenced for at least the grace period. Recover from bucket
   versioning/backup if a false negative ever slips through, then re-run.
4. **`action_errors` status** — inspect the sanitized `actionErrors` array for
   the failing class, fix storage/database availability, and re-run. No manual
   state reset is needed; successful actions are not repeated because their
   preconditions (pending row / aged orphan) no longer hold.
