# 001: persistence, auth, API, and private object storage

## Verdict: VALIDATED

The selected backend stack works together with the repository's pinned TanStack Start 1.168.32, React 19.2.7, TypeScript 5.9.3, Vite 7.3.6, and Bun 1.3.14. The fixture is deliberately disposable: it proves integration and records boundaries; it is not production application code.

## Questions and observed evidence

| Question | Given / when / then | Result |
| --- | --- | --- |
| PostgreSQL + Drizzle | Given PostgreSQL 16, when Drizzle Kit generates and runs the checked-in SQL migration, then all Better Auth tables plus `private_object` exist and a live query returns `weyne_spike`. | Validated |
| Better Auth sessions | Given email/password auth, when a user signs up through `/api/auth/sign-up/email`, then Better Auth issues a session cookie, persists the session in PostgreSQL, and validates it on a later request. | Validated |
| Start server-function boundary | Given the Better Auth cookie, when `/app` runs its loader through a compiled `createServerFn`, then the server function validates the session and SSR renders the authenticated email; an anonymous request fails closed. | Validated |
| Private S3-compatible storage | Given private MinIO with AWS SDK v3, when an authenticated owner puts and gets an object, then bytes round-trip; another signed-in user cannot resolve the metadata, and invalid S3 credentials cannot inspect the bucket. | Validated |
| Browser secret isolation | Given the production client build, when all `dist/client` files are scanned, then no database URL, auth-secret variable, S3 credential variable/value, Drizzle, Better Auth, PostgreSQL driver, or AWS SDK identifier is present. The same dependencies are present only in the server bundle. | Validated |

Executed evidence:

- `drizzle-kit generate`: 5 tables discovered and `drizzle/0000_violet_sinister_six.sql` generated.
- `drizzle-kit migrate`: migrations applied successfully to a real PostgreSQL 16 container.
- `bun run typecheck`: passed.
- `bun run test`: 1 file / 4 integration tests passed against PostgreSQL and MinIO.
- `bun run build`: client and SSR bundles passed; prerender produced exactly `/`.
- Built Bun runtime verification: `{"anonymousStatus":500,"authenticatedStatus":200,"authenticatedEmailRendered":true,"sessionCreatedOverHttp":true}`.
- Client bundle scan: zero secret/server-package matches. Server bundle scan found Better Auth and Drizzle, confirming the intended split.

The anonymous fixture deliberately throws and therefore returns 500. Production `/app` middleware should convert this fail-closed condition to a sign-in redirect or 401; that UX policy is outside this spike.

## Representative flow

1. `src/routes/api.auth.$.ts` is the protocol exception to the server-function rule and delegates GET/POST auth traffic directly to `auth.handler(request)`.
2. Better Auth uses the Drizzle PostgreSQL adapter and writes `user`, `account`, `session`, and `verification` records. Sessions are database-backed, not a second cookie-only system.
3. `src/routes/app.tsx` calls a compiled TanStack Start server function. The function reads request headers on the server and passes them to `auth.api.getSession` before returning serializable profile data.
4. `putPrivateObject` validates the session, writes bytes with the server-held AWS SDK client, and records an opaque object key plus owner user ID in PostgreSQL.
5. `getPrivateObject` validates the session and queries metadata by both object ID and owner user ID before issuing `GetObject`. A caller never supplies an arbitrary S3 key. Missing or unauthorized objects share the same response to avoid disclosing existence.

The model is intentionally single-organization. There is no organization table, tenant ID, organization filter, Better Auth organization plugin, or multitenancy abstraction.

## Required packages

Production additions:

- `drizzle-orm@0.45.2`
- `postgres@3.4.9`
- `better-auth@1.6.29`
- `@aws-sdk/client-s3@3.1111.0`

Development addition:

- `drizzle-kit@0.31.10`

The fixture repeats the repository's pinned Start/Router/React/Vite/TypeScript packages so compatibility is independently reproducible. Production should use the root dependency graph rather than a nested package.

## Environment contract

All variables below are server-only and must be injected into the SSR container at runtime. None may use the `VITE_` prefix.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string used by Drizzle and migrations |
| `BETTER_AUTH_SECRET` | At least 32 random characters; signs/encrypts auth state |
| `BETTER_AUTH_URL` | Canonical HTTPS application origin |
| `S3_ENDPOINT` | S3-compatible endpoint; omit or use AWS endpoint in AWS deployments |
| `S3_REGION` | Bucket region |
| `S3_BUCKET` | Private application bucket |
| `S3_ACCESS_KEY_ID` | Server workload access key |
| `S3_SECRET_ACCESS_KEY` | Server workload secret key |

For non-AWS providers, expose `S3_FORCE_PATH_STYLE` only if the provider requires it. The fixture uses path-style MinIO requests. Production credentials should have only bucket-scoped object permissions and no bucket-policy administration.

## Reproduce locally

From this directory:

1. `bun install --frozen-lockfile`
2. `docker compose -f compose.yml up -d --wait`
3. Export the values from `.env.example`, replacing `BETTER_AUTH_SECRET` with a random fixture value.
4. `bun run db:migrate`
5. `bun run typecheck && bun run test && bun run build`
6. Start the built fetch handler with `PORT=3011 bun scripts/serve-built.ts`.
7. In another shell run `SPIKE_BASE_URL=http://127.0.0.1:3011 bun scripts/verify-runtime.ts`.
8. `docker compose -f compose.yml down -v`.

Do not run the fixture's migration against production. The real application must review and promote generated SQL through its deployment pipeline.

## Migration and runtime findings

- Drizzle Kit generation and migration work under Bun 1.3.14 with the `postgres` driver.
- Better Auth's CLI generated a Drizzle PostgreSQL schema compatible with the selected versions.
- The Start Vite plugin must compile server functions. Calling `__executeServer` directly from uncompiled source fails because no Start AsyncLocalStorage request context exists; the successful evidence therefore uses the actual production build and HTTP runtime.
- The build emits a fetch-style `dist/server/server.js`. Running `node dist/server/server.js` exits cleanly because it exports a handler rather than opening a socket. A production adapter/server wrapper is required; the fixture proves the handler under `Bun.serve`.
- Repository builds still need Node available because TanStack prerender currently launches a Node process, even though the emitted handler was successfully exercised under Bun.
- S3 compatibility was tested locally with pinned MinIO and the AWS SDK's `forcePathStyle` option. AWS S3 normally does not require path-style addressing.

## Security boundary

Browser code may hold only opaque Better Auth cookies and application-level object IDs. It never receives `DATABASE_URL`, `BETTER_AUTH_SECRET`, S3 credentials, or raw storage keys. Vite substitutes every `VITE_*` value into browser code, so backend secrets must be read only by server-owned modules and runtime environment access.

Private object authorization is application-level and fail-closed: validate the session, query PostgreSQL metadata using the authenticated user ID, then access the object with server credentials. Bucket policy remains private and denies anonymous/invalid credentials. For downloads, either stream through an authenticated server handler or issue a short-lived, single-object presigned URL only after the same metadata authorization. Never make the bucket public.

## Rejected alternatives

- SQLite or object-storage metadata as a second system of record: rejected; PostgreSQL is the sole system of record.
- Prisma or raw SQL as the primary data layer: rejected; Drizzle gives typed schema plus reviewable SQL migrations with a smaller runtime boundary.
- Stateless/cookie-only application sessions: rejected; Better Auth's PostgreSQL sessions support revocation and a single auth source of truth.
- Better Auth organization plugin, tenant IDs, or organization scopes: rejected; the product is single-organization.
- Browser database/S3 access or `VITE_*` secrets: rejected because Vite exposes them in the client bundle.
- Public buckets: rejected; private bucket plus application authorization prevents key guessing from becoming data access.
- Arbitrary long-lived presigned URLs: rejected; use authenticated streaming or narrowly scoped short-lived URLs after authorization.
- General business REST/API routes: rejected; TanStack Start server functions remain the application API boundary. The Better Auth catch-all route is required for its HTTP protocol.
- Running the emitted server file directly as an executable: rejected for this Start version; it is a fetch-handler module and needs an adapter.

## Recommendation for the real build

Retain the SQL migration and server-only layering pattern, not the fixture application. Put database, auth, and storage constructors in `.server.ts` modules (or `createServerOnlyFn` boundaries); wire Better Auth's catch-all route; require auth in reusable server middleware; keep business operations in server functions; and authorize every object lookup through PostgreSQL metadata before S3 access. Run migrations as a one-shot release step before starting the new server revision, with backward-compatible migrations and an application-image rollback plan.
