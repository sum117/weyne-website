# Privacy-safe logging, retention, secrets, and backups

Status: operational control baseline for threat-model T10–T13/T18 and the LGPD
data inventory (see [`security/threat-model.md`](../security/threat-model.md)
and [`privacy/lgpd-data-inventory.md`](../privacy/lgpd-data-inventory.md)).
Last revised: 2026-08-21. Owner: engineering; retention periods and legal
exceptions require controller/DPO sign-off.

This document records what the repository enforces today, what operators must
do outside it, and which gaps remain open with an owner each. It does not
declare legal compliance.

## 1. Logging and redaction

### Enforced in the repository

- **Single logging module.** All application logs flow through
  `src/lib/server/log-redaction.ts`:
  - `logUnexpectedError(scope, cause, context?)` — one JSON line per failure.
    The cause is reduced to name/redacted message/error code; raw stack traces,
    SQL, payloads, headers, and cookies never reach output.
  - `logStructuredEvent(fields)` — one JSON line per audit/operational event.
    Call sites pass only allowlisted fields (actor IDs, entity IDs, outcome
    codes, timestamps).
  - `redactSensitiveText` scrubs private keys, JWTs, credential-bearing
    connection URLs (except placeholder local passwords), SigV4/query secrets,
    `Authorization`/`Cookie` headers, and bearer/basic tokens from any string
    that reaches a log line. Length caps apply at every level.
- **ESLint gate.** `no-console: 'error'` applies to all of `src/**` except the
  redaction module itself. CLI scripts (`scripts/`, `spikes/`) and tests keep
  direct console access because they are operator-facing, not production logs.
  CI fails on any new console call in application code.
- **Audit sinks are field allowlists by contract.** Order attachments, quote
  PDF artifacts, report exports, settings, document logos, and migration logs
  emit fixed field sets — actor/entity IDs, action, outcome, timestamp,
  correlation data. None log object keys, signed URLs, document contents,
  customer names, amounts, or free-form payloads. Audit projections shown to
  admins pass through `redactSummary` (`src/lib/audit/activity.server.ts`)
  before leaving the server.
- **Migration logs** carry event names, migration IDs, counts, database/user
  metadata only; URLs are redacted (`docs/operations/migrations-and-rollback.md`).
- **Backup tooling** emits single-line key/value events without passwords or
  connection strings (`deploy/postgres/*.sh`,
  `docs/postgres-backup-and-restore.md`).

### Operator obligations (outside the repo)

- Keep Docker's log rotation on the app containers (`3 × 10 MB` in
  `deploy/docker-compose.weyne.yml`). Rotation bounds volume, not age; do not
  ship runtime logs to long-term storage without applying the same redaction
  rules and a documented retention period (gap G2).
- Caddy access logs contain request metadata (IPs, paths). If enabled beyond
  default journaling, scope retention to the shortest workable window.

## 2. Secrets

### Enforced in the repository

- **No secret values in code or config.** Runtime secrets live only in
  environment variables read server-side (`src/lib/env.ts` reads exactly two
  public `VITE_` overrides; everything else is server-only via Zod-validated
  configs). Compose files reference Docker secrets / env files, never values.
- **Automated scan.** `bun run check:secrets`
  (`scripts/check-secrets.ts`) scans source, fixtures, docs, and snapshots for
  private key blocks, assigned credential literals, connection URLs with
  embedded passwords, AWS/Slack/GitHub/Google token shapes, literal
  Authorization bearers, and real-looking CNPJ/CPF/phone values. High-
  confidence findings fail the build. Loopback URLs to explicitly test-scoped
  databases downgrade to warnings. The same script scans `dist/client` during
  `build:app`, so a leaked secret in a public bundle fails release packaging.
- **Bundle marker scan.** `scripts/check-public-bundle.ts` additionally fails
  when server-only libraries or app-only strings leak into the public bundle.
- **Public error envelope.** Server functions return stable public error codes
  (`src/lib/server/public-error.ts`); internal causes never reach clients.

### Rotation boundaries and procedure

| Secret | Boundary | Rotation trigger and procedure |
| --- | --- | --- |
| `DATABASE_URL` password | App ↔ PostgreSQL | Rotate on staff offboarding of anyone with VPS access, suspected leak, or quarterly schedule. Create new role/password in Postgres, update `.env.weyne` on the VPS, `docker compose up -d` the app, confirm `/healthz`, retire old role. Never commit the value. |
| S3/R2 credentials (`src/lib/storage/s3.server.ts`) | App ↔ object storage | Least-privilege per-bucket user. Rotate on leak suspicion or provider prompt; two-step: publish new key, redeploy, revoke old. Signed-URL compromise is contained by the ≤15 min TTL decision (T07) plus key rotation. |
| Cloudflare Tunnel token | Edge ↔ origin | Regenerate from the Cloudflare Zero Trust dashboard, replace `.env.weyne` value, restart tunnel container. Old token dies at regeneration. |
| Backup/restore role passwords | Ops ↔ PostgreSQL | Separate roles (`weyne_backup` read-only, `weyne_restore_operator` CREATEDB-only). Stored as root-owned `0600` files under `/etc/weyne/secrets`; rotate like DATABASE_URL. |

Rules that hold across all of them:

1. Values enter the VPS only through `.env.weyne` or `/etc/weyne/secrets`
   (`0600`); never through Git, images, command lines, or logs.
2. Rotation is a deploy-time swap plus confirmation, not an edit in place;
   keep the previous value available only until the new one is verified.
3. A suspected leaked secret is rotated first, investigated second.

## 3. Retention and deletion

### Enforced in the repository

- **Database:** append-only history and immutable snapshots by design;
  deletion of active records is logical (archive states), never physical,
  preserving referential integrity. There is deliberately no bulk purge job
  yet — see gap G1.
- **Backups:** bundles expire after `RETAIN_COUNT=14` / `RETAIN_DAYS=30`,
  enforced by `deploy/postgres/prune-backups.sh` after every successful backup
  (unit-tested in `tests/unit/postgres-backup-operations.test.ts`).
- **Object storage:** attachment delete removes bytes while keeping audit
  metadata; staged logo assets have an explicit purge path
  (`purgeAbandonedStagedAssets`); reconciliation reports orphans
  (`scripts/reconcile-object-storage.ts`).
- **Logs:** bounded by rotation size (above); no long-term archive exists.

### Required decisions before private production (controller-owned)

The inventory marks every retention period "a validar". Before launch, the
controller must fix: session/security-event TTL, customer/representative
record deadlines, financial-document retention (fiscal law may exceed product
preferences), audit-trail duration, and the legal-hold exception list. These
are recorded as gaps G1/G3 below; no code can pick these numbers.

## 4. Backups

Covered operationally by `docs/postgres-backup-and-restore.md`: encrypted
at-rest volume, dedicated least-privilege roles, atomic bundle creation with
SHA-256 verification, count-verified restore drills into disposable databases,
corruption detection, daily systemd timer with alerting, and a quarterly
evidence checklist. Restore access is limited to the
`weyne_restore_operator` role; drills leave auditable structured output.

Deletion propagation rule: a subject erasure request is not complete until
active copies, derived objects, and post-snapshot tombstones are handled. The
restore procedure must reapply deletions newer than the restored snapshot
(inventory §6); until purge automation exists (G1) this is manual and owned
by the production owner.

## 5. Residual gaps and owners

| ID | Gap | Owner / follow-up |
| --- | --- | --- |
| G1 | No automated purge/anonymization job for DB rows past their (still undecided) retention deadlines; restore-reapply of deletions is manual. | Production owner + controller: approve retention table first, then schedule a purge job with idempotent evidence logs. |
| G2 | Log retention is size-bounded only; no time-based expiry or centralized redacted log store. | Engineering: decide window once controller fixes retention classes; add expiry to the ops compose stack. |
| G3 | Legal bases, retention periods, DPA/subprocessor register, and rights-request workflow remain "a validar" in the inventory. | Controller/DPO. Blocking for private production launch. |
| G4 | Redaction patterns are heuristic; novel secret formats can slip text-level scanning. Mitigated by the allowlist-first logging API and the `no-console` lint gate. | Engineering: extend `TEXT_REDACTION_RULES` when new secret shapes appear; review findings from `check:secrets` warnings each quarter. |
| G5 | Off-host backup replication and its encryption are required by policy but not verifiable from this repository. | Production owner: provide quarterly drill evidence (checklist in the backup doc). |

## 6. Change checklist

When adding a feature, verify:

- [ ] New log lines go through `logUnexpectedError` / `logStructuredEvent`;
      no raw errors, headers, cookies, signed URLs, or payloads.
- [ ] New fields in audit events are IDs/codes/timestamps, not content.
- [ ] `bun run check:secrets` stays green; any new warning is triaged, not ignored.
- [ ] Fixtures use synthetic markers (`example.test`, masked CNPJ), never real data.
- [ ] Object keys stay opaque (prefix + UUID).
- [ ] This document and the threat model/inventory are updated when storage,
      logging, exports, backups, or personal fields change.
