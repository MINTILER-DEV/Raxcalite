# Architecture

Raxcalite serves the control shell on port 3030 and proxied documents on port 3031. Those are distinct native origins. An iframe is the rendering surface, not the proxy implementation: the Rust backend fetches upstream resources, parsers transform authored source, and the injected runtime supplies a consistent virtual environment before page scripts execute.

```text
Shell origin :3030 ── address/tab controls
  │ sandboxed content frame, validated status messages
  ▼
Content origin :3031 ── application service worker
  │ /p/<origin token>/<path>?query#fragment
  ▼
Rust/Axum ── session jar ── destination validation ── pooled Reqwest/Rustls
  │                                             │
  │ text transform (bounded)                    ▼ upstream HTTP(S)
  ▼
Authenticated loopback Node transformer :3032
  ├─ parse5: HTML5 parsing, base resolution, srcset, inline source, runtime injection
  ├─ Lightning CSS: URL/import/font/image-set/custom-property AST visitors
  └─ Babel: lexical bindings, global location, module imports, import.meta, messaging
  │
  ▼
TypeScript runtime: navigation / network / storage / cookies / DOM / frames / workers
```

## Contracts

`shared/url.mjs` defines deterministic origin encoding: unpadded base64url over UTF-8 serialized URL origin. Paths, queries and fragments remain normal URL components. Rust implements the same contract in `url_mapping.rs`; round-trip tests cover Unicode and escaped components. Already mapped routes are recognized idempotently by their valid origin token. This reserves paths matching a canonical proxy route; a real upstream path with the same encoded shape is an ambiguity to avoid in future protocol versions.

Runtime configuration carries original URL, effective `<base>`, diagnostics mode and transformation warnings. Actual browser `location` remains native; supported global/static references are AST-transformed to `__rax.location`. Runtime fetch/XHR attach internal credentials, origin and request-mode metadata. The server consumes it and never forwards these `x-rax-*` headers upstream. Requests use decoded referers and origin identity; cookies are selected solely from the user's server-side jar for that destination. Reserved `__rax_worker` query metadata is consumed before forwarding.

HTML runtime scripts are prepended to the parsed head. CSS and JavaScript are transformed only for textual resource types/script destinations. Nontext resources stream under a byte cap. JavaScript parsing errors for external scripts fail visibly; inline failures are retained with explicit diagnostics. Optional inline source maps (`RAX_SOURCE_MAPS=1`) use the original resource URL as source identity. `RAX_DEBUG=1` also logs runtime diagnostics to the page console.

## State and lifecycle

HttpOnly session identifiers are random UUIDs. Each session owns a `cookie_store` jar and quotas; the shell never receives its cookies. Script cookie access uses a same-virtual-origin synchronous bridge so assignment precedes subsequent networking. Local/session storage, database names, cache names and BroadcastChannel names use virtual-origin namespaces. These are compatibility namespaces, not security boundaries against hostile same-native-origin code.

Dedicated and shared worker URL constructors map entrypoints. Classic workers import a small worker runtime first. Module workers initialize that runtime, then dynamically import a rewritten body, ensuring dependencies execute after initialization. Shared-worker names include virtual origin identity. URL-backed workers retain native message channels/lifecycle; blob/data worker execution is explicitly rejected.

Window postMessage calls are AST-routed through a sender-aware envelope. Receiver hooks filter the virtual target and expose the sender's virtual origin. Transfer lists remain native. Internal diagnostics do not reach page message handlers. Arbitrary WindowProxy security behavior is not emulated.

Service workers register independently on shell and content origins. They route only in-scope requests, use one native fetch per proxied request, and never cache upstream resources. Versioned application caches support offline shell assets; settings can unregister the shell worker. Upstream service-worker registration is rejected. The network proxy itself requires a live backend.

## Parser choices

The Rust server owns upstream traffic and enforcement. The Node sidecar makes mature parser integrations available without a custom SWC compiled plugin. Babel exposes lexical scope binding checks directly ([traversal documentation](https://babeljs.io/docs/babel-traverse)); Lightning CSS supplies standards-aware visitors ([visitor documentation](https://lightningcss.dev/transforms.html)). CSS Tree supplies parser-based dynamic CSS rewriting in the browser. This adds a Node operational dependency but avoids text replacement as a primary source parser.
