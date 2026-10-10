# Compatibility record

Status describes the controlled Chromium fixtures, not universal website compatibility. Successful rendering alone is insufficient. Run `npm run test:e2e` to reproduce the observed behavior.

| Surface | Classification | Coverage / practical limit |
| --- | --- | --- |
| HTML navigation and resources | Correct in fixtures | Links, forms, base, script/style/link/image/media URL attributes, srcset, srcdoc, SVG references, refresh and malformed HTML parsing |
| CSS | Correct in fixtures | Imports, fonts, URL/image-set/custom properties, inline CSS; dynamic DOM/CSSOM parser included |
| JavaScript | Partially compatible | Modern syntax, lexical location bindings, assignments, static/dynamic module imports, import.meta.url and postMessage call transforms; dynamic source and reflective access remain gaps |
| Fetch / Request | Correct in fixtures | Bodies, HTTP methods, credentials metadata, Response URL, AbortController, JSON/binary/streaming; uploads buffered, cross-origin no-cors rejected |
| XMLHttpRequest | Partially compatible | URL/open/send mapping and response types; virtual CORS status/event/header exposure not identical to native cross-origin XHR |
| Cookies / sessions | Correct in fixtures, partial SameSite | HttpOnly kept server-side; script cookie ordering and user separation verified; SameSite handling conservative; 128 cookie/session cap |
| localStorage / sessionStorage | Correct in fixtures | Named properties/methods/clear/key/length and namespaces; events translated; hostile native-access isolation impossible |
| IndexedDB | Correct in fixtures | Native database APIs, namespaced open/delete/list/name; origin quota is shared |
| Cache Storage | Correct in fixtures | Cache names isolated through wrapper, native cache operations; Request semantics inside individual caches not comprehensively virtualized |
| BroadcastChannel / MessageChannel | Partially compatible | Broadcast names namespaced; MessageChannel native transfers; extended event/name semantics not separately regression tested |
| Location / history | Correct for supported references | Original document URL/base/referrer, push/replace/back; native unforgeable location and dynamic computed global properties remain actual origin |
| Shell history | Partially compatible | Back/forward reload recorded destinations; does not preserve BFCache/POST resubmission/page state as a native browser would |
| Frames / postMessage | Correct in fixtures, security-limited | Nested URL mapping and virtual sender/target envelope; WindowProxy cross-origin isolation cannot be emulated; optional/computed/reflective message calls may bypass AST |
| Dedicated classic/module workers | Correct in fixtures | URL-backed scripts, imports, fetch, messages and lifecycle; imported module initialization order fixed |
| Shared workers | Partially compatible | Constructor and origin-namespaced worker name implemented; browser support varies; additional regression coverage needed |
| Upstream service workers | Unsupported | Registration rejects with NotSupportedError; native origin/scope enforcement cannot be moved to virtual origins |
| Application service workers | Correct in fixtures | Separate shell/content registrations, offline app assets, pass-through routing, shell worker reset; backend still required for browsing |
| WebSocket | Correct in fixtures | Text relay and protocol selection tested; binary/control/close/backpressure implemented but need stress/edge regression tests |
| EventSource | Correct in fixtures | Mapped streaming events; reconnect/Last-Event-ID and large streams require more coverage |
| Redirects | Correct in fixtures | Native method transitions across mapped Location; unsafe target rejected; cross-origin redirect chains need broader coverage |
| Downloads / ranges / media | Partially compatible | Binary bytes and ranges verified; URL-backed media passed through, codec/DRM behavior remains native and unverified |
| Security checks | Security-restricted | Private destinations and unsafe redirects denied, URL-backed trusted tests explicitly allowlisted, toolbar origin isolation verified |
| DOM insertion | Correct for covered operations | URL properties/attributes, innerHTML and srcset/CSSOM mapped; dynamically constructed inline scripts, document.write and unusual insertion APIs incomplete |
| Blob / data URLs | Partially compatible | Native resource/fetch URLs preserved; blob/data workers reject rather than run untransformed source |
| Origin-bound APIs | Unsupported or native | WebAuthn, DRM, WebRTC, native permissions, secure-context APIs and platform identity cannot acquire the original site's genuine origin |
| Non-UTF-8 text | Unsupported | Explicit error instead of corrupt transformation; charset decoding is remaining work |

Bare ES module specifiers remain bare so rewritten import maps can resolve them. Reserved helper name `__rax` can collide with authored globals. An import with a computed source maps supported network paths at runtime. Code generated through eval/Function/script.text, destructured/aliased native location, optional/computed Window.postMessage, custom elements and unusual DOM APIs need additional transformations or safe compatibility restrictions.

The suite currently targets Chromium only. Firefox/WebKit, real-world site cohorts, authenticated journeys, malformed/large inputs and adversarial code require separate validation. No browser feature is declared fully implemented merely because its constructor exists.
