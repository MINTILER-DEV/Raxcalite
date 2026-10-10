import { currentURL, map, unmap, report, native, config } from '../core/context';
export function installNavigation() {
  const historyMethods:Partial<Record<'pushState'|'replaceState',History['pushState']>>={};
  for (const key of ['pushState', 'replaceState'] as const) {
    const original = History.prototype[key];
    History.prototype[key] = function(data: any, unused: string, url?: string | URL | null) {
      if (url != null) {
        const target = new URL(unmap(new URL(String(url), currentURL()).href));
        if (target.origin !== new URL(currentURL()).origin) throw new DOMException('Virtual history requires the same origin', 'SecurityError');
        original.call(this,data, unused, map(target));
      } else original.call(this,data, unused, url);
      notify(key === 'pushState' ? 'push' : 'replace');
    };
    historyMethods[key]=History.prototype[key];
  }
  // Same-origin blank frames expose a fresh History prototype. Sites may borrow
  // those native methods and bind them to this document's History instance.
  const prepared=new WeakSet<object>();
  const contentWindow=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'contentWindow');
  const prepare=(frame:HTMLIFrameElement)=>{
    const child=contentWindow?.get?.call(frame) as Window|null;
    try {
      if(!child || child.location.href!=='about:blank')return child;
      const prototype=Object.getPrototypeOf(child.history);
      if(prepared.has(prototype))return child;
      prepared.add(prototype);
      for(const key of ['pushState','replaceState'] as const){
        const descriptor=Object.getOwnPropertyDescriptor(prototype,key);
        if(!descriptor || typeof descriptor.value!=='function')continue;
        const original=descriptor.value;
        Object.defineProperty(prototype,key,{...descriptor,value:function(this:History,...args:any[]){
          return Reflect.apply(this===window.history?historyMethods[key]!:original,this,args);
        }});
      }
    }catch{/* Foreign frame access remains subject to native origin checks. */}
    return child;
  };
  if(contentWindow?.get)Object.defineProperty(HTMLIFrameElement.prototype,'contentWindow',{...contentWindow,get(){return prepare(this);}});
  const contentDocument=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'contentDocument');
  if(contentDocument?.get)Object.defineProperty(HTMLIFrameElement.prototype,'contentDocument',{...contentDocument,get(){prepare(this);return contentDocument.get!.call(this);}});
  const originalOpen = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => originalOpen(url ? map(url) : url, target, features);
  const notify = (action = 'update') => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href;
    // Only the shell's direct document updates its address/title. A nested frame's
    // parent is another virtual site and does not have the shell's native origin.
    if (parent !== window && parent === top) native.postMessage!.call(parent, { type: 'rax:navigation', action, url: currentURL(), title: document.title, icon }, config.appOrigin || '*');
  };
  addEventListener('popstate', () => notify('traverse')); addEventListener('hashchange', () => notify('update')); addEventListener('DOMContentLoaded', () => notify('load'));
  addEventListener('pageshow', event => { if ((event as PageTransitionEvent).persisted) notify('traverse'); });
  new MutationObserver(() => notify()).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes:true, attributeFilter:['href','rel'] });
  addEventListener('message', async event => {
    if (event.source !== parent || event.origin !== config.appOrigin || event.data?.type !== 'rax:command') return;
    event.stopImmediatePropagation();
    if (event.data.command === 'history' && [-1,1].includes(event.data.delta)) {
      history.go(event.data.delta);
    } else if (event.data.command === 'reload') native.location.reload();
    else if (event.data.command === 'recover') {
      for (const registration of await native.workerRegistrations!()) if ((registration.active || registration.waiting || registration.installing)?.scriptURL === `${native.location.origin}/sw.js`) await registration.unregister();
      for (const key of await native.cacheKeys!()) if (key.startsWith('rax-shell-') || key.startsWith('rax-content-')) await native.cacheDelete!(key);
      native.postMessage!.call(parent,{type:'rax:recovered'},config.appOrigin!);
    }
  }, true);
  addEventListener('error', e => report('javascript', e.message || 'Resource failed to load'));
  addEventListener('unhandledrejection', () => report('javascript', 'Unhandled promise rejection'));
  window.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l' && parent !== window) {
      event.preventDefault(); native.postMessage!.call(parent, { type: 'rax:focus-address' }, '*');
    }
  });
}
