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
| `src/lib/auth/contract.ts` | Isomorphic contract: public paths and the minimal session projection |
| `src/lib/auth/session.server.ts` | Authoritative server-side session resolution (`getAppSession`, `requireAppSession`) |
| `src/lib/auth/cookie.server.ts` | Expiring `Set-Cookie` headers, used only when revocation could not be confirmed |
| `src/routes/api.auth.$.ts` | The `GET`/`POST` protocol route mounted at `/api/auth/*` |
| `src/routes/entrar.tsx` | The public credential login page |
| `src/features/app/auth/` | Login/logout server functions, login form, sign-out control, route guard |
| `src/start.ts` | Global Start config; installs the framework CSRF middleware over server functions |
| `scripts/provision-auth-user.ts` | Operator utility that creates one credential identity |
| `scripts/smoke-auth-flow.ts` | Live login/logout journey smoke against a running runtime |

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

## Application login, logout, and protected routes

The Better Auth protocol route at `/api/auth/*` stays mounted, but the
application never calls it from the browser. The login journey goes through
two server functions in `src/features/app/auth/login.functions.ts`, which
delegate the security-critical work to `auth.api.signInEmail` /
`auth.api.signOut` and forward Better Auth's own `Set-Cookie` headers
verbatim. No cookie, token, or hash is ever built by this repository.

| Surface | Path | Behavior |
| --- | --- | --- |
| Login page | `/entrar` | Public, `noindex`. An already-authenticated visitor is redirected away in `beforeLoad`. |
| Protected application | `/app`, `/app/*` | Every route calls `requireAuthenticatedRoute` in `beforeLoad`, which runs during SSR — an anonymous request gets `307 /entrar?redirect=<path>` before any protected markup or loader data is produced. |

Guarantees worth keeping in mind when changing this area:

- **`beforeLoad`, never the component.** A component-level check would render
  and stream protected markup first. `tests/unit/authenticated-route-boundary.test.ts`
  fails the build if any `/app` route file drops the guard, so a new route
  cannot silently ship unprotected.
- **The redirect target is sanitized.** `sanitizeRedirectPath` reduces the
  `redirect` search value to a same-origin path, so `//evil.example`,
  `https://evil.example`, and `/\evil.example` cannot be used to bounce a
  visitor off-site after login.
- **Route context is presentation only.** The session placed in route context
  is never an authorization decision. Every privileged server function calls
  `requireAppSession()` itself and re-resolves the caller from the request
  cookie, because a server function is an RPC endpoint a client can POST to
  directly without ever loading the route that normally calls it.
- **The client sees a minimal projection.** `AppSession` carries id, name,
  email, role, and the session expiry — no session token, no `auth_subject`,
  no password material.
- **Server functions are CSRF-checked by the framework.** `src/start.ts`
  installs `createCsrfMiddleware` over `serverFn` traffic. This is required
  because a direct `auth.api.*` call bypasses the origin validation
  `auth.handler` performs for `/api/auth/*` requests. Ordinary document
  requests are deliberately not filtered — they are top-level navigations
  that must work from any entry point.
- **Logout revokes server-side.** `auth.api.signOut` deletes the session row;
  the expired cookies it returns are forwarded verbatim. If the revocation
  call itself fails, `expiredSessionCookieHeaders` still clears the browser
  cookie, and the guard re-checks the (still valid) server session on the
  next request rather than assuming success.

### Live smoke of the journey

`scripts/smoke-auth-flow.ts` drives the whole journey over raw HTTP against a
running runtime, using the same seroval wire format the browser client uses.
It needs the two server-function IDs, which are stable content hashes visible
in the built client chunk:

```sh
grep -o '[a-f0-9]\{64\}' dist/client/assets/login.functions-*.js
# first hash  = signInWithPassword, second = signOutCurrentSession

DATABASE_URL=... BETTER_AUTH_URL=http://127.0.0.1:3199 \
  BETTER_AUTH_SECRET=... PORT=3199 HOST=127.0.0.1 node dist/server/runtime.js

WEYNE_SMOKE_ORIGIN=http://127.0.0.1:3199 \
WEYNE_SMOKE_EMAIL=... WEYNE_SMOKE_PASSWORD=... \
WEYNE_SMOKE_SIGNIN_ID=<hash1> WEYNE_SMOKE_SIGNOUT_ID=<hash2> \
  bun scripts/smoke-auth-flow.ts
```

It asserts the redirect, the login page, non-enumerating rejection, the
cross-origin 403, cookie attributes, reload persistence, the bounce off
`/entrar` while authenticated, logout revocation, replayed-cookie refusal,
and that public `/` is untouched. Use `BETTER_AUTH_URL` with `http` only
against a local runtime started with `NODE_ENV=development` — production
rejects a non-https origin by design.

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
bun run test tests/unit/auth-contract.test.ts      # isomorphic contract + redirect sanitizer
bun run test tests/unit/auth-login-form.test.tsx   # login form and sign-out control
bun run test tests/unit/authenticated-route-boundary.test.ts  # every /app route is guarded
bun run test:database                              # includes the live auth suites
bunx playwright test --project=chromium            # guard + login page in a real browser
```

`tests/integration/better-auth-integration.test.ts` exercises the real
handler against real PostgreSQL: adapter writes, UUID keys, cookie
attributes under both http and https, session persistence, revocation,
sign-up refusal, and both cross-site rejection paths.
`tests/integration/app-session-lifecycle.test.ts` covers the application
session projection on top of it: minimal non-sensitive fields, persistence
across independent requests, revocation, expiry, per-device isolation, and
the cookie-clearing fallback's name/attribute alignment with what Better Auth
actually sets.
