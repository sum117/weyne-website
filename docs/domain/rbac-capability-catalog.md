# RBAC capability catalog — implementation contract

Status: implementation guide for the centralized authorization layer
Source of truth: `docs/domain/role-permission-matrix.md` (policy) +
`src/lib/auth/capabilities.ts` (executable transcription)
Applies to cards: `t_3445c7b8` (this contract), `t_34646a93`,
`t_03a12212`, `t_d3e33344` (enforcement), `t_93767b9a` (root)

## 1. What lives where

| Concern | Home |
|---|---|
| Policy (who may do what, and why) | `docs/domain/role-permission-matrix.md` — change policy HERE first |
| Capability names + role matrix (code) | `src/lib/auth/capabilities.ts` — browser-safe, no server imports |
| Session + capability enforcement | `src/lib/auth/authorization.server.ts` — SERVER ONLY |
| Transcription guards | `tests/unit/rbac-capability-matrix.test.ts` |

The matrix document remains authoritative for POLICY. The code file is
authoritative for what the running system enforces, and the test file's
census fails the build if the two drift apart. A policy change is therefore
always three edits: doc first, then `capabilities.ts`, then the census map
if the command vocabulary changed.

## 2. Capability naming conventions

- Format: `<resource>.<verb>`, English, snake_case verbs
  (`customer.update_operational`, `order.mark_invoiced`). Doc commands in
  camelCase map onto these; the mapping is pinned by the census test.
- Grouping: doc commands that share one row-outcome per role collapse into
  one capability (`quote.addLine` / `quote.updateQuantity` /
  `quote.removeLine` → `quote.edit_lines`). When in doubt, one capability
  per enforcement decision a service actually makes.
- Internal aliases are NOT capabilities. `industry.updateDefaultCommission`
  and `product.setCommissionOverride` are the canonical
  `commission_rule.manage` surface reached through another resource
  (matrix §6/§7 "alias interno"); expose exactly one endpoint.
- Record scope is not a boolean capability: each scoped resource carries a
  `<resource>.scope` row whose value is one of `all`, `own_assigned`,
  `explicit_assigned`, `active_catalog`, `none` (matrix §2.2). Workflow
  commands inherit their resource's scope.
- Commands that exist for no role in Phase 1 (N/S cells) live in
  `UNSUPPORTED_COMMANDS`, outside the typed catalog: calling one is a
  compile error through `authorize()`, and an untyped caller gets 404.

## 3. Denial semantics

Three distinct failures, never collapsed:

| Failure | Class | Status | pt-BR message |
|---|---|---|---|
| No valid session | `UnauthenticatedError` | 401 | (no body to client; route guard redirects to `/entrar`) |
| Authenticated, forbidden | `ForbiddenError` | 403 | "Você não tem permissão para executar esta operação." |
| Command does not exist | `UnsupportedCommandError` | 404 | "Esta operação não está disponível." |

Rules:

1. Authentication failure is ALWAYS distinct from authenticated-but-
   forbidden. An anonymous caller must learn nothing about the capability
   landscape.
2. The 403 message is fixed. It never names the capability, the caller's
   role, or any record. Interpolating details turns the denial into an
   oracle.
3. Out-of-scope records are NOT 403. Per matrix §2.1, when a record exists
   but sits outside the actor's scope, services return `not_found` (404)
   so identifiers cannot be enumerated. 403 is reserved for "this record
   is legitimately visible to you and your role still may not act on it".
4. State preconditions (draft-only edits, terminal states, archived-record
   immutability) are domain-service concerns AFTER authorization (S11):
   the matrix says who may attempt; the service says whether the record's
   state permits it (409 conflict there).
5. Every server function catches these errors at its boundary and maps
   them onto the project's standard public result shape; messages reach
   users verbatim in pt-BR.

## 4. Correct usage

### Server functions (the enforcement point)

```ts
// src/features/app/<area>/<thing>.functions.ts
import { createServerFn } from '@tanstack/react-start'
import { requireCapability } from '@/lib/auth/authorization.server'

export const archiveCarrier = createServerFn({ method: 'POST' })
  .validator(inputSchema)
  .handler(async ({ data }) => {
    // Resolves the session from the REQUEST cookie, then checks the matrix.
    // Throws UnauthenticatedError (401) or ForbiddenError (403).
    const session = await requireCapability('carrier.archive')
    // ... proceed; service still enforces state preconditions.
  })
```

For scoped resources, take the scope from the same call — never re-derive
it from the role:

```ts
const { session, scope } = await requireScopedCapability('quote', 'quote.list')
// scope: 'all' | 'own_assigned' | 'explicit_assigned' | ...
// The repository query MUST filter by this scope BEFORE pagination.
```

### Domain services

Services stay framework-free: they receive an actor (`{ id, role }`) or a
pre-computed scope as arguments and may use the pure `authorize()` /
`recordScope()` functions from `capabilities.ts`. They must not import
`authorization.server.ts` (which pulls the ambient request).

### UI visibility (presentation only)

```tsx
import { authorize } from '@/lib/auth/capabilities' // browser-safe

{authorize(session.user.role, 'user.create') === 'allow' && (
  <CreateUserButton />
)}
```

Hiding a button is UX, not security. Every server function re-checks.

### Forbidden patterns

- `session.user.role === 'admin'` anywhere outside `capabilities.ts` —
  downstream cards replace these with capability checks.
- Local allow-lists like `const ADMIN_ONLY = [...]` in feature code.
- Deriving scope with inline conditionals instead of `recordScope()`.
- Calling `requireCapability` with a string literal not yet in the catalog:
  add the capability through the doc → catalog → census flow instead.

## 5. Matrix summary (normative cells)

The full tables with preconditions live in the matrix document. The
executive summary enforced by `ROLE_MATRIX`:

- **admin**: every capability except exports (Phase 2, granted to nobody);
  scope `all` everywhere; restore rights on all master data.
- **representative**: OWN_ASSIGNED on customers/quotes/orders;
  ACTIVE_CATALOG reads on industries/carriers/products/price lists;
  creates customers (becoming owner) and quotes; sends/cancels(draft|sent)/
  duplicates/PDFs/converts own quotes; order notes + attachments within
  state limits; NEVER price overrides, discounts, approval/rejection/
  expiry, credit limit, assignments, commission rules, audit, settings,
  user management, or order workflow transitions.
- **read_only**: EXPLICIT_ASSIGNED reads on customers/quotes/orders;
  ACTIVE_CATALOG operational reads (O-class fields only — no prices,
  F1/F2/W beyond status/dates); NO mutation of anything; NO attachment
  content; NO file downloads.

System jobs (e.g. quote expiry) hold no human role: they run under a
dedicated system identity granted exactly one command, configured at the
job site — never mapped to `admin`.

## 6. Extending the matrix

1. Update `docs/domain/role-permission-matrix.md` (policy decision, cited
   to business input where required by §15 there).
2. Add/rename capabilities in `src/lib/auth/capabilities.ts`; fill the new
   cell for all three roles — the type makes omission a compile error.
3. Update the census map in
   `tests/unit/rbac-capability-matrix.test.ts` so every doc command maps
   to exactly one capability (or N/S).
4. Run `bun run check`. The census plus the behavioral assertions keep the
   three artifacts honest.
