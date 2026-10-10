# Security and trust model

Default routing assigns distinct native origins to each user/site pair and to the shell. Native origin checks protect frame DOM, workers and storage. The server authenticates the session and verifies target Host; virtual source assertions must agree with native Origin/Referer. Fresh unpatched browser realms cannot forge another virtual site's identity. See [native-origin contract](native-origins.md).

Shared mode places virtual sites on one native origin and is suitable only for trusted testing. Namespaces/runtime checks cannot make that mode a hostile-site boundary. Even isolated mode does not give an upstream site its original native identity or constitute an independent security audit. The dedicated parent cookie domain must contain no unrelated services; browser parent-domain cookie capabilities retain cookie-poisoning/denial-of-service risks.

## Enforcement

Only HTTP(S)/WS(S), permitted public ports and credential-free destination URLs are accepted by default. Private/loopback/link-local/reserved/documentation addresses are blocked, including mapped IPv6 and transition cases. DNS resolution rejects mixed public/private or empty results. Reqwest connects using validated resolver addresses; WS resolves once and connects to validated sockets with the original TLS hostname. Each mapped redirect validates again. Automatic upstream redirects and ambient system proxies are disabled. `RAX_FIXTURE_HOSTS` is a test-only administrator exception.

Browser Cookie and gateway Authorization never pass through to upstream. Cookies come from the per-session jar for the original destination. Explicit website Authorization travels separately, may intentionally target a CORS-authorized origin, and is removed on cross-origin redirect. Native transport Priority is removed; explicit website Priority is preserved separately. CORS checks use credential-aware origin, method and header policies; Authorization requires an explicit allowed header under the [Fetch preflight rules](https://fetch.spec.whatwg.org/#cors-preflight-fetch). Browser response wrappers filter exposed headers and report rejected CORS as network failures.

Cookie validation covers public suffixes, prefixes, path/domain/expiry/Secure/HttpOnly, script overwrite protection, schemeful SameSite, bounded replacement/deletion/eviction and maintenance. Lax top-level exceptions are conservative because iframe-based virtual browsing cannot recreate every original ancestor-site context. HttpOnly cookies are unavailable to scripts.

## Resource limits

| Resource | Bound |
| --- | --- |
| Active HTTP/socket operations | 32 |
| Buffered transforms | 8 |
| Parser processes / queued tasks | 4 / 8 |
| Parser deadline, including queue | 10 seconds; process killed on timeout/cancellation |
| Parser JS old-space | 192 MiB per process; native RSS requires OS/container limits |
| Browser/backend upload | 64 MiB; backend streams, browser HTTP/1 wrapper buffers |
| Upload/transformed-body deadline | 30 seconds |
| Transformable response | 4 MiB decoded bytes |
| Binary/SSE stream | 128 MiB; 10-minute binary / 1-hour SSE total lifetime |
| Connection / read inactivity | 10 / 30 seconds |
| Sessions | 256, 30-minute idle TTL; active sockets retain a session |
| Cookie jar / individual input | 128 cookies / 4 KiB |
| Requests per session | 600 per minute |
| Registered virtual origins per session | 1024 |
| WebSocket session quota / frame / message / lifetime | 8 / 1 MiB / 4 MiB / 1 hour |
| Transformation cache | 32 MiB counted result bytes, FIFO |
| Persistent state | 4 MiB plaintext; authenticated encryption |

These are allocation/admission limits, not a whole-process memory guarantee. Benchmarks record sampled Rust/Node memory and parser task-end snapshots. Deployment uses OS/container limits. Authenticated, cookie-bearing, non-GET and Set-Cookie transform results are excluded from caching; upstream browsing responses and application workers use no-store.

## Header and browser policy

Binary responses preserve usable MIME/range/download headers. Hop-by-hop fields are removed. Upstream compression is decoded, and downstream gzip/Brotli is negotiated separately. Transformed bytes remove stale length/hash validators, integrity/nonces and encoding and advertise UTF-8.

HTML CSP/X-Frame-Options cannot govern rewritten source using original origins, so they are replaced with a documented proxy policy. It restricts normal sources to mapped content hosts, permits necessary inline/eval code and data/blob resources, disables plugins, restricts frame ancestors, and enforces a sandbox even for direct content documents. The sandbox prevents document.domain relaxation. Origin-Agent-Cluster requests origin-keyed allocation; camera/microphone/geolocation/payment/document-domain permissions are disabled. Original inline CSP restrictions are therefore weakened, not faithfully emulated. Non-HTML COOP/COEP/CORP/CSP are retained where no explicit translation is needed.

HSTS, Clear-Site-Data and original Service-Worker-Allowed cannot control application state and are dropped; a mapped scope limit is supplied for supported classic upstream workers. Referrer policy allows same-origin document identity and native-origin-only cross-site source identification. Virtual CORS is consumed upstream and native gateway CORS authorizes mapped application/content hosts. This cannot defeat original WebAuthn identity, DRM, anti-bot challenges, authentication policy or browser permission rules.

The default bind is loopback. Public access requires an authenticated HTTPS gateway and independent egress/IP/global abuse controls. Operational metrics/transformer calls require a random bearer secret. Session keys/checkpoints and real-account traces must remain private; logs never intentionally include cookie values, bodies or Authorization values.
