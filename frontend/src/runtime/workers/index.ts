import { map, report, config } from '../core/context';
export function installWorkers() {
  for (const name of ['Worker', 'SharedWorker'] as const) {
    const Constructor = globalThis[name];
    if (!Constructor) continue;
    globalThis[name] = new Proxy(Constructor, { construct(Target, args) {
      const source = map(args[0]);
      if (source.startsWith('blob:') || source.startsWith('data:')) { report('workers', 'Blob/data worker code cannot be safely transformed'); throw new DOMException('Use a URL-backed worker', 'NotSupportedError'); }
      const url = new URL(source); url.searchParams.set('__rax_worker', args[1]?.type === 'module' ? 'module' : 'classic');
      const options = name === 'SharedWorker' && typeof args[1] === 'string' ? { name: `${new URL(config.url).origin}:${args[1]}` } : { ...args[1] };
      if (name === 'SharedWorker') options.name = `${new URL(config.url).origin}:${options.name || ''}`;
      const worker = Reflect.construct(Target, [url.href, options]);
      worker.addEventListener('error', (event: ErrorEvent) => report('workers', event.message || 'Worker initialization failed'));
      return worker;
    } }) as any;
  }
  if (config.worker && 'importScripts' in globalThis) {
    const importScripts = globalThis.importScripts.bind(globalThis);
    globalThis.importScripts = (...urls: (string | URL)[]) => importScripts(...urls.map(url => map(url)));
  }
  if (!config.worker && navigator.serviceWorker) {
    navigator.serviceWorker.register = async () => {
      report('workers', 'Upstream service worker registration is unsupported');
      throw new DOMException('Upstream service workers cannot own proxy application scope', 'NotSupportedError');
    };
  }
}
