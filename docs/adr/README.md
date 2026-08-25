# Architecture decision records

These ADRs are the authoritative shared architecture for Weyne. Their accepted decisions supersede the exploratory wording in the linked spike notes. Downstream work may refine implementation details, but must not replace these choices without a superseding ADR and new compatibility evidence.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-application-platform-and-route-boundaries.md) | Accepted | TanStack Start, React 19, Bun, TypeScript, static `/`, authenticated SSR `/app`, single organization |
| [0002](0002-production-runtime-and-deployment.md) | Accepted | Node Start server image behind Caddy and Cloudflare Tunnel |
| [0003](0003-persistence-auth-api-and-storage.md) | Accepted | PostgreSQL, Drizzle, Better Auth, server functions, private S3-compatible storage |
| [0004](0004-client-data-charts-and-exports.md) | Accepted | TanStack Query/Table, shadcn/Recharts, React PDF, ExcelJS |

## Evidence map

Every architecture-spike parent is represented:

- Baseline and protected landing/design constraints: [`docs/architecture-spike-baseline.md`](../architecture-spike-baseline.md), task `t_5c3ed803`.
- Static/SSR runtime and deployment: [`docs/architecture-spike-ssr-runtime.md`](../architecture-spike-ssr-runtime.md), task `t_42cf7754`.
- Persistence, authentication, server functions, and private storage: [`spikes/001-persistence-auth-api-storage/README.md`](../../spikes/001-persistence-auth-api-storage/README.md), task `t_e6fcf915`.
- Query, grids, charts, and document exports: [`docs/architecture-spike-client-data-exports.md`](../architecture-spike-client-data-exports.md) and [`spikes/002-client-state-grid-chart-exports/README.md`](../../spikes/002-client-state-grid-chart-exports/README.md), task `t_239aa5fe`.

The frozen `docs/design-handoff/` tree remains reference-only and is not an ADR location.
