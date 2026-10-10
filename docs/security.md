# Security and trust model

Use Raxcalite as a compatibility tool for sites you trust, within a private instance. The shell and content origins are separate, so native origin checks protect direct access to shell DOM/storage. All **virtual websites within the content origin still share a real origin**. A malicious upstream page can recover native APIs from a same-origin realm, forge virtual request metadata, inspect native storage namespaces, or attack another content frame. Runtime checks, namespacing, sandbox attributes and postMessage envelopes cannot reproduce the browser's native site isolation. Do not treat them as a hostile-site security boundary.

For stronger isolation, the next architecture should allocate a dedicated native content origin per upstream site (and potentially per user), with wildcard DNS/TLS, origin-aware routing, separate service-worker scopes and a cookie credential broker that does not trust client origin assertions. That requires an additional protocol/deployment migration; it is not implemented here.

## Upstream enforcement

- Only HTTP(S)/WS(S) destinations; URLs with credentials are rejected.
- Default public upstream ports are 80 and 443.
- Literal private, loopback, link-local, multicast, unspecified, reserved and documentation IPs are blocked. IPv4-mapped IPv6 and common transition tunnels are checked.
- Reqwest uses a custom DNS resolver that rejects a hostname if any resolved address is unsafe. Validated addresses are the addresses used to connect, closing the separate-check/separate-resolution rebinding gap. HTTP redirects are exposed as mapped redirects only after validation; the next request validates DNS again. Automatic server-side redirects and ambient system proxies are disabled.
- WebSocket destinations resolve and validate once, then connect to those socket addresses with the original hostname used for TLS. Relay text/binary/ping/pong/close frames use bounded, backpressured native streams.
- `RAX_FIXTURE_HOSTS` grants an explicit host exception for controlled local tests, including that host's private addresses and ports. **Never set it in deployed instances.**
- Cookie jars are per session and destination; original browser Cookie headers are never forwarded. Cross-virtual-origin Authorization headers are removed. Secure/HttpOnly/Domain/Path/expiry/Max-Age use the cookie jar's semantics, with a bundled public-suffix list, cookie-prefix validation and script overwrite protection across paths. Cross-virtual-origin requests conservatively send only explicit SameSite=None cookies; registrable-domain SameSite equivalence and top-navigation Lax exceptions are not implemented.
- Virtual CORS validates upstream allow-origin/credentials and performs preflights for non-simple methods/headers. These are compatibility checks, not authentication for malicious content. Fetch turns virtual CORS rejection into a network error; XHR event fidelity and response-header exposure remain partial.

## Limits

| Resource | Bound |
| --- | --- |
| Concurrent HTTP/relay operations | 32 total |
| Concurrent buffered transformations | 8 |
| Request body | 8 MiB (bounded buffering; uploads are not end-to-end streamed) |
| Request body deadline | 30 seconds |
| Transformable response | 4 MiB of decoded text |
| Binary/streaming response | 128 MiB |
| Connect timeout | 10 seconds |
| Upstream read inactivity timeout | 30 seconds |
| Transformer timeout | 30 seconds |
| Sessions | 256; idle sessions can be evicted after 30 minutes when capacity is reached |
| Cookies/session | 128; script/raw cookie input ≤4 KiB |
| Requests/session | 600 per minute |
| WebSockets/session | 8 |
| WebSocket message/frame | 4 MiB / 1 MiB |
| WebSocket lifetime | 1 hour |
| Transform cache | 32 million result string characters, FIFO eviction; not upstream-response caching |

These bounds limit individual allocations and concurrency; they are not a measured whole-process memory ceiling. The transformer parses synchronously, so complex parser workloads can still stall its event loop. Sessions expire in memory and are not persisted. Cookie capacity skips further Set-Cookie entries; diagnostics for that condition need expansion. Session identifiers and native browser storage survive different intervals, so server restart logs users out while client storage remains.

## Header policy

Unchanged binary responses retain content type, range semantics, validators and download disposition. Hop-by-hop headers are removed, decoded compression headers are handled by Reqwest, and sessions' Set-Cookie never passes through raw. Private upstream resources use no-store to avoid cross-user HTTP-cache leakage. Transformed text removes stale length/encoding/hash validators and advertises UTF-8.

HTML CSP and X-Frame-Options are replaced because their original origin assumptions cannot govern rewritten source embedded in the shell. The replacement limits ordinary sources to the content origin, data/blob where needed, disallows plugins, restricts embedding to shell/content origins, and permits inline/eval scripts for compatibility. Camera, microphone, location and payments are disabled. Authored meta CSP and script integrity/nonce attributes are removed for transformed bytes. This is a deliberate compatibility policy that weakens original inline-script restrictions; original CSP is not faithfully preserved. CSS/JS CSP and remaining COOP/COEP/CORP headers are retained where not explicitly translated. Referrer policy is same-origin on the actual content origin so the server can derive the virtual referer.

Upstream HSTS, Clear-Site-Data and Service-Worker-Allowed do not apply to proxy application state and are dropped. Upstream CORS headers are consumed for virtual checks and replaced with shell access policy at the proxy boundary. No DRM, authentication challenge, WebAuthn relying-party origin or browser security boundary is bypassed.

## Hosting

The default bind is loopback. Public binding requires `RAX_TRUSTED_GATEWAY=1`, an explicit operator assertion that authentication, TLS, access logging, global/IP rate limits, request deadlines and network egress restrictions exist outside this process. The flag does not implement authentication. Protect **both** origins at the gateway; leave the authenticated transformer on loopback. Do not host an anonymous public proxy.

The transformer requires a random shared bearer token, binds only 127.0.0.1, caps inputs and caches results in memory. Session cookies are HttpOnly and SameSite=Strict, with Secure on HTTPS. Operational errors/logs expose categories, not upstream credentials, bodies or cookie values. Browser test traces contain fixture data; keep real account traces private.
