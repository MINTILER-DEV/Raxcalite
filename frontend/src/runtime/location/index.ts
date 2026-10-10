import { runtime, native, currentURL, map, getter, config, report } from '../core/context';
export function installLocation() {
  const location = new Proxy(Object.create(Location.prototype), {
    get(_target, key) {
      const url = new URL(currentURL());
      if (key === 'assign' || key === 'replace') return (value: string) => native.location[key](map(value));
      if (key === 'reload') return () => native.location.reload();
      if (key === 'toString' || key === Symbol.toPrimitive) return () => url.href;
      if (key === 'ancestorOrigins') { report('location', 'ancestorOrigins cannot reproduce native origin isolation'); return native.location.ancestorOrigins; }
      return Reflect.get(url, key);
    },
    set(_target, key, value) {
      const url = new URL(currentURL());
      if (key === 'href') native.location.assign(map(value));
      else { Reflect.set(url, key, value); native.location.assign(map(url.href)); }
      return true;
    }
  });
  getter(runtime, 'location', () => location, value => native.location.assign(map(value)));
  if (!config.worker) {
    getter(Document.prototype, 'URL', currentURL);
    getter(Document.prototype, 'documentURI', currentURL);
    getter(Document.prototype, 'baseURI', () => config.base === config.url ? currentURL() : config.base);
    const referrer = document.referrer;
    getter(Document.prototype, 'referrer', () => { try { return referrer ? runtime.unmap(referrer) : ''; } catch { return ''; } });
    getter(window, 'origin', () => new URL(currentURL()).origin);
  }
}
