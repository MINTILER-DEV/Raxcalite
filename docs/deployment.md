# Deployment

## Local and process-managed use

Run `npm ci` and `npm run dev` from the repository root. Node 24 and Rust 1.93+ are the tested baseline. The launcher builds assets/Rust, starts the transformer and launches the binary directly so signals reach the server. `node tools/start.mjs --release` selects release mode. Ctrl+C stops local services. `.env` configures ports/origins and optional state; configured origins remain distinct. `--shared` explicitly disables native site routing and is intended for trusted compatibility testing.

For a process manager, run `npm run build` and `cargo build --release --locked`. Set the same random `RAX_TRANSFORM_TOKEN` for `node tools/transformer.mjs` and the Rust binary, keep the transformer on loopback, and run from the project root. `tools/serve.mjs` starts prebuilt services; `RAX_BINARY` overrides its binary path. Restart both on failure and apply container/process CPU and memory limits.

## Native domain and HTTPS gateway

Use a dedicated domain with no unrelated applications or tenants:

```text
RAX_ISOLATION_DOMAIN=content.your-domain.example
RAX_PROXY_ORIGIN=https://content.your-domain.example
RAX_APP_ORIGIN=https://app.content.your-domain.example
```

Route the exact app host to the shell listener (3030); route the base and wildcard content hosts to the content listener (3031). Supply DNS/TLS for the base and wildcard, preserve Host, authenticate access to both routes, and support content WebSocket upgrades. Disable SSE proxy buffering and preserve streaming/cancellation. Runtime origins come from `/config.js`; assets need no origin-specific rebuild. Public isolated deployments require HTTPS; local `.localhost` development can use HTTP.

The HttpOnly Strict session cookie spans the dedicated content domain and is Secure under HTTPS. Gateway authentication belongs at the perimeter. `RAX_TRUSTED_GATEWAY=1` acknowledges external authentication, TLS, IP/global quotas and egress controls before public binding; it does not implement those controls. Never configure `RAX_FIXTURE_HOSTS` in production. Preserve separation between gateway Authorization and explicit website Authorization.

`npm run test:https` uses a local test TLS gateway and ignored short-lived certificate to verify Secure cookies, Host routing, CORS, workers, SSE and socket upgrades in all three engines. Production requires a valid certificate and its own authenticated gateway configuration.

## Docker

```sh
docker build -t raxcalite .
docker run --rm --memory=1536m --cpus=2   -p 127.0.0.1:3030:3030 -p 127.0.0.1:3031:3031   -e RAX_APP_ORIGIN=http://app.rax.localhost:3030   -e RAX_PROXY_ORIGIN=http://rax.localhost:3031   -e RAX_ISOLATION_DOMAIN=rax.localhost raxcalite
```

The multi-stage release image runs as non-root with Node's parent old-space capped at 512 MiB. The transformer is internal and port 3032 is unpublished. CI builds the image and runs isolated Chromium checks against a container limited to 1536 MiB/two CPUs. Local Docker is not required for the native workflow. For deployment substitute the HTTPS domain settings above; port publication alone is not gateway authentication.

## Persistent state and operations

Set `RAX_SESSION_FILE` to a private writable file and `RAX_SESSION_KEY` to 32 random bytes encoded as base64. Keep the key outside the repository/image and preserve it across restarts. Checkpoints use authenticated AES-256-GCM with a fresh nonce, an atomic replacement and a bounded file. Unix file permissions are 0600; use a private Windows ACL. Wrong-key/corrupt state fails startup. Only persistent cookies survive serialization; session cookies do not. Client storage remains in the user's browser. Multi-instance deployments require session affinity; no shared distributed state backend is provided.

`GET /health` reports Rust liveness. `GET /ready` verifies transformer readiness. `GET /metrics` and the transformer's `/metrics` require `Authorization: Bearer <RAX_TRANSFORM_TOKEN>`. Metrics expose counts, queue/cache activity and RSS snapshots without cookies/bodies. On Unix SIGTERM and on supported platforms Ctrl+C initiate draining: streams stop, sockets close, server wait is bounded to ten seconds, then the final encrypted checkpoint is attempted. CI verifies Unix shutdown; Windows process termination is not equivalent to graceful signals.

## Updates, recovery and diagnostics

Build-derived cache versions and an asset manifest update shell/content application assets together. Settings -> Reset application worker unregisters the shell application worker and sends authenticated recovery commands to opened content tabs. It clears application caches, not upstream site service workers or all unopened browser origins. Use site/browser storage controls for a full site reset.

`RAX_DEBUG=1` reports which runtime subsystems route operations plus bounded diagnostics; `RAX_SOURCE_MAPS=1` emits original-source identities for transformed JavaScript. Backend logs contain error categories/counts. Protect traces from real-account sessions; the committed fixtures use synthetic data.
