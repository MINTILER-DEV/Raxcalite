# Exact remaining work

The repository is runnable and the tested browser/runtime paths work. It is not the fully hardened, universal browser compatibility platform described in the initial prompt. Continue from the current implementation; do not replace it with website-specific patches.

## Highest priority

1. Migrate content origin routing to dedicated native origins per virtual site/user for hostile-site isolation. Extend the canonical contract, cookie broker, CORS, frames, worker/service-worker scopes and deployment together. Current client-origin assertions are not a secure identity boundary.
2. Extend AST handling for destructured/aliased native location, optional/computed message calls, reflective operations and generated eval/Function/inline scripts. Define collision-safe helper bindings instead of a fixed `__rax` global. Add semantics tests before enabling each transform.
3. Complete response CORS fidelity: filtered exposed headers, opaque no-cors responses, redirect-mode edge behavior and native-equivalent XHR error/events/status. Use the existing server preflight enforcement and add direct-vs-proxied cases.
4. Improve cookies: registrable-domain SameSite context/top-navigation behavior, bounded eviction with diagnostics, persistence and TTL cleanup. Expand the existing adversarial HttpOnly/path/domain/public-suffix checks into broader direct-browser comparisons.
5. Implement non-UTF-8 decoding from charset/sniffing and encode transformed text consistently. Add multipart uploads, large uploads, timeouts and streaming cancellation fixtures. Requests are currently buffered; responses stream only when no transform is needed.

## Compatibility and coverage

- Add browser comparisons for Firefox/WebKit, SharedWorker, BroadcastChannel/storage events, MessageChannel transfers, binary/control WebSocket frames/close codes, SSE reconnect, redirect chains across origins, downloads/media, import maps and CSS edge cases.
- Expand dynamic DOM interception for document.write, inline script text, SVG property APIs, custom elements, adopted stylesheets and mutation races. Preserve original observable attribute strings rather than returning resolved virtual URLs everywhere.
- Finish Cache Storage Request URL semantics and clearing/recovery of both shell and content application workers. Keep upstream service-worker registration explicitly unsupported unless a safe architecture makes a real supported subset possible.
- Run a reproducible real-world site cohort and classify every failure. Example Domain plus controlled fixtures do not establish broad authenticated-site compatibility.
- Preserve browser history/BFCache/page state and correct POST resubmission in shell back/forward. Restore tabs and improve favicon/title behavior without expanding default chrome.

## Reliability and operations

- Move parser work to bounded worker threads/processes with hard CPU/deadline cancellation. Profile peak Rust/Node memory and sustained concurrency; add cache hit statistics and request/operation diagnostics without credentials.
- Verify Docker builds and HTTPS reverse-proxy deployment. Add integration tests for DNS mixed-address/rebinding cases, private redirect resolution, gateway Host handling, rate/session capacities, response byte caps and WebSocket quotas.
- Add persistent encrypted sessions, coordinated shutdown, metrics and operational readiness checks for transformer failure. The current health endpoint indicates Rust responsiveness, not complete dependency readiness.

No phase is considered universally complete: phases 1–4 have working fixture-tested implementations and known compatibility gaps; performance and hardening have implemented limits, checks and benchmarks with the above work still required.
