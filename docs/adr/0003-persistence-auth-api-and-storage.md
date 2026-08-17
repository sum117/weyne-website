# ADR 0003: Persistence, authentication, API, and private storage

- Status: Accepted
- Date: 2026-08-17
- Owners: Weyne application maintainers

## Context

The authenticated application needs a transactional system of record, revocable sessions, a typed server boundary, and private binary-object storage. These facilities must work with the pinned Start/React/Bun stack and keep credentials and privileged packages out of browser output.

## Decision

- PostgreSQL is the sole system of record for business data, Better Auth sessions, authorization metadata, and private-object metadata.
- Use Drizzle ORM `0.45.2` with `postgres` `3.4.9`. Drizzle Kit `0.31.10` generates reviewable SQL. Applied SQL and the migration ledger are immutable; production promotion is forward-only with expand/contract compatibility.
- Use Better Auth `1.6.29` with its Drizzle PostgreSQL adapter and database-backed sessions. Its GET/POST catch-all route delegates to `auth.handler(request)`. Reusable server middleware/session checks protect `/app` and every privileged server function.
- Use TanStack Start server functions for business queries and mutations. Handlers authenticate, authorize the action and target record, validate input, execute server-only data access, and return deliberately serializable results. Do not expose repositories directly to routes or client code.
- Use a private S3-compatible bucket through AWS SDK v3 `@aws-sdk/client-s3` (validated `3.1111.0`). PostgreSQL stores opaque object keys and ownership/business metadata. A download first validates the session and authorizes metadata, then the server uses its credentials to issue `GetObject` or a narrowly scoped short-lived presigned URL. The browser never supplies an arbitrary storage key.
- The system is single-organization. There are no tenant or organization columns/plugins/scopes. Record ownership and roles remain ordinary authorization rules within that organization.

## Package additions

Production: `drizzle-orm@0.45.2`, `postgres@3.4.9`, `better-auth@1.6.29`, `@aws-sdk/client-s3@3.1111.0`. The root also contains `@aws-sdk/s3-request-presigner` for authorized short-lived download URLs. Development: `drizzle-kit@0.31.10`.

## Commands and migration contract

- Generate reviewed SQL: `bun run db:generate`.
- Apply locally or in an operator-controlled environment: `bun run db:migrate` with server-only `DATABASE_URL`.
- Build the immutable migration runner: `bun run build:migrate` (included in `bun run build:app`).
- Exercise database integration: `bun run test:database`.
- Production: Compose runs `node dist/server/migrate.js` as a one-shot service before starting the app.

Never point the disposable spike migration at production. Never edit an applied migration. A failed preflight, checksum mismatch, lock conflict, or SQL error must fail closed and prevent application startup. Schema changes must remain compatible with the previous image throughout the rollback window; destructive cleanup is a later, explicitly gated release.

## Server-only environment contract

The following are runtime secrets/configuration and must not use the `VITE_` prefix: `DATABASE_URL`, `BETTER_AUTH_SECRET` (minimum 32 random characters), `BETTER_AUTH_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, optional `S3_FORCE_PATH_STYLE`, and signed-URL TTL configuration. Credentials belong in the app/migration runtime environment or a secret manager. Storage credentials must have least-privilege bucket/object permissions and no bucket-policy administration.

Only `VITE_SITE_ORIGIN` and `VITE_WHATSAPP_NUMBER` are approved public build-time variables. Every `VITE_*` value is browser-visible. Do not serialize secrets, raw object keys, connection details, or server errors through loaders/server functions.

## Consequences

- PostgreSQL transactions and constraints define authoritative business state; object storage is not a metadata database.
- Sessions are revocable and share the PostgreSQL operational boundary.
- The Better Auth protocol route is the only routine exception to the server-function API rule.
- Private-object access adds an application authorization lookup before storage access. Missing and unauthorized objects must be indistinguishable to callers.
- Database and storage availability are server operational dependencies; backup, restore, reconciliation, and credential rotation need explicit runbooks.
- No edge-worker deployment is approved for privileged modules; they target the Node-compatible server container.

## Rejected alternatives

- SQLite or object-storage metadata as a second system of record: fragments consistency and operations.
- Prisma or raw SQL as the primary data layer: not the validated typed-schema/reviewable-migration path.
- Stateless cookie-only application sessions: loses server-side revocation and a single auth source of truth.
- General REST or GraphQL business APIs: duplicate Start server functions.
- Browser database/S3 access or `VITE_*` secrets: exposes privileged credentials.
- Public buckets or arbitrary long-lived presigned URLs: bypass application authorization.
- Caller-supplied raw object keys: enables horizontal access attempts.
- Better Auth organization plugin, tenant IDs, and organization scopes: contradict the single-organization product decision.

## Validation evidence

[`spikes/001-persistence-auth-api-storage/README.md`](../../spikes/001-persistence-auth-api-storage/README.md) records (`t_e6fcf915`):

- a real PostgreSQL 16 migration creating five tables and a successful live query;
- Better Auth HTTP sign-up, persisted session cookie, and later validation;
- authenticated compiled Start server-function SSR and fail-closed anonymous access;
- owner-authorized MinIO put/get plus denial for another user and invalid credentials;
- zero database/auth/S3 credential or server-package matches in `dist/client`, with those dependencies present in the server graph;
- focused typecheck/tests/build passing and prerender still emitting exactly `/`.
