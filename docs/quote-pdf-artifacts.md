# Immutable quote PDF artifacts

This document defines the server-side generation boundary implemented in
`src/lib/quotes/pdf-artifacts.server.ts`. UI and download endpoints consume the
artifact service; they must not render PDFs independently.

## Source identity and history

A generation request contains only:

- an immutable quote snapshot (`snapshot.id`, positive `snapshot.version`, JSON
  payload, and captured image metadata);
- explicit template identity (`template.id`, positive `template.version`, and
  `summary` or `commercial` variant);
- the owning quote ID.

The service resolves the snapshot ID/version through its `loadSnapshot` port,
then validates, clones, and deeply freezes that persisted record before hashing
or rendering. Caller-supplied payload bytes are ignored. The loader must read
`quote_snapshots`, never reconstruct from mutable quote, customer, product, or
price rows. The service recomputes the snapshot SHA-256 from canonical
`id`/`version`/`payload`/`images` content and rejects any mismatch with the
stored snapshot checksum. The deterministic artifact source
checksum is SHA-256 over canonical JSON (recursively sorted object keys) that
includes quote, complete snapshot, and complete template identity.

`quote_pdf_artifacts` has a database unique constraint over:

```text
(quote_id, snapshot_id, snapshot_version,
 template_id, template_version, source_checksum)
```

Changing a quote requires a new snapshot/version and therefore a new artifact
identity. Changing template bytes or behavior requires a new template version.
Historical snapshot and completed-artifact records are protected by database
triggers against update/delete. Historical object keys are never reused for a
new artifact.

## Claim, retry, and concurrency protocol

Call `claim_quote_pdf_artifact(...)` from migration
`drizzle/0006_quote_pdf_artifacts.sql` inside the application repository adapter.
The claim verifies the persisted snapshot checksum before reserving an artifact.
The function uses `INSERT ... ON CONFLICT DO NOTHING` as the atomic claim:

1. a new identity is inserted as `generating`, `attempt_count = 1`, and returned
   with `claimed = true`;
2. a completed or currently generating identity is returned unchanged with
   `claimed = false`;
3. a failed identity is atomically reclaimed as `generating`, increments
   `attempt_count`, clears its prior error, and returns `claimed = true`.
4. a `generating` claim older than the render deadline plus five-second grace is
   atomically reclaimed with an incremented attempt. Attempt fencing prevents
   the abandoned worker from publishing after recovery.

Only a caller with `claimed = true` may render. Other callers poll or wait for
that row to become terminal. A successful retry updates the same artifact row;
it does not create a duplicate. Failures persist a stable error code, actionable
message/details, failed timestamp, and attempt count.

Completion and failure must use `complete_quote_pdf_artifact` and
`fail_quote_pdf_artifact`. Both fence writes by `attempt_count`; a timed-out old
worker cannot finish or fail an artifact after a newer retry has reclaimed it.

The included in-memory repository follows the same protocol and is intended for
unit tests or single-process composition only. Production must implement the
repository port with PostgreSQL and the migration function, not a process-local
mutex.

## Private immutable storage

`createS3QuotePdfArtifactStorage` writes to the configured private S3-compatible
bucket with:

- `Content-Type: application/pdf`;
- SHA-256 checksum request metadata;
- artifact/source/snapshot/template metadata;
- `If-None-Match: *`.

The object key is opaque and deterministic for the claimed artifact:
`quote-pdfs/<artifact UUID>/<source SHA-256>.pdf`. It contains no customer name,
quote display number, filename, or other raw PII.

A pre-existing object is never overwritten. The adapter issues `HEAD` and only
reuses the object when both output checksum and byte size match. Any mismatch is
`immutable_storage_conflict`. Preview/download code must use authenticated
streaming or a short-lived signed URL from `src/lib/storage/s3.server.ts`; the
bucket remains private.

## Enforced resource limits

Defaults are exported as `DEFAULT_QUOTE_PDF_LIMITS` and are passed to the
renderer. Deployments may lower them per service instance; raising them requires
an explicit capacity review and tests.

| Limit | Default | Failure code |
|---|---:|---|
| Canonical snapshot input | 2 MiB | `input_bytes_exceeded` |
| Images per artifact | 40 | `image_count_exceeded` |
| Image dimensions | 4096 × 4096 px | `image_dimensions_exceeded` |
| Bytes per image | 8 MiB | `image_bytes_exceeded` |
| Aggregate image bytes | 40 MiB | `total_image_bytes_exceeded` |
| Render time | 30 seconds | `render_timeout` |
| Estimated working set | 256 MiB | `working_memory_exceeded` |
| Pages | 40 | `page_count_exceeded` |
| PDF output | 25 MiB | `output_bytes_exceeded` |

Image width/height must be positive integers and byte counts must be non-negative
safe integers; malformed metadata fails as `image_metadata_invalid`. Snapshot
JSON is bounded to 100 levels and 100,000 nodes. An iterative UTF-8 size estimate,
image metadata checks, and image-count/byte limits run before cloning,
canonicalization, hashing, or claiming the artifact.

The working-set guard is a conservative input + declared image bytes + output
estimate; it is not a substitute for a worker/container memory limit. Production
render workers must also run with a 256 MiB process/container memory ceiling.
The service aborts the renderer signal at the 30-second deadline; isolated job
workers must additionally be terminated if a renderer ignores cancellation. The
renderer should downsample images before layout while preserving the declared
source metadata and must return its actual page count.

Before storage, output must start with a PDF header, contain a terminal `%%EOF`
marker, have at least one page, and satisfy output/page/working-set limits.
Invalid renderer bytes fail as `invalid_pdf` and are never uploaded.

## Error and recovery policy

Stable failure codes are defined by `QuotePdfGenerationErrorCode`. A failed row
may be retried after correcting a transient renderer/storage issue or reducing
input that exceeds a declared limit. Retrying unchanged over-limit input will
predictably fail again; the UI should show the stored message and relevant
`actual`/`limit` details.

If object upload succeeds but the database completion update is interrupted, a
retry reaches the same object key. Conditional PUT prevents overwrite, and the
matching HEAD checksum/size allows completion to recover safely. A mismatch is
never repaired in place: investigate storage integrity and generate only under
an explicitly new source identity.

## Template integration contract

Template implementations provide `QuotePdfRenderer.render(request)` and must:

- use only `request.snapshot`, never fetch live business rows;
- honor `request.limits` and return `{ bytes, pageCount }`;
- stop promptly when `request.signal` is aborted;
- render deterministically for a fixed snapshot and template version;
- resolve only private/local snapshot assets, with bounded image decoding;
- omit commission and credit-limit data from quote PDFs.

The template card may add variant-specific snapshot schemas, but it must preserve
this immutable service boundary and bump the template version for any rendered
byte/layout behavior change.
