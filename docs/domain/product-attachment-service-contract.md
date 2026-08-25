# Product attachment service contract

This contract is the handoff between product services, the private object-storage adapter,
image processing, UI, and reconciliation. The executable policy source is
`src/domain/products/attachments.ts`; persistence types are exported from
`src/lib/db/schema/index.ts`.

## Closed vocabulary

Categories are `PHOTO`, `TECHNICAL_SHEET`, and `FISPQ`. Upload lifecycle values are
`PENDING`, `UPLOADED`, `PROCESSING`, `AVAILABLE`, `FAILED`, and `DELETING`.
Callers must treat unknown values as contract errors rather than silently falling back.

`PENDING` means metadata and an upload intent exist but storage completion has not been
verified. `UPLOADED` means the original object exists and has passed server-side byte
size, actual MIME sniffing, and SHA-256 verification. Photos then enter `PROCESSING`;
documents may become `AVAILABLE` directly. `FAILED` is not downloadable. `DELETING`
prevents new access while object and metadata cleanup converge. Only `AVAILABLE`
attachments may receive signed download URLs or appear as usable media.

## Central policies

| Category | Allowed actual MIME types | Maximum bytes |
| --- | --- | ---: |
| Photo | `image/jpeg`, `image/png`, `image/webp` | 10 MiB (10,485,760) |
| Ficha técnica | `application/pdf` | 25 MiB (26,214,400) |
| FISPQ | `application/pdf` | 25 MiB (26,214,400) |

Filename extensions are never an input to policy selection or content validation. The
server must inspect stored bytes before moving beyond `PENDING`.

Decoded photos are limited to 12,000 pixels on either axis and 40,000,000 total pixels.
The processor emits aspect-preserving WebP variants without enlargement:

- `THUMBNAIL`: fit inside 320 × 320.
- `DISPLAY`: fit inside 1,600 × 1,600.

The processor records each variant's opaque object key, actual MIME, byte size, SHA-256,
width, and height. It must normalize EXIF orientation before evaluating output geometry.

## Persistence and privacy boundary

`product_attachments` stores the product relationship, category, opaque `object_key`,
original filename, document metadata, verified MIME/size/checksum declarations, upload
status, photo ordering, soft-deletion state, and actor/timestamp audit fields.
`product_photo_variants` stores generated private-object metadata only. PostgreSQL never
stores blob bytes or signed URLs.

Object keys are created only by `createAttachmentObjectKey`. They are
`attachments/<random UUIDv4>` or `attachments/<opaque UUID scope>/<random UUIDv4>`.
Product/customer names, SKUs, emails, order numbers, filenames, and other free-form data
must never be accepted by the key API. Bucket URLs are neither persisted nor returned.
The private storage adapter receives only the opaque key and creates short-lived signed
operations after product-level authorization.

`original_filename` is protected metadata: keep it for authorized audit and download
presentation, but do not place it in keys, logs, metrics, cache keys, or anonymous/public
responses. Logs should use attachment IDs, category, status, and stable error codes.

## Metadata rules

Every attachment includes MIME type, positive byte size, canonical base64 SHA-256,
status, `created_at`/`created_by`, and `updated_at`/`updated_by`. Documents require a
trimmed display label (maximum 200 characters); version (maximum 100 characters) and
ISO calendar effective date (`YYYY-MM-DD`) are optional. Photos cannot carry document
metadata. Documents cannot carry photo position or primary state.

An active photo set is ordered by unique, contiguous zero-based `photo_position` and has
exactly one `is_primary = true` row whenever at least one active photo exists. The
constraint is deferred so reorder/primary changes can occur atomically in one database
transaction. Services must validate with `validateProductPhotoSet` before writing and
still rely on the database constraint as the final concurrency guard.

## Required service operations

Downstream product APIs should expose authenticated service methods, not storage-provider
objects:

1. `initiateUpload(productId, category, declaration, documentMetadata?)` validates RBAC,
   policy, metadata, and checksum syntax; creates `PENDING` metadata plus a random object
   key transactionally; then returns a short-lived private signed PUT capability.
2. `finalizeUpload(attachmentId)` idempotently HEADs/reads the object, sniffs actual MIME,
   computes SHA-256, compares bytes/checksum, and moves to `UPLOADED`. A mismatch moves to
   `FAILED` or quarantine and schedules private-object cleanup; it never becomes readable.
3. `processPhoto(attachmentId)` is retryable and idempotent, creates the exact variant set,
   cleans partial output, and transitions `UPLOADED → PROCESSING → AVAILABLE` or `FAILED`.
4. `listAttachments(productId)` returns authorized metadata ordered as photos by position,
   then documents by category/effective date/creation ID. It returns no raw/signed URL.
5. `authorizeDownload(attachmentId, variant?)` rechecks product RBAC and `AVAILABLE`, then
   asks storage for a short-lived signed GET. Signed capabilities are response-only.
6. `updateDocumentMetadata`, `reorderPhotos`, and `selectPrimaryPhoto` validate the domain
   contract and write actor/timestamp audit data in one transaction.
7. `deleteAttachment(attachmentId)` authorizes, marks `DELETING`, removes original and
   variants idempotently, then soft-deletes metadata. Reconciliation completes interrupted
   deletion; no caller hard-deletes a referenced row.

Each operation emits an audit event with actor, product ID, attachment ID, category,
prior/new status where applicable, and a stable outcome/error code. Never include signed
URLs, object contents, original filenames, or other sensitive metadata in audit payloads.

## Reconciliation and consistency

Database transactions cannot include S3-compatible object writes. Use an intent-first
flow: commit `PENDING`/`DELETING`, perform idempotent storage work, then commit the verified
state. Reconciliation uses a grace period and compares opaque keys to detect stale pending
uploads, missing objects, unreferenced objects, partial variant sets, and interrupted
deletions. It must offer dry-run reporting before destructive cleanup and remain safe
under repeated execution.

The database migration uses deferred photo-set validation and restrict-only foreign keys.
The processor/API must not bypass these constraints. Storage-specific implementation must
remain behind the private adapter established by task `t_7f704101`.
