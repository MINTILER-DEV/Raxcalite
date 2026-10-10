# Deployment

## Local development

Run from the repository root with `npm ci` then `npm run dev`. Filesystem roots for static assets are relative to the process working directory. The Node launcher builds frontend bundles and starts both services using one generated transformer token. Stop it with Ctrl+C. Node 24 and Rust 1.93+ are the tested versions.

`.env` is loaded by the development launcher. Ports 3030 (shell), 3031 (content), and 3032 (loopback transformer) are defaults. Changing only ports still works: the shell defaults to its own port plus one for the content port. If ports are nonconsecutive, set `RAX_PROXY_ORIGIN` and rebuild. Set `RAX_APP_ORIGIN` to the exact shell origin recognized by the backend. Keep the two native origins distinct.

## Process separation

Build with `npm run build` and `cargo build --release --locked`. When using a process manager, set the same high-entropy `RAX_TRANSFORM_TOKEN` on `node tools/transformer.mjs` and the Rust binary. Start the transformer first, and run the binary from the repository root. The binary needs `frontend/dist` and the transform service to serve pages. A process manager should restart either component on failure and cap memory/CPU.

`tools/serve.mjs` is the prebuilt launcher: set `RAX_BINARY` to the platform-specific binary path when it is not `./raxcalite`. It runs no build step. The Docker image uses this launcher.

## Docker

```sh
docker build -t raxcalite .
docker run --rm -p 127.0.0.1:3030:3030 -p 127.0.0.1:3031:3031 raxcalite
```

Only bind the published ports to loopback for private local use. The image binds inside the container and runs as a non-root user. Port 3032 is not published. Docker was unavailable in the implementation environment; the Dockerfile has not been build-verified. The native commands and browser suite have been verified.

For a gateway-hosted image:

```sh
docker build --build-arg RAX_PROXY_ORIGIN=https://content.example.test -t raxcalite .
docker run --rm -p 127.0.0.1:3030:3030 -p 127.0.0.1:3031:3031 \
  -e RAX_APP_ORIGIN=https://browser.example.test \
  -e RAX_PROXY_ORIGIN=https://content.example.test raxcalite
```

Use HTTPS and sibling subdomains of the same site so Strict session cookies work in embedded content. Configure gateway authentication on **both** hostnames and preserve Host. Route the shell hostname to 3030, content hostname to 3031, and allow WebSocket upgrades on the latter. Preserve request/response streaming; disable reverse-proxy buffering for SSE. Bound HTTP request/read deadlines, apply IP/global limits and restrict egress to public web destinations at the firewall as an independent layer. Credentials for upstream websites belong only in the virtual jar, not in gateway URLs or process logs.

`RAX_TRUSTED_GATEWAY=1` acknowledges these external controls before a non-loopback Rust bind. It is not an authentication implementation. Do not expose the content backend directly or run with fixture exceptions. Sessions and upstream cookies are in memory and are lost on restart. Persistent shared-session deployments require a separately designed encrypted state store and multi-instance session affinity.

## Updates and recovery

Rebuild assets and restart both processes together. Application worker caches use an explicit version (`rax-shell-v1`); increment it when changing caching behavior. Normal asset requests use network-first refresh. Settings → Reset application worker unregisters the shell worker and clears its caches; reload reinstalls it. Content worker registration can be recovered using that content origin's browser DevTools → Application → Service Workers. A future version should expose coordinated recovery for both origins.

Browser diagnostics are bounded to 100 entries/tab and do not log bodies or cookies. `RAX_DEBUG=1` enables runtime console diagnostics; `RAX_SOURCE_MAPS=1` emits inline transformed JavaScript maps. `RUST_LOG=warn` enables category-only backend warnings. Transform parse failures appear as explicit error pages or inline diagnostics.
