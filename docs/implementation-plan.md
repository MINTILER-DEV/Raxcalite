# Raxcalite implementation plan

1. Rust transport, canonical URL contract, parser-based rewriting, limits and DNS destination validation.
2. TypeScript compatibility runtime: navigation, networking, origin namespaces, cookies, frames and workers; WebSocket relay and application service worker.
3. Compact browser UI, collapsible chrome, icon, diagnostics and recovery controls.
4. Controlled fixture integration and Playwright tests; repeatable transformation and transport benchmarks.
5. Deployment, architecture, trust model and exact compatibility limits.

The Rust server owns all upstream connections. A loopback-only authenticated Node transformer uses parse5 (HTML5), Lightning CSS and Babel's scope-aware AST. Babel is used instead of SWC because its traversal exposes lexical bindings directly without a custom compiled plugin. This is a production-oriented starting implementation, not a claim of universal browser compatibility. Verified features and remaining gaps are recorded in the compatibility document.
