# Measured performance

Recorded on the available Windows development machine on **October 9, 2026** (America/Chicago), Node v24.13.1, Rust debug build. These are local observations, not production capacity claims. Benchmark JSON includes UTC timestamps. Machine load, GC and debug compilation affect results.

## Transformation microbenchmarks

`npm run bench` uses five warmup rewrites and 40 timed uncached rewrites for each deterministic input. Full parser/visitor/generation work is measured, not just URL replacement.

| Input | Size | Median | p95 | Observed Node RSS change |
| --- | --- | --- | --- | --- |
| HTML, 250 resource groups | 21,024 bytes | 26.34 ms | 35.55 ms | +38.40 MiB |
| CSS, 250 rules | 12,280 bytes | 4.89 ms | 7.65 ms | +20.69 MiB |
| JavaScript, 250 functions/imports | 19,169 bytes | 22.61 ms | 54.54 ms | +106.91 MiB |

RSS differences include retained heap/allocator behavior and GC timing across the whole run. They are not per-request memory costs or maximum RSS. Raw results are in `benchmarks/latest.json`.

## Transport and first-load observations

`node benchmarks/system.mjs` starts controlled fixtures, the transformer and Rust backend, streams downloads without collecting entire bodies, measures a cold/cached transformation, and launches Chromium for a direct/proxied fixture comparison.

| Operation | Observation |
| --- | --- |
| One 8 MiB download | 473.03 ms, 16.91 MiB/s |
| Sixteen concurrent 8 MiB downloads | 1,256.41 ms total, 101.88 MiB/s aggregate |
| Cold fixture HTML transformation/transport | 45.54 ms |
| Repeated fixture with cached transform | 2.11 ms |
| Direct minimal fixture load | 17.78 ms |
| Proxied minimal fixture load | 52.26 ms |
| Public Example Domain HTTP smoke check | HTTP 200, original content and injected runtime present |

These single-pass page observations have no statistical confidence interval. Chromium's exposed heap reading was rounded to 10 MB for both pages; it is too coarse to establish heap overhead. Raw transport/browser data are in `transport-latest.json` and `browser-latest.json`.

## Design and next measurements

TLS connections pool per upstream host. Validated DNS results are used by the transport resolver. Nontext resources stream with byte/read limits. HTML/CSS/JS buffer up to 4 MiB, and only eight transforms can buffer concurrently. A hash of the complete transformation input keys a bounded FIFO cache; cached transformed source can be shared because no user cookie state is injected into it. Authenticated upstream HTTP responses are never stored in that cache or in the application service-worker cache.

Transforms are not cached for requests carrying virtual cookies/Authorization, non-GET requests, or responses setting cookies. The runtime bundle is minified; workers receive a separate small entry bundle without the DOM CSS parser. Source transformation runs synchronously in one Node process, so CPU parallelism, parser cancellation, peak Rust/Node RSS, sustained load, percentiles under concurrency, large text pages and release-versus-debug comparisons are remaining work. End-to-end upload streaming and source-preserving incremental HTML transformation are also future performance work.
