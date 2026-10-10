import { runtime, currentURL, getter, report, trace, config, map, native } from '../core/context';
export function installStorage() {
  trace('storage','Native storage isolated and virtual names configured');
  const prefix = `rax:${new URL(currentURL()).origin}:`;
  const areas = new Map<Storage, Storage>();
  if (!config.worker) {
    for (const name of ['localStorage', 'sessionStorage'] as const) {
      try {
        const storage = window[name];
        const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter(k => k.startsWith(prefix));
        const methods: Record<string, unknown> = {
          getItem: (k: string) => storage.getItem(prefix + String(k)),
          setItem: (k: string, v: string) => storage.setItem(prefix + String(k), String(v)),
          removeItem: (k: string) => storage.removeItem(prefix + String(k)),
          clear: () => config.isolation ? storage.clear() : keys().forEach(k => storage.removeItem(k)),
          key: (i: number) => keys()[Number(i)]?.slice(prefix.length) ?? null,
        };
        const checked=(action:()=>any)=>{try{return action();}catch(error){report('storage','Native storage rejected an operation (quota or access restriction)');throw error;}};
        for(const key of Object.keys(methods)){const action=methods[key] as (...args:any[])=>unknown;methods[key]=(...args:any[])=>checked(()=>action(...args));}
        const virtual = new Proxy(Object.create(Storage.prototype), {
          get: (_t, k) => k === 'length' ? keys().length : k === Symbol.toStringTag ? 'Storage' : Object.hasOwn(methods, k) ? methods[k as string] : typeof k === 'string' ? storage.getItem(prefix + k) ?? undefined : undefined,
          set: (_t, k, v) => checked(()=>{ storage.setItem(prefix + String(k), String(v)); return true; }),
          deleteProperty: (_t, k) => checked(()=>{ storage.removeItem(prefix + String(k)); return true; }),
          ownKeys: () => keys().map(k => k.slice(prefix.length)),
          has: (_t, k) => Object.hasOwn(methods, k) || storage.getItem(prefix + String(k)) !== null,
          getOwnPropertyDescriptor: (_t, k) => storage.getItem(prefix + String(k)) === null ? undefined : { enumerable: true, configurable: true, value: storage.getItem(prefix + String(k)), writable: true },
        });
        getter(window, name, () => virtual);
        areas.set(storage,virtual);
      } catch { report('storage', `${name} is unavailable in this context`); }
    }
    window.addEventListener('storage', event => {
      if (event.key && !event.key.startsWith(prefix)) { event.stopImmediatePropagation(); return; }
      if (event.key) Object.defineProperty(event, 'key', { value: event.key.slice(prefix.length) });
      if (event.url) Object.defineProperty(event, 'url', { value: runtime.unmap(event.url) });
      if(event.storageArea && areas.has(event.storageArea))Object.defineProperty(event,'storageArea',{value:areas.get(event.storageArea)});
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
    const requestURL = (request: RequestInfo | URL) => request instanceof native.Request ? request : map(String(request), currentURL());
    for (const name of ['match', 'matchAll', 'delete', 'keys', 'add'] as const) {
      const original = Cache.prototype[name];
      (Cache.prototype as any)[name] = function(request?: RequestInfo | URL, ...args: any[]) { return Reflect.apply(original, this, [request === undefined ? undefined : requestURL(request), ...args]); };
    }
    const put = Cache.prototype.put; Cache.prototype.put = function(request, response) { return put.call(this, requestURL(request), response); };
    const addAll = Cache.prototype.addAll; Cache.prototype.addAll = function(requests) { return addAll.call(this, Array.from(requests, requestURL)); };
  }
  if (globalThis.BroadcastChannel) {
    const Channel = globalThis.BroadcastChannel;
    const name = Object.getOwnPropertyDescriptor(Channel.prototype, 'name');
    if (name?.get) getter(Channel.prototype, 'name', function(this: BroadcastChannel) { const value = name.get!.call(this); return value.startsWith(prefix) ? value.slice(prefix.length) : value; });
    globalThis.BroadcastChannel = new Proxy(Channel, { construct(Target, args) { return Reflect.construct(Target, [prefix + String(args[0])]); } });
  }
}
