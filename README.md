# Raxcalite

A compact browser interface backed by a Rust rewriting proxy and a TypeScript compatibility runtime. Tabs and navigation occupy **66 px**. Collapse them to a **25 px handle**, or enable automatic hiding in Settings. Proxied pages fill the remaining viewport. Includes a custom SVG app icon, address/search input, back/forward/reload, tabs, diagnostics, dark/light themes and application-worker recovery.

This is a working, tested compatibility layer. It does **not** reproduce every browser API or provide native security isolation between virtual websites. Read [compatibility](docs/compatibility.md) and [security](docs/security.md) before using sensitive accounts or deploying a shared instance.

## Run locally

Requires Rust **1.93+**, Node **24+**, npm, and the usual Rust linker/build tools for your platform.

```sh
npm ci
npm run dev
```

Open **http://localhost:3030**. The first run compiles Rust. Keep this terminal running. `npm run dev` builds Vite and both runtime bundles, starts an authenticated loopback transformer, and launches the Rust backend. It does not provide hot reload; restart after source edits.

To use a release build:

```sh
node tools/start.mjs --release
```

Enter an HTTP/HTTPS address; bare domains use HTTPS and other text becomes a search. **Ctrl+L** opens the address field; **Ctrl+Shift+B** toggles the toolbar while the shell has focus. Settings include automatic hiding and dark/light appearance. Closing a tab releases its frame and workers. The toolbar uses a separate browser origin from content pages.

Copy [.env.example](.env.example) to `.env` to customize ports/origins. `npm run dev` loads it; credentials are not committed. Public binding requires an explicitly configured authenticated gateway. See [deployment](docs/deployment.md).

## Verify

```sh
npm run build
cargo test
cargo clippy --all-targets -- -D warnings
npm test
npx playwright install chromium
npm run test:e2e
```

Playwright launches controlled fixture websites and the proxy. Private fixture hosts are authorized only in that test process. The tests compare direct and proxied execution and cover HTML/CSS, JavaScript, fetch/Request/XHR, HTTP methods, forms, cookies, origin storage, IndexedDB, Cache Storage, history, frames/messaging, workers, dynamic imports, WebSockets, SSE, redirects, binary/range responses, cancellation, unsafe destinations, DOM/CSSOM insertion, compact/mobile UI and service-worker recovery. Linux may need `npx playwright install --with-deps chromium`.

```sh
npm run bench
cargo build
node benchmarks/system.mjs
```

The second benchmark starts and stops its own fixture/backend processes; ports 3031, 3032 and 4040 must be free. Measurements and methodology are in [performance](docs/performance.md).

## Source map

| Directory | Responsibility |
| --- | --- |
| `backend/src` | Axum server, pooled TLS transport, DNS validation, sessions/cookies, virtual CORS, WebSocket relay, bounded transformation bridge |
| `shared` | Canonical URL mapping contract |
| `tools/rewriting` | HTML5 parsing (parse5), CSS parsing (Lightning CSS), scope-aware JavaScript AST transformation (Babel) |
| `frontend/src/runtime` | Virtual location/navigation, networking, storage, cookies, frames, dynamic DOM/CSS and workers |
| `frontend/src/app` | Compact browser shell |
| `frontend/src/service-worker` | Application asset/offline caching and content routing |
| `tests` | Controlled fixture sites, parser tests and browser regression suite |
| `benchmarks` | Reproducible transformation, download and browser measurements |

Read [architecture](docs/architecture.md), [header policy and trust model](docs/security.md), and [remaining work](docs/remaining-work.md). GitHub Actions runs build, Rust/parser tests and Playwright on pushes and pull requests.
