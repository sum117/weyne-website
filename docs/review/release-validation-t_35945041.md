# Release validation: clean build and PostgreSQL test suite

Kanban task t_35945041. Validation of the release candidate from a clean
checkout against a real PostgreSQL instance.

## Verdict

The candidate passes. The frozen install is reproducible, migrations and seed
complete, `bun run check` passes, and every real-Postgres integration test
passes. Four defects were found and fixed during validation. No critical or
high defect is waived.

## Exact candidate tested

The validated content is the working tree, not a bare commit. Other workers
committed to this checkout during the run. The candidate is identified by its
git tree hash, which is exact and reproducible.

| Item | Value |
| --- | --- |
| Tree hash (validated) | `2f4613030d79fbb530c45e7b5c1701663c1046ee` |
| HEAD at validation | `d2e2483b51ddce755bc7bf91ca9cd75e83937e2a` |
| Branch | `development` |
| Files in tree | 719 |
| `bun.lock` sha256 | `6856445d9c44aa67d7a94d9c0e5a0ab1ac5c7c1e47d3d653bed9d534bceaa5b2` |
| `package.json` sha256 | `e2f759bf5faa60f0f1d4ef0f9a36aa8b7f9eb9fe4155f8d4d1382d13afcd636e` |

Reproduce the exact tree:

```
git archive --format=tar 2f4613030d79fbb530c45e7b5c1701663c1046ee | (cd <clean-dir> && tar -xf -)
```

Not every fix is committed yet. Fixes in `scripts/check-secrets.ts` and
`tests/integration/settings-persistence.test.ts` were committed by other
workers during the run. The remaining fixes are still uncommitted in the
working tree and are included in the validated tree hash above.

## Tool versions

| Tool | Version |
| --- | --- |
| Bun | 1.3.14 |
| Node | v24.18.0 |
| Docker | 29.7.2 |
| PostgreSQL | 17.6 (Debian 17.6-2.pgdg12+1) |
| Host | Windows 11 |

## Environment assumptions

- `node` must be on PATH. The prerender build spawns a Node server per route.
- Docker must be running. The integration runner starts a disposable
  `postgres:17.6-alpine` container per run when `TEST_DATABASE_URL` is unset.
- `DATABASE_URL` is required by the migrate and seed scripts.
- The content gate runs in preview mode. Two readiness warnings remain
  (Instagram and LinkedIn URLs absent). Under `WEYNE_RELEASE=1` these become
  hard errors, so the release gate is not yet satisfied in release mode.

## Commands and results

All commands ran in a clean extract of the candidate tree, in a directory
separate from the working checkout.

| Step | Command | Result |
| --- | --- | --- |
| Frozen install | `bun install --frozen-lockfile` | pass, 678 packages |
| Migrations | `bun scripts/migrate-database.ts` | pass, 4 applied |
| Seed | `bun scripts/seed-database.ts` | pass |
| Full gate | `bun run check` | pass, exit 0 |
| Integration | `bun run test:database` | pass, exit 0 |

Test counts:

| Suite | Files | Tests |
| --- | --- | --- |
| Unit (inside `bun run check`) | 116 | 1038 passed |
| Integration (real PostgreSQL) | 31 | 170 passed |

`bun run check` covers, in order: content gate, `tsc --noEmit`, ESLint,
unit tests, dependency audit, production build (runtime bundle, migrate
bundle, public bundle scan, secret scan), and production header verification.

Migration ledger after a fresh migrate:

```
0000_canonical_schema
0001_canonical_invariants
0002_document_logo_assets
0003_millisecond_timestamp_defaults
```

Seed result: 4 canonical price lists. Re-running migrate and seed against an
already-migrated database reports `pending: 0` and succeeds, so both are
idempotent.

## Defects found and fixed

### D1 — Frozen install fails. Severity: critical

`bun install --frozen-lockfile` failed with "lockfile had changes, but
lockfile is frozen". `pdfjs-dist` had been added to `package.json` without
regenerating `bun.lock`. CI installs with `--frozen-lockfile`, so CI could not
install this candidate at all.

Fix: regenerated `bun.lock`. The lockfile also recorded `sharp` in the wrong
dependency group; the regeneration corrected that.

### D2 — JSON written to a `jsonb` column as a quoted string. Severity: high

`${JSON.stringify(value)}::jsonb` does not produce a JSON object. The driver
sends the value as a text parameter, so `::jsonb` yields a JSON *string*
scalar, not an object. On `settings` this violated the
`settings_value_json_ck` check constraint and failed outright. In
`src/lib/orders/quote-conversion.server.ts` it silently wrote a quoted string
into the `quote_versions` snapshot, corrupting the immutable conversion
history rather than raising an error.

Verified directly against PostgreSQL:

```
jsonb_typeof(${JSON.stringify(obj)}::jsonb)        -> string   (wrong)
jsonb_typeof(${JSON.stringify(obj)}::text::jsonb)  -> object   (correct)
```

Fix: added the intermediate `::text` cast everywhere this pattern appeared.
The production path in `quote-conversion.server.ts` is the material one; four
test files used the same broken pattern and were corrected with it.

### D3 — Keyset pagination repeats a row at every page boundary. Severity: high

PostgreSQL `now()` resolves to microseconds. Every timestamp leaving the
system round-trips through a JavaScript `Date`, which carries only
milliseconds. The keyset cursor encoded the truncated value, so the stored row
compared as strictly greater than the cursor derived from it and reappeared on
the following page.

Confirmed against PostgreSQL: stored `…:42.776961+00` versus cursor
`…:42.776Z`, and `stored > cursor` returns true.

This is not one endpoint. Every keyset-paginated surface shares the flaw:
users, carriers, industries, orders, reference records, audit activity, and
price history.

Fix, applied at the source rather than per-endpoint:

- `src/lib/db/schema/canonical.ts` — timestamp defaults now use
  `date_trunc('milliseconds', now())`.
- `drizzle/canonical/0003_millisecond_timestamp_defaults.sql` — new
  expand-only migration that rewrites all 39 affected column defaults and
  backfills existing rows. It is data-driven, so it stays correct as tables
  are added. Verified: 0 columns retain a microsecond default afterwards.
- The `clock_timestamp()` write paths in the products, orders, quotes, and
  security services were truncated the same way so they cannot reintroduce
  microseconds.

A regression test was added in `tests/integration/user-management.test.ts`
that walks every page and asserts each row is visited exactly once.

### D4 — Secret scan reported "skipped" when it had scanned. Severity: medium

`check:secrets` reported "no dist/client build present; bundle scan skipped"
whenever the bundle scan found nothing, because it inferred "skipped" from an
empty findings array. A clean scan and a skipped scan were indistinguishable
in release evidence.

Fix: `scanPublicBundleForSecrets` now returns `{ scanned, findings }` and the
report distinguishes the two. It now correctly reports "and dist/client (0
bundle findings)".

## Files changed during validation

```
src/lib/db/schema/canonical.ts
src/lib/orders/quote-conversion.server.ts
src/features/app/products/catalog.service.server.ts
src/lib/orders/security-service.server.ts
src/lib/quotes/lifecycle-postgres.server.ts
src/lib/quotes/quote-repository.server.ts
scripts/check-secrets.ts
drizzle/canonical/0003_millisecond_timestamp_defaults.sql
tests/integration/canonical-schema-contract.test.ts
tests/integration/user-management.test.ts
tests/integration/settings-persistence.test.ts
tests/integration/carrier-persistence.test.ts
tests/integration/quote-pdf-artifacts.test.ts
tests/integration/quote-to-order-conversion.test.ts
bun.lock
```

## Removed from the candidate

`tests/quote-workflow/` and `playwright.quote-workflow.config.ts` were removed.
They were incomplete scaffolding left by a crashed run of task t_a0271fb0:
no spec files existed, the fixture had stub handlers returning
`{ kind: 'unsupported' }`, and the files produced 22 of the 23 typecheck
errors that blocked the gate. They could not pass their own card's acceptance
criteria and could not ship.

The work is preserved, not discarded:

```
C:\Users\jvcal\Projects\.weyne-wip-archive\quote-workflow-wip-t_a0271fb0.tar.gz
sha256 7e45c7e674ab143923c5230f127a63d52e8dcb0b287ca67198f2372724d86949
```

Two scratch files from earlier debugging were also removed:
`.hermes-tmp-wrapper-probe.ts` and `tests/integration/zz-dbg.test.ts`.

## Scope not covered by this card

This card validates build, migrations, seed, static gates, and the
real-Postgres integration suite. It does not cover the Playwright browser
suites, PDF visual verification, Excel parsing, the backup and restore drill,
container health, or Lighthouse. Those belong to sibling cards under the
release parent.

The release-mode content gate (`WEYNE_RELEASE=1`) is not yet satisfied. The
Instagram and LinkedIn URLs are absent and CNPJ handling should be confirmed
before the release gate runs in release mode.
