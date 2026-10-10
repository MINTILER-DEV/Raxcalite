# Measured performance

Recorded October 9, 2026 (America/Chicago; JSON timestamps are UTC), Windows, Node v24.13.1 and a Rust debug build. These are reproducible development observations, not release/production capacity guarantees. Raw data remains in the adjacent benchmark JSON files.

## Parser microbenchmarks

`npm run bench` runs five warmups and 40 uncached parser/visitor/generation passes per deterministic input. RSS deltas include GC and retained allocator state; they are not per-request costs.

| Input | Bytes | Median ms | p95 ms | Node RSS delta MiB |
| --- | --- | --- | --- | --- |
| html | 21024 | 20.34 | 28.26 | 39.29 |
| css | 12280 | 4.11 | 4.93 | 20.54 |
| js | 19169 | 18.02 | 34.42 | 139.13 |

## Transport and page load

`cargo build` then `node benchmarks/system.mjs` starts its own fixtures, transformer and backend. Downloads are drained without collecting bodies. Byte counts are decoded payload bytes, not compressed wire throughput. A single cold/cached HTML request and fresh Chromium page loads are illustrative, without confidence intervals.

| Operation | Observation |
| --- | --- |
| downloads-1 | 590.12 ms, 13.56 MiB/s decoded payload |
| downloads-16 | 1240.62 ms, 103.17 MiB/s decoded payload |
| cold | 331.65 ms |
| cached-transform | 3.21 ms |
| direct minimal page | 14.44 ms |
| proxied minimal page | 477.48 ms |

The uncached parser process startup and the browser's bundled Babel/CSS runtime add measurable first-load overhead. Reused processes and transformed-input caching amortize that cost. Chromium's rounded 10 MB heap reading is too coarse to establish browser heap overhead. Downstream assets negotiate gzip/Brotli; binary responses avoid parser work.

## Paced concurrency and memory

`node benchmarks/load.mjs` runs 160 unique cold requests with eight clients, then 160 cached requests with sixteen clients. Each client pauses one second between requests; this is a roughly 32-second paced stability sample, not saturation testing. Startup is included in cold latency, including its p95. The one-user workload remains within the enforced rate quota.

| Workload | Requests | HTTP 200 | Median ms | p95 ms | Total elapsed ms, including pacing |
| --- | --- | --- | --- | --- | --- |
| cold-unique / 8 clients | 160 | 160 | 11.92 | 910.14 | 21340.42 |
| cached / 16 clients | 160 | 160 | 19.45 | 59.29 | 10303.49 |

The run recorded 160 cache hits, 0 transformer failures and 0 backend errors; active work returned to zero. Across 85 OS/process samples, maximum sampled Rust working set was 25.31 MiB and Node parent RSS 91.25 MiB. The largest sum of parser task-end RSS snapshots was 284.16 MiB. Task-end snapshots are not simultaneous peak process-tree measurements. Windows PowerShell sampling adds observer overhead and can miss allocation spikes.

## Public pages and boundaries

`node benchmarks/cohort.mjs` uses fresh direct/proxied Chromium contexts for five unauthenticated public pages, recording status/title, text size, resource errors and parser warnings. The observation window includes two seconds after DOMContentLoaded. Exact classifications live in `cohort-latest.json` and [compatibility](compatibility.md); this does not prove full journeys or authenticated-site support.

Up to four small parser processes or one exclusive large parser process, eight buffered transformations, bounded queues, hard cancellation, 32 MiB cache bytes and request/stream caps are enforced. Per-process JS heap ceilings do not constrain all native parser allocations; Docker/process memory limits remain necessary. Browser uploads buffer within 64 MiB for HTTP/1 interoperability, whereas backend request and binary response forwarding stream. Text remains bounded and buffered. Production sizing needs the actual deployment hardware, release build, realistic resources/journeys and OS memory sampling; no theoretical capacity number is substituted for those measurements.
