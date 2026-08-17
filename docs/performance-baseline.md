# Representative performance fixture and baseline

This artifact defines the reproducible synthetic workload used by the performance hardening tasks. It contains no production or copied customer data. Names, identifiers, dates, amounts, object keys, and relationships are generated locally from a fixed integer seed.

The machine-readable baseline is stored at `artifacts/performance/baseline-2026-08-17.json`.

## Reproduce

From the repository root with Bun 1.3.14:

```sh
# Fast correctness run
bun run test tests/unit/performance-fixtures.test.ts
bun scripts/performance/benchmark.tsx smoke 11

# Recorded representative baseline
bun run build
bun scripts/performance/benchmark.tsx standard 20260817 > artifacts/performance/baseline-2026-08-17.json
```

`bun run build` refreshes `dist/client`, which lets the benchmark include bundle metrics. If `dist/client` is absent, the JSON records the bundle measurement as unavailable instead of silently reporting zero.

The generator lives in `scripts/performance/fixtures.ts`; the benchmark runner is `scripts/performance/benchmark.tsx`. The profile name and seed are the only inputs. The generated timestamp inside the fixture is fixed, so an identical profile and seed produce an identical fixture digest. The benchmark result timestamp and timings naturally vary by run.

## Dataset scale

| Record type | Smoke | Standard |
| --- | ---: | ---: |
| Tenants/accounts | 2 | 4 |
| Representatives | 8 | 40 |
| Clients | 200 | 5,000 |
| Industries | 12 | 40 |
| Products | 500 | 10,000 |
| Quotes | 1,000 | 25,000 |
| Quote lines | 6,000 | 150,000 |
| Attachments | 250 | 5,000 |

Every representative, client, industry, product, quote, line, and attachment belongs to a generated tenant/account. Quote-to-client, quote-to-representative, product-to-industry, line-to-quote, line-to-product, and attachment-to-product references are valid and tenant-local. The standard profile is deliberately fixed and bounded; the public API does not accept arbitrary record counts or an unbounded profile.

The standard profile with seed `20260817` has fixture SHA-256 `75f5147f9a711b574f750e6f19e0479bdf1278a2a582e1026517c5f9ca4a0fff`.

## Scenarios

| Scenario | Work represented | Bound |
| --- | --- | ---: |
| `primaryProductList` | Tenant-scoped active-product filter, category filter, pt-BR sort, first page serialization | 100 returned rows |
| `dashboardAggregation` | Tenant-scoped quote count and revenue aggregation by status | 25,000 quotes scanned |
| `reportAggregation` | Date/tenant-filtered quote lines joined to products and industries, grouped and sorted | 150,000 lines scanned |
| `csvExport10k` | Server-side CSV assembly | 10,000 rows |
| `pdf40Lines` | Real `@react-pdf/renderer` path using bundled fonts and a synthetic quote snapshot | 40 lines, no remote images |
| `uploadValidation5MiB` | Size check and SHA-256 validation of a synthetic upload body | 5 MiB input; 10 MiB scenario ceiling |

The first invocation of every scenario is an unrecorded warm-up. Recorded samples then run sequentially in the same process. Fixture generation is a cold, single invocation in a fresh process. Network and object-storage transfer time are excluded. Database access is also excluded at this stage, so every scenario explicitly reports `queryCount: 0`; that means “no database in this fixture baseline,” not “the application flow needs zero queries.” The PostgreSQL profiling child must replace this with measured `EXPLAIN (ANALYZE, BUFFERS)` and query-count evidence.

Memory is the maximum positive post-invocation `heapUsed` delta observed among samples. It is useful for gross regressions but is not a retained-heap or peak-RSS profiler. Payload bytes are the emitted body size, except upload, where they are the validated input-body size.

## Recorded baseline

Environment: Windows x64, 32 logical CPUs, Bun 1.3.14. Standard fixture generation took 50.29 ms. The client bundle was refreshed by Vite before the later runtime bundling step encountered an unrelated duplicate declaration in the concurrently changing working tree.

| Scenario | Samples | p50 | p95 | Throughput | Query count | Heap delta | Payload |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Product list | 15 | 1.42 ms | 1.97 ms | 7,157,410 items/s | 0 | 0 B | 28,692 B |
| Dashboard | 15 | 0.17 ms | 0.45 ms | 117,954,202 items/s | 0 | 0 B | 345 B |
| Report | 10 | 1.58 ms | 2.85 ms | 81,841,543 items/s | 0 | 0 B | 825 B |
| CSV export | 7 | 2.21 ms | 2.46 ms | 4,691,154 rows/s | 0 | 0 B | 894,554 B |
| PDF | 3 | 1,905.29 ms | 1,955.75 ms | 21.24 lines/s | 0 | 362,727,750 B | 753,007 B |
| Upload validation | 7 | 2.14 ms | 2.19 ms | 2,444,444,740 bytes/s | 0 | 0 B | 5,242,880 B |

Bundle observation: 8 JavaScript chunks, 910,763 raw bytes, 280,871 gzip bytes, and a 422,308-byte largest raw chunk. This is a whole-`dist/client` inventory, not route-attributed initial JavaScript. Route attribution and optional PDF/chart/export splitting belong to the client-bundle hardening child.

## Budgets and gates

### Hard gates (deterministic and suitable for CI)

1. `tests/unit/performance-fixtures.test.ts` must pass: same profile/seed yields byte-equivalent data, a different seed changes it, all relationships resolve, and only named bounded profiles are accepted.
2. The `standard` scale remains exactly the table above unless this document, the tests, and the baseline are deliberately revised together.
3. Benchmark scenarios remain bounded at 100 list rows, 10,000 export rows, 40 PDF lines, and a 10 MiB upload ceiling. These are fixture-runner safety gates, not a claim that production limits are already enforced.
4. Repository typecheck, lint, tests, and build remain the normal merge gate. Environment-independent failures are hard failures rather than performance observations.

### Controlled-environment release targets

These are p95 service targets for the later end-to-end PostgreSQL/server implementation. They are not asserted by the in-memory unit benchmark and should only become automated gates on a pinned runner with an isolated database and stable load profile.

| Flow | p95 target | Query-count target | Other budget |
| --- | ---: | ---: | --- |
| Product list, 100 rows | ≤400 ms | ≤3 | response ≤256 KiB |
| Dashboard summary | ≤500 ms | ≤4 | response ≤128 KiB |
| Grouped report page | ≤750 ms | ≤4 | response ≤512 KiB |
| CSV export, 10,000 rows | ≤5 s | ≤25 bounded batches | output ≤25 MiB |
| Quote PDF, 40 lines | ≤3 s | ≤4 | peak/observed process growth target ≤512 MiB; output ≤10 MiB |
| Upload preflight/hash, 10 MiB | ≤200 ms excluding network | 0 | request body ≤10 MiB |

The dashboard and report targets are the explicit p95 budgets requested by this work. A failure on the pinned performance runner blocks release; a developer-laptop miss is diagnostic until reproduced there.

### Environment-dependent observations (not hard CI gates)

- Local p50/p95, throughput, and heap deltas vary with CPU, power mode, antivirus, concurrent workloads, runtime version, and garbage collection.
- PostgreSQL latency, buffers, query count, and connection-pool behavior are not represented by this baseline and must be recorded by the database-profiling work against an isolated PostgreSQL instance.
- Whole-build chunk totals vary as concurrent application routes land. Initial-route bytes require manifest/route attribution before becoming a gate.
- Public mobile Lighthouse retains the project target of Performance ≥90, Accessibility ≥95, Best Practices ≥95, and SEO ≥95 where a controlled Lighthouse environment is available. Local scores remain observations.
- Upload timing excludes network and storage service latency; production upload/download SLOs need a controlled MinIO/S3-compatible environment.

No caching, indexes, query changes, bundle splitting, or application-path optimization is introduced by this fixture task. The numbers are a baseline and map for the downstream work, not a polished alibi written after the fact.
