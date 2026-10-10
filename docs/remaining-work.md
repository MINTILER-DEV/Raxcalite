# Delivery status and practical limits

The previous implementation backlog has been addressed: native per-user/site origins, AST/generated-source support, CORS response/XHR semantics, cookie eviction/SameSite/persistence/TTL, charset decoding, bounded uploads, dynamic DOM/Cache operations, native history/tab restore, three-engine tests, classic site workers, parser-process cancellation, compression, operational limits/readiness/metrics/shutdown, Docker/HTTPS verification and reproducible load/public-site measurements are implemented. Evidence lives in the test suites, CI workflow and benchmark JSON, not a universal compatibility claim.

## Native limitations

An ordinary web application cannot grant a proxied page the original site's native security identity, redefine unforgeable Window/Location/ServiceWorker internals, bypass WebAuthn/DRM/authentication policy, make iframe tabs independent browser history stacks, or guarantee another engine's BFCache behavior. Those requirements remain unsupported/native. Permissions and origin-bound platform services are intentionally restricted. No fake replacements are supplied.

The tested native module-service-worker script fetch omits gateway session credentials. Raxcalite cannot change that native fetch option through ServiceWorker.register and rejects module registration rather than serve a user's resources without authentication. Classic URL-backed workers use the verified isolated-scope path. Arbitrary Blob/File worker source is also unavailable synchronously at Worker construction; URL-backed workers are the supported path.

## Exact partial behavior

These are compatibility limits of the current architecture, not claims of literal impossibility for every future architecture:

- Arbitrary reflective/aliased native Window access, with, indirect/aliased eval and all optional-call side effects are not universally transformed. The supported AST/generated-source paths are tested; runtime identity/reflection can still reveal the native proxy.
- Full original ancestor/top-site SameSite context, browser cookie ordering/eviction policy and default-Lax grace rules are not identical. Cookie sending is conservative in unsupported contexts.
- Attr.value/attribute collections, CSS selectors, serialization, unusual namespace removals and writes split inside HTML tokens can expose mapped strings or differ from native parsing. Complete-fragment document.write and covered dynamic insertion work.
- Opaque response properties are simulated on a branded empty Response; native Cache/respondWith internals do not become genuinely opaque. Storage/Headers prototype reflection and shared-mode clear events are partial.
- Recovery covers the shell and opened site origins. Browser same-origin rules prevent directly clearing all unopened site workers/storage from the shell. Persistent sessions are single-instance/affinity-based.
- Browser uploads buffer within the 64 MiB cap for HTTP/1 interoperability; only backend forwarding is streamed. Text transformations buffer within 4 MiB for HTML/CSS or 16 MiB for JavaScript. OS/container limits are still required for native parser memory.
- Five public render checks and deterministic fixtures do not establish complete authenticated journeys, sustained production capacity, distributed deployment behavior or an independent adversarial audit. MDN/Rust parser recovery warnings are recorded as partial; no website-specific patches were added.

Potential future extensions should have a concrete compatibility contract and direct-browser regression evidence before changing these classifications. See [compatibility](compatibility.md), [performance](performance.md), [security](security.md) and [deployment](deployment.md).
