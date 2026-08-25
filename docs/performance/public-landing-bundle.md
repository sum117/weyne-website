# Public landing performance and bundle report

Measured 2026-08-17 on Windows 11 with Bun 1.3.14, Node 24.18.0, Vite 7.3.6, Lighthouse 13.4.1, and local Chrome. This report measures the prerendered public `/` route independently from authenticated application routes.

## Commands and test shape

```text
bun run build:app
bun run check:bundle
bun scripts/serve-dist.ts 3100
lighthouse http://127.0.0.1:3100/ --form-factor=mobile --throttling-method=simulate
```

The production-like runs placed Caddy 2.10 (`encode zstd gzip`) in front of the static server, matching the repository's deployed compression boundary. Three identical mobile Lighthouse runs were used for the final median. Raw local reports were written under `artifacts/performance/` during measurement; the durable results are transcribed below because generated Lighthouse JSON is not a release artifact.

## Before and after

| Metric | Before | Final | Result |
| --- | ---: | ---: | --- |
| Mobile Lighthouse, uncompressed local server | 60 / 96 / 100 / 100 | 62 / 100 / 100 / 100 | Performance / accessibility / best practices / SEO |
| FCP, uncompressed local server | 6,305 ms | 5,404 ms | 14% faster |
| LCP, uncompressed local server | 9,230 ms | 7,429 ms | 20% faster |
| TBT | 27 ms | 0 ms | no blocking regression |
| CLS | 0.0026 | 0 | stable |
| Total transferred, uncompressed local server | 1,664,899 B | 1,155,751 B | 30.6% smaller |
| Images transferred | 663,274 B | 148,193 B | 77.7% smaller |

Final production-like Caddy runs were extremely stable: performance scores `82, 82, 82`; accessibility, best practices, and SEO were `100, 100, 100` in every run. Median proxies were FCP 2,409 ms, LCP 4,284 ms, TBT 0 ms, and CLS 0. Total transferred bytes were 554,385 B at the median.

The final route preloads its responsive AVIF hero and the three Latin font files actually used above the fold. Large transparent PNG artwork now has generated, resized WebP alternatives while retaining PNG fallbacks. This removed more than 515 kB from the measured image transfer without changing dimensions, alternative text, interaction, or fallback behavior.

## Initial public code

`bun run check:bundle` reads only the assets referenced directly by the prerendered `dist/client/index.html`, deduplicates module-preload/script references, measures raw and gzip bytes, and scans those initial scripts for authenticated/PDF/chart/export/storage markers.

| Initial resource | Raw | Gzip |
| --- | ---: | ---: |
| HTML document | 78,325 B | 16,435 B |
| JavaScript (4 chunks) | 679,820 B | 207,886 B |
| CSS (1 stylesheet) | 94,209 B | 16,803 B |
| JavaScript + CSS | 774,029 B | 224,689 B |

Major initial chunks are the TanStack/React router and hydration runtime (~423.0 kB raw), landing route (~206.3 kB), shared form input primitives (~45.8 kB), and selector helper (~4.8 kB). Content hashes vary per build, so budgets intentionally match by referenced asset type rather than filename.

The build also emitted application-only chunks that were **not** referenced by `/`: reports (~180.5 kB raw, including chart code), products (~39.7 kB), table primitives (~13.0 kB), and the `/app` component (~1.1 kB). No initial public chunk contained `@react-pdf`, PDFKit/fontkit, ExcelJS, Recharts, AWS SDK, postgres, or Drizzle markers. PDF and spreadsheet code remained server-only and did not appear in any client chunk.

## Regression budgets

The build now runs `check:bundle` after producing the client/runtime output. It fails on missing referenced files, application-only markers in initial scripts, or these ceilings:

| Budget | Ceiling | Current headroom |
| --- | ---: | ---: |
| HTML | 90,000 B | 13.0% |
| Initial JavaScript | 735,000 B raw / 225,000 B gzip | 7.5% / 7.6% |
| Initial CSS | 105,000 B raw / 20,000 B gzip | 10.3% / 16.0% |
| Initial JavaScript + CSS | 245,000 B gzip | 8.3% |

These tolerances are deliberately large enough for content-hash and minifier variance but small enough to catch an application library or another medium route chunk entering the public graph. Unit tests protect deduplication, byte-budget failure, and authenticated-module marker failure.

## Lighthouse target exception

The 95-point accessibility, best-practices, and SEO targets passed at 100. The 90-point mobile performance target did **not** pass in this local environment and is not silently waived: the final production-like median is 82.

Two environment differences remain material. The canonical local static test server intentionally sends uncompressed HTTP/1.1, while production is compressed at Caddy and then served through Cloudflare over HTTP/2 or HTTP/3. A local self-signed HTTP/2 experiment was unstable for layout-shift scoring and is not used as the release result. Even with stable Caddy compression, Lighthouse's simulated mobile model holds the font-rendered H1 as LCP at about 4.28 s; TBT and CLS are already effectively zero.

Reaching 90 locally would require a broader hydration/font-delivery redesign rather than removing an accidental authenticated dependency. That work is intentionally not disguised as a speculative cache or a fidelity-reducing font removal. The integrated performance gate should rerun Lighthouse against the real Cloudflare preview; if it remains below 90 there, the release owner must either authorize a named exception or schedule a separately reviewed rendering/hydration change.
