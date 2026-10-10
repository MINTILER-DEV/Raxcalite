import { currentURL, getter, report, config } from '../core/context';
export function installStorage() {
  const prefix = `rax:${new URL(currentURL()).origin}:`;
  if (!config.worker) {
    for (const name of ['localStorage', 'sessionStorage'] as const) {
      try {
        const storage = window[name];
        const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter(k => k.startsWith(prefix));
        const methods: Record<string, unknown> = {
          getItem: (k: string) => storage.getItem(prefix + String(k)),
          setItem: (k: string, v: string) => storage.setItem(prefix + String(k), String(v)),
          removeItem: (k: string) => storage.removeItem(prefix + String(k)),
          clear: () => keys().forEach(k => storage.removeItem(k)),
          key: (i: number) => keys()[Number(i)]?.slice(prefix.length) ?? null,
        };
        const virtual = new Proxy(Object.create(Storage.prototype), {
          get: (_t, k) => k === 'length' ? keys().length : k === Symbol.toStringTag ? 'Storage' : Object.hasOwn(methods, k) ? methods[k as string] : typeof k === 'string' ? storage.getItem(prefix + k) ?? undefined : undefined,
          set: (_t, k, v) => { storage.setItem(prefix + String(k), String(v)); return true; },
          deleteProperty: (_t, k) => { storage.removeItem(prefix + String(k)); return true; },
          ownKeys: () => keys().map(k => k.slice(prefix.length)),
          has: (_t, k) => Object.hasOwn(methods, k) || storage.getItem(prefix + String(k)) !== null,
          getOwnPropertyDescriptor: (_t, k) => storage.getItem(prefix + String(k)) === null ? undefined : { enumerable: true, configurable: true, value: storage.getItem(prefix + String(k)), writable: true },
        });
        getter(window, name, () => virtual);
      } catch { report('storage', `${name} is unavailable in this context`); }
    }
    window.addEventListener('storage', event => {
      if (event.key && !event.key.startsWith(prefix)) { event.stopImmediatePropagation(); return; }
      if (event.key) Object.defineProperty(event, 'key', { value: event.key.slice(prefix.length) });
      if (event.url) Object.defineProperty(event, 'url', { value: globalThis.__rax.unmap(event.url) });
    }, true);
  }
  if (globalThis.indexedDB) {
    const factory = indexedDB;
    const open = factory.open.bind(factory); factory.open = (name, version) => open(prefix + String(name), version);
    const remove = factory.deleteDatabase.bind(factory); factory.deleteDatabase = name => remove(prefix + String(name));
    if (factory.databases) { const databases = factory.databases.bind(factory); factory.databases = async () => (await databases()).filter(d => d.name?.startsWith(prefix)).map(d => ({ ...d, name: d.name!.slice(prefix.length) })); }
    const name = Object.getOwnPropertyDescriptor(IDBDatabase.prototype, 'name');
    if (name?.get) getter(IDBDatabase.prototype, 'name', function(this: IDBDatabase) { return String(name.get!.call(this)).replace(prefix, ''); });
  }
  if (globalThis.caches) {
    const cache = globalThis.caches;
    const open = cache.open.bind(cache); cache.open = name => open(prefix + String(name));
    const remove = cache.delete.bind(cache); cache.delete = name => remove(prefix + String(name));
    const has = cache.has.bind(cache); cache.has = name => has(prefix + String(name));
    const keys = cache.keys.bind(cache); cache.keys = async () => (await keys()).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
    const match = cache.match.bind(cache); cache.match = async (request, options) => {
      if (options?.cacheName) return match(request, { ...options, cacheName: prefix + options.cacheName });
      for (const key of await cache.keys()) { const hit = await (await cache.open(key)).match(request, options); if (hit) return hit; }
      return undefined;
    };
  }
  if (globalThis.BroadcastChannel) { const Channel = globalThis.BroadcastChannel; globalThis.BroadcastChannel = new Proxy(Channel, { construct(Target, args) { return Reflect.construct(Target, [prefix + String(args[0])]); } }); }
}
