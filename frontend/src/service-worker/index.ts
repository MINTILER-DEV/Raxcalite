const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = 'rax-shell-v1';
sw.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/', '/icon.svg']))); sw.skipWaiting(); });
sw.addEventListener('activate', event => event.waitUntil(Promise.all([sw.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('rax-shell-') && key !== CACHE).map(key => caches.delete(key))))])));
sw.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== sw.location.origin || event.request.method !== 'GET') return;
  // Proxy resources never enter a shared cache. Forward once without recursive fetch events.
  if (url.pathname.startsWith('/p/')) { event.respondWith(fetch(event.request)); return; }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;
  if (!['/', '/index.html', '/icon.svg'].includes(url.pathname) && !url.pathname.startsWith('/assets/')) return;
  event.respondWith(fetch(event.request).then(async response => {
    if (response.ok) { const cache = await caches.open(CACHE); await cache.put(event.request, response.clone()); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || new Response('Raxcalite is offline', { status: 503 })));
});
