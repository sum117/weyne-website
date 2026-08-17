# Production headers and dependency audit

Last validated: 2026-08-17 with Bun 1.3.14.

The full audit reports six records: four high records representing the two
accepted `brace-expansion` advisories across multiple paths, plus the two
accepted moderate advisories below. There are no critical findings and no
untriaged high findings.

## Repeatable checks

- `bun run audit:dependencies` fails on any untriaged high or critical advisory.
- `bun audit` prints the complete advisory set, including accepted moderate findings.
- `bun run build:app && bun run check:headers` starts `dist/server/runtime.js` with production settings and asserts the headers on the prerendered HTML, health response, and a content-hashed asset.
- `bun run check` runs the dependency gate, production build, and built-runtime header assertions after the normal content, type, lint, and unit gates.

The header check deliberately exercises emitted runtime bytes. It does not infer behavior from `Caddyfile` or source constants. Caddy repeats the same headers at the deployment boundary so an upstream application response cannot silently remove them.

## Header policy and deployment boundary

The Node runtime and Caddy apply:

- CSP with same-origin defaults, denied frames/plugins, restricted forms and connections, and insecure-request upgrading;
- `X-Frame-Options: DENY` as legacy defense in depth alongside CSP `frame-ancestors 'none'`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- disabled camera, geolocation, microphone, payment, and USB permissions;
- same-origin opener and resource policies;
- HSTS for the public HTTPS origin.

Cloudflare terminates TLS before forwarding plain HTTP through the private tunnel. HSTS is therefore meaningful to the browser on the public HTTPS response, not as transport protection on the Caddy-to-application hop.

TanStack Start emits inline hydration/state scripts, the landing route has a blocking inline reveal bootstrap, and React components emit inline style attributes. The CSP therefore retains `unsafe-inline` for `script-src` and `style-src`, but does not permit `unsafe-eval`, foreign script origins, objects, frames, or foreign form destinations. Replacing those inline emissions with request-specific nonces is deferred until the prerendered and SSR paths can share a framework-supported nonce contract; introducing a static nonce would provide no protection.

## Dependency triage

The lockfile uses safe overrides for `js-yaml@4.3.1`, `nanoid@3.3.18`, `postcss@8.5.23`, and `undici@7.29.0`. These remain inside their parents' declared compatible ranges and remove their reported high/moderate advisories.

### Accepted high: brace-expansion

- Advisories: GHSA-mh99-v99m-4gvg / CVE-2026-14257 and GHSA-rgw5-rvv9-x895 / CVE-2026-69152.
- Severity: high availability impact when attacker-controlled brace/glob patterns reach `brace-expansion`.
- Paths: development lint tooling (`eslint`, `typescript-eslint`) and ExcelJS's archive stack (`exceljs -> archiver -> glob -> minimatch`).
- Exploitability here: no HTTP, server-function, upload, search, or export field is passed to a glob/minimatch pattern. Lint runs only on repository-owned paths. ExcelJS receives application-selected archive entries, not user-supplied glob expressions.
- Mitigation: the audit gate explicitly ignores only these two reviewed GHSAs; all other high/critical findings still fail. Inputs must not be wired into glob patterns. Remove the exceptions once ESLint/ExcelJS dependency ranges resolve patched `brace-expansion` versions.
- Rationale: Bun 1.3.14 does not successfully apply the required simultaneous 1.x and 5.x transitive override without forcing one incompatible major across all minimatch branches. A global forced major would be a riskier, unverified substitution than accepting the unreachable code path.

### Accepted moderate: esbuild

`esbuild@0.18.20` is nested under `drizzle-kit` and affected by GHSA-67mh-4wv8-2f99, which concerns an exposed esbuild development server. Drizzle Kit is a development/migration CLI; this package is not copied into or invoked by the production runtime. The production build uses patched esbuild versions. Upgrade when Drizzle Kit removes its legacy loader chain.

### Accepted moderate: uuid

`uuid@8.3.2` is internal to `exceljs` and affected by GHSA-w5hq-g745-h8pq for v3/v5/v6 calls with a caller-supplied output buffer. Application code does not call that API, and generated spreadsheet identifiers do not accept a caller-owned UUID buffer. A forced jump to uuid 11 would violate ExcelJS's declared `^8.3.0` range; defer to an upstream ExcelJS release.
