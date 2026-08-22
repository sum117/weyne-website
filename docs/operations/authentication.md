# Authentication runtime (Better Auth)

Operational reference for the Better Auth integration described in
[ADR 0003](../adr/0003-persistence-auth-api-and-storage.md). Sessions are
stored in PostgreSQL, so authentication shares the database operational
boundary documented in [ssr-runtime.md](ssr-runtime.md).

## What is in the repository

| Path | Role |
| --- | --- |
| `src/lib/auth/config.server.ts` | Validated, server-only environment contract |
| `src/lib/auth/auth.server.ts` | The Better Auth instance over the canonical Drizzle tables |
| `src/lib/auth/provisioning.server.ts` | Administrator-driven credential creation |
| `src/routes/api.auth.$.ts` | The `GET`/`POST` protocol route mounted at `/api/auth/*` |
| `scripts/provision-auth-user.ts` | Operator utility that creates one credential identity |

The route delegates every request to `auth.handler(request)`. Password
hashing, session tokens, cookie signing, origin validation, and CSRF checks
are Better Auth's own implementations; this repository adds none of its own
cryptography.

## Environment variables

Both are **server-only**. A `VITE_` prefix would publish the value in the
browser bundle, so neither may ever carry one.

| Variable | Development | Production | Notes |
| --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | optional | **required** | Minimum 32 characters. Generate with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | optional | **required** | Absolute public origin. Must use `https` in production. |
| `DATABASE_URL` | required | required | Sessions and identities live here; see `ssr-runtime.md`. |

`NODE_ENV=production` is what selects the fail-closed branch. The production
and staging Compose files set it explicitly and pass both variables with
`:?`, so a deploy missing either one fails loudly instead of starting an app
that would refuse every authenticated request.

### Development behavior

With no configuration at all the application still runs: it falls back to
`http://localhost:3000` and a fixed, clearly labelled development key. That
key is never valid in production — the configuration parser rejects it by
name.

### Production behavior (fail closed)

Startup configuration is rejected, with the variable named and its value
never echoed, when any of the following holds:

- `BETTER_AUTH_SECRET` is missing, shorter than 32 characters, or equal to the
  development fallback;
- `BETTER_AUTH_URL` is missing, is not an absolute `http(s)` URL, or does not
  use `https`.

## Cookies and cross-site protection

- Session cookies are `HttpOnly`, `SameSite=Lax`, `Path=/`.
- `Secure` is applied whenever the resolved origin is `https`, which
  production always is (Cloudflare terminates TLS in front of Caddy). Better
  Auth then also applies the `__Secure-` cookie-name prefix.
- Origin validation and CSRF checks are pinned on explicitly
  (`disableCSRFCheck: false`, `disableOriginCheck: false`). Better Auth
  disables the origin check by default under `NODE_ENV=test`; pinning it keeps
  the behavior identical in tests, development, and production.
- A cookie-bearing request with a foreign `Origin`, or with no `Origin` and no
  `Referer`, is rejected with `403`.
- Sessions are database rows, so sign-out revokes server-side. There is no
  stateless cookie cache; a revoked cookie cannot regain access.

## Schema and migrations

Better Auth uses the canonical `users`, `sessions`, `accounts`, and
`verifications` tables. **No auth-specific migration exists or is needed** —
those four tables ship in `drizzle/canonical/0000_canonical_schema.sql`. The
adapter is given an explicit singular-to-plural alias map, so no column is
renamed and no shadow table is created.

Two canonical columns have no database default and are `NOT NULL`, so the
integration supplies them and marks both non-writable by any API caller:

- `role` defaults to `read_only`; promotion happens through the admin
  user-management path, never through an authentication request.
- `auth_subject` is minted per identity and is never returned in a response.

Primary keys use the canonical `uuid DEFAULT gen_random_uuid()`; Better Auth
is configured with `generateId: 'uuid'` so it defers to that column default
instead of emitting its own non-UUID identifier.

Apply migrations with the usual commands — there is no separate auth step:

```sh
bun run db:migrate       # apply the canonical chain (needs DATABASE_URL)
bun run db:generate      # regenerate SQL after a schema change
```

In production the one-shot `migrate` Compose service runs
`node dist/server/migrate.js` before the app starts.

## Provisioning the first user

Public sign-up is disabled (`disableSignUp: true`); `/api/auth/sign-up/email`
returns an error. Identities are created by an operator:

```sh
DATABASE_URL=... BETTER_AUTH_URL=... \
  bun scripts/provision-auth-user.ts "Nome" "email@example.com" "senha-longa" admin
```

Roles are `admin`, `representative`, and `read_only`. The minimum password
length is 12. The script prints the new user's id, email, and role — never the
password or its hash.

## Verification

```sh
bun run test tests/unit/auth-config.test.ts        # environment contract
bun run test:database                              # includes the live auth suite
```

`tests/integration/better-auth-integration.test.ts` exercises the real
handler against real PostgreSQL: adapter writes, UUID keys, cookie
attributes under both http and https, session persistence, revocation,
sign-up refusal, and both cross-site rejection paths.
