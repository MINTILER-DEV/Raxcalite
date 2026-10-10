import { map, report, config, currentURL, native, getter, unmap } from '../core/context';
export function installWorkers() {
  for (const name of ['Worker', 'SharedWorker'] as const) {
    const Constructor = globalThis[name];
    if (!Constructor) continue;
    globalThis[name] = new Proxy(Constructor, { construct(Target, args) {
      const source = map(args[0]);
      if (source.startsWith('blob:') || source.startsWith('data:')) { report('workers', 'Blob/data worker code cannot be safely transformed'); throw new DOMException('Use a URL-backed worker', 'NotSupportedError'); }
      const url = new URL(source); url.search += `${url.search ? '&' : '?'}__rax_worker=${args[1]?.type === 'module' ? 'module' : 'classic'}`;
      const options = name === 'SharedWorker' && typeof args[1] === 'string' ? { name: `${new URL(config.url).origin}:${args[1]}` } : { ...args[1] };
      if (name === 'SharedWorker') options.name = `${new URL(config.url).origin}:${options.name || ''}`;
      if (config.isolation && options.type === 'module') options.credentials = 'include';
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
    const container = navigator.serviceWorker; const register = container.register.bind(container);
    const getRegistration = container.getRegistration.bind(container);
    const own = (registration?: ServiceWorkerRegistration) => registration && new URL(unmap(registration.scope)).origin === new URL(currentURL()).origin;
    container.register = async (source, options = {}) => {
      if (!config.isolation || options.type === 'module') {
        report('workers', 'Upstream service workers require isolated origins and classic scripts');
        throw new DOMException('Use an isolated origin and a classic URL-backed service worker', 'NotSupportedError');
      }
      const url = new URL(String(source), currentURL());const scope = new URL(String(options.scope || '.'), url);
      if (url.origin !== new URL(currentURL()).origin || scope.origin !== url.origin || !['http:','https:'].includes(url.protocol)) throw new DOMException('Service workers require the current virtual origin', 'SecurityError');
      const mapped = new URL(map(url));mapped.search += `${mapped.search?'&':'?'}__rax_worker=service`;
      return register(mapped.href,{...options,scope:map(scope)});
    };
    container.getRegistration = async (url = currentURL()) => { const registration = await getRegistration(map(url));return own(registration)?registration:undefined; };
    container.getRegistrations = async () => (await native.workerRegistrations!()).filter(r=>own(r));
    for (const [prototype,key] of [[ServiceWorker.prototype,'scriptURL'],[ServiceWorkerRegistration.prototype,'scope']] as const) {
      const descriptor=Object.getOwnPropertyDescriptor(prototype,key);
      if(descriptor?.get)getter(prototype,key,function(this:any){const value=unmap(descriptor.get!.call(this));return value.replace(/([?&])__rax_worker=service(?:&|$)/,'$1').replace(/[?&]$/,'');});
    }
    const controller=Object.getOwnPropertyDescriptor(ServiceWorkerContainer.prototype,'controller');
    if(controller?.get)getter(container,'controller',()=>{const worker=controller.get!.call(container);return worker?.scriptURL===`${native.location.origin}/sw.js`?null:worker;});
    let ready:Promise<ServiceWorkerRegistration>|undefined;
    getter(container,'ready',()=>ready ||= new Promise(resolve=>{
      const timer=setInterval(async()=>{const registration=await container.getRegistration();if(registration?.active){clearInterval(timer);resolve(registration)}},100);
      addEventListener('pagehide',()=>clearInterval(timer),{once:true});
    }));
  }
}
