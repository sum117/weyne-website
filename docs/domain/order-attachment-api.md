# Order attachment API contract

Status: Phase 1 server contract for order-scoped attachments. This is not a general document-management API.

## Security and storage invariants

- Every list, upload, download, and delete request evaluates order scope and role on the server. UI capabilities are advisory only.
- `admin` may operate on any in-organization order. `representative` may view/upload on an owned or assigned order and may delete only an attachment they created. `read_only` cannot receive attachment metadata or content.
- Out-of-scope identifiers return `NOT_FOUND`; an in-scope role denial returns `FORBIDDEN`.
- Upload and admin deletion are allowed only while the order is `open` or `confirmed`. Representative deletion is allowed only while `open`. No attachment operation mutates an order header, line, quote snapshot, price snapshot, or other historical commercial data.
- Objects remain in the private S3-compatible bucket. The application privately streams authorized downloads. It never persists or returns a public object URL. If a signed operation is introduced at the transport edge, it must use the configured short TTL and must not be persisted or audited.
- Object keys have the exact opaque form `attachments/<order UUID>/<random UUIDv4>` and contain no filename, label, customer name, tax identifier, email, phone, or user-provided path.
- The current allowlist is `application/pdf`, `image/png`, and `image/jpeg`. The server checks both the allowlist and file magic bytes. Extensions and client MIME values are not trusted.
- The configured `maxSizeBytes` and `maxFilesPerOrder` are checked before object persistence. `pending`, `ready`, and `deleting` rows count toward the order limit to prevent concurrent bypass.
- SHA-256 uses canonical base64. The service recomputes it from received bytes, passes it to S3 as `ChecksumSHA256`, requires the storage response to match, and recomputes it on download.

## Domain API

All calls require a trusted server-created actor `{ id: UUID, role: admin | representative | read_only }`. Actor data must never be accepted from the request body.

### List metadata

Request:

```text
{ actor, orderId }
```

Response: a newest-first array of active (`ready`) metadata. Internal transports must omit `objectKey`, `payloadHash`, and idempotency bookkeeping before serializing to the browser. UI-safe fields are `id`, `orderId`, `label`, `originalFilename`, `sizeBytes`, `validatedMimeType`, `checksumSha256`, `createdBy`, and timestamps/state.

### Upload

Request:

```text
{
  actor,
  orderId,
  idempotencyKey,             // required, <= 128 characters
  label,                      // required, <= 120 characters
  originalFilename,           // display only, <= 255; no path separators
  declaredMimeType,
  declaredSizeBytes,
  declaredChecksumSha256,
  bytes
}
```

Success response: verified metadata with `state: ready`. A retry with the same `(orderId, actor.id, idempotencyKey)` and identical payload returns the original metadata. Reusing the key with a different declaration returns `IDEMPOTENCY_KEY_REUSED`.

Consistency sequence:

1. validate authorization, order state, declarations, magic bytes, actual size/checksum, count bound;
2. persist `pending` metadata with an opaque key;
3. upload privately with S3 checksum enforcement;
4. compare returned storage size/checksum;
5. transition metadata to `ready` and append a sanitized success audit event.

If steps 3–5 fail, object cleanup is attempted and metadata becomes `failed`. `pending`, `failed`, and `deleting` metadata is never downloadable or listed as usable.

### Download

Request:

```text
{ actor, orderId, attachmentId }
```

Success response at the domain boundary:

```text
{ attachment, bytes, checksumSha256 }
```

The HTTP/server-function edge should set `Content-Type` from `validatedMimeType`, use a safely encoded `Content-Disposition` display filename, stream `bytes`, and never include `objectKey` or bucket credentials. A missing object or size/checksum mismatch fails closed with `STORAGE_INTEGRITY_FAILED`/`ATTACHMENT_NOT_READY`.

### Delete

Request:

```text
{ actor, orderId, attachmentId, idempotencyKey }
```

Deletion is logical in metadata and physical in private storage:

1. authorize delete independently from upload/download;
2. transition `ready -> deleting` and persist the delete idempotency key;
3. delete the object;
4. transition `deleting -> deleted`, set actor/time, then append the sanitized deletion event.

A storage failure leaves `deleting`, which is non-downloadable and safe to retry with the same key. A different key returns `IDEMPOTENCY_KEY_REUSED`. Metadata and audit rows are never hard-deleted. Reconciliation handles long-lived `deleting`, `pending`, `failed`, missing-object, and unreferenced-object states.

## Audit contract

Successful upload and deletion events contain only:

```text
{ eventType, orderId, attachmentId, actorId, occurredAt, label }
```

There are deliberately no columns or payload fields for object keys, filenames, checksums, signed URLs, tokens, credentials, authorization headers, role-evaluation details, or storage-provider responses. Audit rows are append-only.

## Errors for UI consumers

| Code | Suggested HTTP status | UI meaning / retry guidance |
|---|---:|---|
| `INVALID_REQUEST` / `DECLARATION_MISMATCH` | 400 | Invalid fields or client size declaration; fix input. |
| `DISALLOWED_FILE_TYPE` / `FILE_SIGNATURE_MISMATCH` | 415 | Type not approved or content does not match declared type. |
| `FILE_TOO_LARGE` | 413 | File exceeds configured byte limit. |
| `CHECKSUM_MISMATCH` | 422 | Bytes differ from the client checksum; reread/reselect file. |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Client must generate a stable operation key. |
| `FORBIDDEN` | 403 | Actor is in scope but role/action is denied. |
| `NOT_FOUND` | 404 | Order/attachment absent or outside actor scope. |
| `INVALID_STATE` / `ATTACHMENT_LIMIT_REACHED` | 409 | Order lifecycle or active-file count blocks the operation. |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Generate a new key for a different operation payload. |
| `ATTACHMENT_NOT_READY` | 409 | Metadata is pending/failed/deleting/deleted or object is unavailable. |
| `STORAGE_INTEGRITY_FAILED` | 502 | Storage failed or integrity could not be proved; retry only with the same idempotency key. |

Error bodies must contain the stable code and a generic localized message. They must not include bucket names, endpoints, object keys, signed URLs, checksums from provider errors, stack traces, credentials, or authorization reasoning.
