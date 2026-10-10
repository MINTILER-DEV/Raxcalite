# Architecture

Raxcalite uses a Rust/Axum transport, an authenticated Node parser service, and a TypeScript runtime. The compact shell is on `app.rax.localhost:3030`; each user/site receives a different native content host on port 3031. An iframe renders the site, while the backend and runtime perform environment translation. See [native origins](native-origins.md) for the routing and trust contract.

```text
Browser shell -> isolated content document -> /p/<origin token>/<path>
                                               |
                                      Rust session/SSRF/CORS policy
                                               |
                                      pooled HTTP(S) or WS(S)
                                               |
                         text -> authenticated loopback transformer
                                  four cancellable parser processes
                                  parse5 / Lightning CSS / Babel
                                               |
                         runtime -> location, networking, state,
                                    DOM, frames, workers, diagnostics
```

## Contracts

`shared/url.mjs` encodes an original origin as unpadded base64url over UTF-8. Paths, raw query escapes and fragments remain URL components. Rust implements the same contract. Native host selection additionally uses an independent public user identifier and the first 128 bits of SHA-256 of the original origin. HTTP/WS equivalents share a host. The server authenticates the session independently of that public identifier.

Native Host must match the session and target site. Calling virtual origins come from actual Origin/Referer plus the session's visited-origin registry. Runtime `x-rax-*` assertions must agree with this identity and never reach upstream. Reserved query metadata (`__rax_worker`, `__rax_origin`, `__rax_credentials`) is removed without reserializing ordinary query parameters. Canonical proxy-shaped upstream paths and those metadata names are reserved protocol space.

HTML scripts initialize the runtime before authored code. Babel and the Acorn/ESLint scope analyzer transform supported unbound location references, assignments, imports, import.meta, messaging, direct eval and generated scripts, including async/generator function constructors. The stable private helper is `__RAX_RUNTIME_v1__`; author bindings with that exact reserved name are renamed. The ordinary `__rax` alias is only for diagnostics. Native unforgeable browser properties remain native.

The backend decodes bounded text using BOM/HTTP charset and HTML/CSS encoding rules, and returns UTF-8. parse5 handles HTML and import maps; Lightning CSS handles stylesheets; Babel handles small lexical JavaScript ASTs; large scripts use Acorn, ESLint scope analysis and source-range edits to avoid full-code regeneration. Dynamic CSS uses CSS Tree. External script parse failures fail visibly; inline failures produce compatibility warnings. Runtime configuration is served dynamically by `/config.js`, so deployment origins do not require rebuilding assets.

## State and lifecycle

A session owns a server cookie jar, public routing identifier, visited origins and quotas. HttpOnly cookies never enter page JavaScript. Script cookies use an authenticated same-virtual-origin synchronous bridge. Schemeful registrable-domain SameSite rules and a conservative navigation context select cookies. Optional AES-256-GCM checkpoints preserve persistent cookies and session routing state; ordinary session cookies are omitted.

Native content origins separate site/user storage. Compatibility wrappers also namespace local/session storage, IndexedDB, Cache Storage and BroadcastChannel names. Cache Request keys and observable URLs are translated; quota enforcement remains native. Storage events expose virtual keys, URLs and storageArea. Shared mode provides compatibility namespaces without hostile-site isolation.

Classic workers initialize a runtime and then import a separate rewritten body. Module workers import a bootstrap module before authored dependencies evaluate. Shared workers retain native message channels and namespaced identities. Blob/data worker source is explicitly unsupported. Classic upstream service workers can own only the mapped virtual scope on an isolated origin; application routing workers retain their root scope. Module upstream service workers reject explicitly because tested native script loading omits session credentials. Worker Client URLs/openWindow/navigate are mapped.

Window postMessage calls use virtual sender/target envelopes; receivers validate actual sender origins. MessagePort transfers remain native. Shell navigation commands are authenticated by actual parent origin and message source. Back/forward/reload traverse native frame history, preserving state when the host browser does. Tabs and settings restore after shell reload.

## Reliability

Upstream bodies stream within limits; transformed source buffers at most 4 MiB for HTML/CSS or 16 MiB for JavaScript. The server admits 32 HTTP/socket operations and eight buffered transforms. Small transformations use up to four forked parser processes with 192 MiB JS old-space ceilings and ten-second deadlines. Large inputs use one exclusive 768 MiB process with a twenty-second deadline; small parser processes exit before that lane starts. Queues remain bounded; cancellation kills the process, including native parser execution. A 32 MiB byte-counted FIFO caches hashes of eligible complete transform inputs. Authenticated, cookie-bearing, non-GET and Set-Cookie responses are excluded.

`/ready` checks the transformer. Authenticated metrics report counters, active work, cache hits and process snapshots. Maintenance expires sessions and checkpoints encrypted state. Shutdown stops admission, cancels streams, closes sockets and bounds server draining to ten seconds before a final checkpoint. Application assets use a build-derived cache version and manifest; browsing still requires the backend.
