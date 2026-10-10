# Compatibility record

The fixture suite compares direct and proxied behavior in Chromium, Firefox and WebKit. Status applies to covered operations, not complete authenticated website journeys. Reproduce with `npm run test:e2e`, `npm run test:isolation` and `npm run test:https`.

| Surface | Classification | Verified support and limit |
| --- | --- | --- |
| HTML/CSS | Correct in fixtures | HTML5 parsing, base, resources/srcset, forms, SVG links, imports, fonts, image-set and custom properties; parser warnings remain visible |
| JavaScript | Partially compatible | Scope-aware location/top/parent/import/meta/message rewriting, aliases/destructuring, supported Reflect calls, direct eval, ordinary/async/generator Function constructors, timer strings and inserted scripts; arbitrary reflection/with/aliased eval are not universally covered |
| Import maps | Correct in fixtures | Bare, URL-shaped and scoped keys/values mapped consistently |
| Fetch/Request/XHR | Correct in fixtures, partial native internals | Methods, multipart/large bodies, aborts, response URLs, CORS header exposure, XHR native error events/status, redirect modes; browser uploads buffer up to 64 MiB |
| CORS | Correct for tested policies | Credential-aware origin/method/header checks and wildcards, value safelists, explicit Authorization; Authorization must be explicitly allowed even when an engine accepts a wildcard |
| Cookies/sessions | Partially compatible | Domain/path/prefix/public-suffix/expiry, Secure, HttpOnly overwrite prevention, schemeful SameSite, eviction, TTL and encrypted restart; original ancestor/top-site context and default-Lax grace behavior are not fully represented |
| Storage | Correct in fixtures, partial reflection | Names/methods/events/clear, IndexedDB and Cache Request keys; native origin quotas apply, low-level Storage/Headers reflection and opaque Cache internals can differ |
| Frames/messages | Correct in fixtures | Native per-user/site isolation, rewritten top/parent references hide the shell at the virtual root while retaining nested frame relationships, virtual message origins/targets, transfer lists, exact MessagePort/Worker argument forwarding and forged-assertion rejection; arbitrary aliased/reflective Window APIs are not completely rewritten |
| Location/history | Partially compatible | Supported virtual references and native push/replace/back/forward/reload preserve state; current-document aliases, history methods borrowed from same-origin blank frames, no-referrer requests, domain reads and authenticated native-path recovery are translated; native unforgeable Location/WindowProxy identity remains actual |
| Browser shell | Correct in fixtures | 66 px toolbar, 25 px collapse handle, mobile/auto-hide, icon, tabs, restore, favicon/title, diagnostics and recovery; iframe tabs share host joint history and BFCache policy |
| Dedicated/module/shared workers | Correct in fixtures | URL-backed entries, initialization order, imports, fetch, messages and lifecycle; native engine availability still applies |
| Classic upstream service workers | Supported subset | Isolated native site only, mapped scope/scriptURL, controlled fetch, ready/registration and Client URLs; push/notifications/background platform services are not virtualized |
| Module upstream service workers | Security-restricted | Explicit NotSupportedError: tested native module SW loading omits gateway cookies; unauthenticated user-host lookup is never allowed as a fallback |
| Application workers | Correct in fixtures | Build-versioned offline app assets, pass-through routing and shell/open-content recovery; upstream browsing is not available offline |
| WebSockets | Correct in fixtures | Text/binary/protocols, control frames, close codes, backpressure, quota cleanup and HTTPS gateway upgrades; this is not a throughput stress guarantee |
| EventSource | Correct in fixtures | Events, reconnect and Last-Event-ID; application workers preserve browser-managed reconnect requests |
| Downloads/media/ranges | Correct in fixtures | Binary bytes, disposition, ranges and WAV metadata; codecs, DRM and platform playback remain native |
| DOM insertion | Correct for covered operations | Contextual table/SVG fragments, outer/innerHTML, append/replace, shadow resources, event handlers, script data, SVG properties/namespaces, CSSOM and adopted stylesheets; split document.write tokens and every Attr/serialization surface are not identical |
| Text encodings | Correct in fixtures | BOM/HTTP charset, HTML meta sniffing and CSS charset; UTF-8 output |
| Blob/data URLs | Partially compatible | Native resource/fetch URLs work; worker source cannot be synchronously recovered and rewritten for arbitrary external Blob/File URLs |
| Origin-bound APIs | Unsupported/native | Original-origin WebAuthn, DRM, OAuth identity checks, TLS client authentication, browser permissions and crossOriginIsolated cannot be supplied by JavaScript rewriting |

## Public-site evidence

`node benchmarks/cohort.mjs` compares five unauthenticated Chromium pages in fresh contexts. It records document status/title/text size, resource failures, script errors and parser warnings. Example Domain, Wikipedia and Hacker News passed the limited render check. MDN and the Rust homepage were classified partially compatible because parser recovery warnings were observed. The Rust stylesheet failure was fixed with general CSS parser recovery; the recovered syntax remains reported. Every document title matched. See `benchmarks/cohort-latest.json` for the exact snapshot; remote sites and their content can change.

This cohort does not validate sign-in, payments, editors, complete navigation or application-specific behavior. Rendering is only one compatibility dimension. Browser traces and test annotations preserve native differences rather than silently calling every surface equivalent.
