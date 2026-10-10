const sw = self as unknown as ServiceWorkerGlobalScope;
declare const __RAX_VERSION__: string;
const CACHE = `rax-shell-${__RAX_VERSION__}`;
sw.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const manifest=await(await fetch('/asset-manifest.json')).json();const shell=(await fetch('/config.js')).ok;
    const paths=shell?['/','/config.js','/icon.svg',...manifest.assets]:['/icon.svg','/runtime.js','/worker-runtime.js'];
    await(await caches.open(CACHE)).addAll(paths);await sw.skipWaiting();
  })());
});
sw.addEventListener('activate', event => event.waitUntil(Promise.all([sw.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('rax-shell-') && key !== CACHE).map(key => caches.delete(key))))])));
sw.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin || event.request.method !== 'GET') return;
  // Proxy resources never enter a shared cache. Forward once without recursive fetch events.
  if (url.pathname.startsWith('/p/')) {
    // Reissuing navigations through fetch loses their native destination/mode
    // in some engines. Let the browser request the document directly so the
    // backend can distinguish document rewriting from HTML-labeled API data.
    if (event.request.mode === 'navigate') return;
    // Let native EventSource carry its internal Last-Event-ID on reconnect.
    // Reissuing the request through fetch can discard that browser-managed header.
    if (event.request.headers.get('accept')?.includes('text/event-stream')) return;
    event.respondWith(fetch(event.request)); return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;
  if (!['/', '/index.html', '/icon.svg','/config.js','/runtime.js','/worker-runtime.js'].includes(url.pathname) && !url.pathname.startsWith('/assets/')) return;
  event.respondWith(fetch(event.request).then(async response => {
    // Native-path recovery may redirect / to a proxied website. Its private
    // response must not enter the application asset cache.
    if (response.ok && !new URL(response.url).pathname.startsWith('/p/')) { const cache = await caches.open(CACHE); await cache.put(event.request, response.clone()); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || new Response('Raxcalite is offline', { status: 503 })));
});
