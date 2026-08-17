# Server-function and domain-service conventions

**Status:** canonical implementation guide for downstream application cards

**Reference implementation:** `src/features/reference-record/`

**Boundary:** TanStack Start server functions over typed domain services and Drizzle persistence

This document turns the synthetic `ReferenceRecord` feature into the default shape for authenticated application work. Keep route files thin, keep database details behind a feature persistence boundary, and make every server operation return a stable typed result.

## 1. Required dependency flow

The dependency direction is:

```text
route
  -> feature server function / operation boundary
    -> feature domain service
      -> feature repository contract
        -> feature .repository.server.ts
          -> Drizzle schema + server-only database
```

Shared infrastructure is imported downward, never upward:

```text
src/routes/app*.tsx
  -> src/features/<feature>/<feature>.functions.ts
    -> src/features/<feature>/<feature>.service.ts
      -> src/features/<feature>/<feature>.repository.server.ts
        -> src/lib/db/database.server.ts
        -> src/lib/db/schema/*

src/features/*
  -> src/lib/domain/result.ts
  -> src/lib/server/request.schema.ts
  -> src/lib/server/public-error.ts
  -> src/lib/server/cursor.server.ts
  -> src/lib/server/serialization.ts
```

A route owns URL composition, loader/action wiring, page metadata, and rendering. It may call a feature operation or server function, but must not import Drizzle, `getDatabase`, a repository, or a SQL expression. `src/routes/app.tsx` is the thin-route example; `src/routes/app_.produtos.tsx` delegates its surface to `src/features/app/products/product-catalog.tsx` rather than embedding data-access logic.

A feature owns its public operation names, domain types, request schemas, service, and persistence adapter. The feature service is the only place that coordinates domain rules and transaction boundaries. The repository is the only place that knows Drizzle rows and SQL. Do not add Hono, Express, a second REST layer, or another API framework: TanStack Start `createServerFn` is the application boundary.

## 2. File placement and request validation

Use the reference feature as the template:

| Concern | Canonical location | Reference |
| --- | --- | --- |
| Domain DTOs and command/query types | `src/features/<feature>/<feature>.ts` | `reference-record.ts` |
| Feature request schemas | `src/features/<feature>/<feature>.schema.ts` | `reference-record.schema.ts` |
| Server operations/functions | `src/features/<feature>/<feature>.functions.ts` | `reference-record.functions.ts` |
| Domain orchestration | `src/features/<feature>/<feature>.service.ts` | `reference-record.service.ts` |
| Drizzle adapter and row mapping | `src/features/<feature>/<feature>.repository.server.ts` | `reference-record.repository.server.ts` |
| Shared request parsing | `src/lib/server/request.schema.ts` | `parseRequest`, `createListRequestSchema` |
| Shared result/error primitives | `src/lib/domain/result.ts`, `src/lib/server/public-error.ts` | typed result pipeline |
| Shared cursor/serialization | `src/lib/server/cursor.server.ts`, `src/lib/server/serialization.ts` | opaque cursors and DTO serialization |

Feature schemas are the single request-validation definition. Reuse shared schema factories rather than copying pagination, cursor, or direction rules into every feature. `reference-record.schema.ts` uses:

```ts
export const listReferenceRecordsRequestSchema = createListRequestSchema({
  filters: { nameContains: z.string().trim().min(1).max(200) },
  sortFields: ['name', 'createdAt'],
  defaultSort: 'createdAt',
  defaultDirection: 'desc',
})
```

Write schemas with `z.strictObject`. Normalize at the boundary (`trim`, coercion of bounded page limits, defaults), then pass only `z.output<typeof schema>` to the service. The operation boundary calls `parseRequest` and returns a validation `Result`; malformed input must not reach service construction or the repository. TanStack Start validators may accept `unknown` only so this boundary remains explicit; they are not a replacement for feature schemas.

## 3. Typed results and public errors

Domain services return `Result<T>` from `src/lib/domain/result.ts`, not framework exceptions for expected outcomes:

```ts
const record = await repository.findActiveById(id)
return record === null ? failure(notFound()) : success(record)
```

Use the shared categories for expected outcomes:

- validation issues;
- not found;
- optimistic-concurrency conflict;
- unexpected failure with its cause retained only server-side.

`src/features/reference-record/reference-record.functions.ts` is the public boundary. It validates first, invokes the service, logs unexpected causes server-side, and maps with `toPublicResult` from `src/lib/server/public-error.ts`:

```ts
const result = await invoke(service, parsed.data)
return publicResult(result, dependencies.logUnexpectedError)
```

The public contract exposes only `VALIDATION_FAILED` (400), `NOT_FOUND` (404), `CONFLICT` (409), or `INTERNAL_ERROR` (500), with fixed safe messages. Never serialize a cause, stack, SQLSTATE, schema name, database URL, or implementation path. Unexpected service-construction failures are handled by the same boundary.

## 4. Repository-to-domain mapping and serialization

Drizzle rows are persistence details. `mapReferenceRecordRow` in `reference-record.repository.server.ts` is the required seam:

```ts
return Object.freeze({
  id: row.id,
  name: row.name,
  budget: serializeDecimal(row.budget),
  version: versionToNumber(row.version),
  createdAt: serializeDate(row.createdAt),
  updatedAt: serializeDate(row.updatedAt),
  archivedAt: serializeNullableDate(row.archivedAt),
})
```

Repository contracts return domain DTOs (`ReferenceRecord`), never `typeof table.$inferSelect`. This prevents Drizzle-only audit columns such as `createdBy`, `updatedBy`, and `archivedBy` from leaking into application responses and gives the service a stable interface independent of schema details.

All Decimal/numeric values remain exact strings. Use `serializeDecimal` from `src/lib/server/serialization.ts`; do not convert money or quantities through `number`, `parseFloat`, or JSON numeric values. Serialize database dates with `serializeDate` (UTC ISO) and nullable dates with `serializeNullableDate`. New features must use these helpers rather than local date/decimal formatting.

## 5. Reads and lists

### Read one

The route calls the feature operation; the operation validates `{ id }` with `entityIdRequestSchema`; the service reads an active domain record:

```ts
read(input: unknown) {
  return execute(readReferenceRecordRequestSchema, input, (service, request) =>
    service.read(request.id),
  )
}
```

`findActiveById` includes `archivedAt IS NULL`. Missing or archived records become `notFound()` and therefore public `NOT_FOUND`; callers do not receive a raw row or a distinction that exposes persistence state.

### List page

List requests use the shared bounded cursor schema and feature-owned filter/sort allowlists. The service decodes an opaque cursor, verifies that its `sortBy` and `sortDirection` match the current request, then passes the typed query to the repository:

```ts
const page = await repository.list({
  limit: query.limit,
  filters: query.filters,
  sortBy: query.sortBy,
  sortDirection: query.sortDirection,
  ...(cursor ? { cursor } : {}),
})
```

The repository fetches `limit + 1`, returns at most `limit` mapped DTOs, and encodes a `nextCursor` only when another row exists. Keyset ordering must include a deterministic `id` tie-breaker. The reference implementation supports only `name` and `createdAt`; it selects SQL expressions through a switch, applies `isNull(archivedAt)`, and compares the cursor against the same sort expression.

Cursors are opaque base64url JSON validated by `createKeysetCursorCodec` in `src/lib/server/cursor.server.ts`. Invalid, malformed, or mismatched cursors collapse to one safe validation issue. Never accept an offset as a substitute when the feature requires stable keyset pagination.

### Filter and sort allowlists

`createListRequestSchema` uses a strict filter object, a bounded `limit` (1–100), and an explicit `z.enum` generated from `sortFields`. The repository must still switch over those typed values when choosing columns/expressions. Never interpolate a client-provided field, SQL fragment, direction, or operator into a query. Unsupported fields fail validation before service/repository invocation; they are not ignored.

## 6. Writes, transactions, and optimistic concurrency

The domain service owns transaction scope through the injected unit-of-work contract. The repository only executes operations using the database/executor it receives. `createReferenceRecordPersistence` binds a transaction-scoped repository in `database.transaction(...)`:

```ts
transaction: (work) =>
  database.transaction((transaction) => work(createRepository(transaction)))
```

Any multi-step write belongs in one service transaction: mutate the entity, append its audit event, and commit or roll back as one unit. The server function may construct the service and persistence, but must not split a write into separate calls or own a partial transaction. Reads and lists can use the base repository without a transaction unless a feature-specific invariant requires one.

### Create

`create` generates the ID/time in the service boundary, inserts through the repository, then appends the `created` event before returning:

```ts
return unitOfWork.transaction(async (repository) => {
  const record = await repository.create({ ...input, id: createId(), now })
  await repository.appendEvent(eventFor(record, 'created', input.actor))
  return success(record)
})
```

An event failure must roll back the entity insert. The integration and service tests treat this atomicity as a contract.

### Update

Updates carry `expectedVersion`. The repository performs one guarded update using ID, version, and active-state predicates, and increments the version in SQL:

```ts
.where(and(
  eq(referenceRecords.id, input.id),
  eq(referenceRecords.version, BigInt(input.expectedVersion)),
  isNull(referenceRecords.archivedAt),
))
```

A zero-row result is resolved inside the transaction: `NOT_FOUND` if no active record exists, otherwise `CONFLICT`. Only a successful update receives an `updated` event. The version token is the optimistic-concurrency contract; do not read, compare, and write in separate unguarded steps.

### Archive

Archive is a logical write, not a delete. It uses the same `id + expectedVersion + active` guard, sets `archivedAt`/`archivedBy`, updates audit fields, increments the version, and appends an `archived` event in the same transaction. Subsequent reads/lists omit the record and return `NOT_FOUND` for the active read contract; historical data remains available to persistence/audit paths according to the feature contract.

## 7. Canonical operation map

| Operation | Function boundary | Service responsibility | Repository responsibility | Public success/error |
| --- | --- | --- | --- | --- |
| Read | `readReferenceRecord` (`GET`) | active lookup, `notFound()` | filtered lookup + row mapping | DTO / `NOT_FOUND` |
| List | `listReferenceRecords` (`GET`) | decode/match cursor, typed page | allowlisted query, `limit + 1`, keyset predicate | `{ items, nextCursor }` / validation |
| Create | `createReferenceRecord` (`POST`) | one transaction: insert + event | insert + event statements | DTO / `INTERNAL_ERROR` on unexpected failure |
| Update | `updateReferenceRecord` (`POST`) | one transaction, conflict/not-found resolution, event | guarded versioned update | DTO / `CONFLICT` or `NOT_FOUND` |
| Archive | `archiveReferenceRecord` (`POST`) | one transaction, logical archive + event | guarded archive update | archived DTO / `CONFLICT` or `NOT_FOUND` |

The feature operation exports are the stable application contract. A route or component should not reconstruct any of these steps or call the repository directly.

## 8. Prohibited patterns checklist

Before submitting a downstream feature, verify that it does **not**:

- [ ] return a Drizzle row, `$inferSelect`, `bigint`, `Date`, or raw database object to a route/client;
- [ ] expose internal errors, causes, stack traces, SQLSTATEs, SQL text, schema names, paths, or secrets;
- [ ] accept arbitrary filter names, sort fields, sort directions, operators, or SQL fragments from the request;
- [ ] silently ignore an unsupported filter/sort key instead of rejecting it;
- [ ] use offset pagination where the feature contract calls for cursor/keyset pagination;
- [ ] perform a multi-step write (entity plus event, version plus history, or similar) outside one transaction;
- [ ] implement optimistic concurrency as a separate read followed by an unguarded write;
- [ ] duplicate shared Zod pagination/cursor/result/serialization primitives locally;
- [ ] put Drizzle imports or `getDatabase` in routes or client components;
- [ ] add Hono, Express, GraphQL, or another duplicate API framework alongside TanStack Start server functions;
- [ ] convert Decimal values to JavaScript `number` or format dates with ad hoc local helpers;
- [ ] let a feature repository decide public error payloads or framework HTTP status objects.

## 9. Verification evidence

Run the reference implementation checks after changing this guide or using it as a template:

```bash
bun run test -- tests/unit/reference-record-service.test.ts \
  tests/unit/reference-record-server-functions.test.ts \
  tests/unit/server-request.test.ts \
  tests/unit/server-result.test.ts \
  tests/unit/server-serialization.test.ts

bun run lint -- \
  src/features/reference-record \
  src/lib/domain/result.ts \
  src/lib/server

bun run typecheck
bun run check

# PostgreSQL regression for the complete reference pattern
bun run test:database -- tests/integration/reference-record.test.ts
```

Validated on 2026-08-17: the five unit files passed 29 tests; the PostgreSQL regression passed 5 tests; `bun run lint -- ...` passed with warnings and no errors; `bun run typecheck` passed; and the final `bun run check` passed (80 existing ESLint warnings and 2 preview-mode content warnings). The tests cover row mapping, all five operations, validation-before-service behavior, allowlists, opaque cursors, optimistic conflicts, archive semantics, transactional rollback, public error mapping, and sanitized unexpected failures. `bun run check` remains the repository gate and must be rerun before merging downstream implementation work; report any unrelated concurrent failure rather than claiming a green result.
