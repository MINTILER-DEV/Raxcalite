import { native, map, currentURL, unmap, getter, report } from '../core/context';
export function installNetwork() {
  globalThis.Request = new Proxy(native.Request, { construct(Target, args) {
    return Reflect.construct(Target, [args[0] instanceof native.Request ? args[0] : map(args[0]), ...args.slice(1)]);
  } });
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const original = new native.Request(input instanceof native.Request ? input : new URL(String(input), currentURL()), init);
    const headers = new Headers(original.headers);
    headers.set('x-rax-origin', new URL(currentURL()).origin);
    headers.set('x-rax-credentials', original.credentials);
    headers.set('x-rax-mode', original.mode);
    const mapped = new native.Request(map(original.url), original);
    try { return await native.fetch(new native.Request(mapped, { headers, credentials: 'include', mode: 'same-origin' })); }
    catch (error) { report('network', 'Fetch failed'); throw error; }
  };
  for (const prototype of [Response.prototype, native.Request.prototype]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'url');
    if (descriptor?.get) getter(prototype, 'url', function(this: Request | Response) { return unmap(descriptor.get!.call(this)); });
  }
  if (native.XMLHttpRequest) {
    const open = native.XMLHttpRequest.prototype.open as (this: XMLHttpRequest, method: string, url: string, async: boolean, username?: string | null, password?: string | null) => void;
    native.XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null) {
      open.call(this, method, map(url), async, username, password);
      this.setRequestHeader('x-rax-origin', new URL(currentURL()).origin);
      this.setRequestHeader('x-rax-mode', 'cors');
    };
    const send = native.XMLHttpRequest.prototype.send;
    native.XMLHttpRequest.prototype.send = function(body) {
      this.setRequestHeader('x-rax-credentials', this.withCredentials ? 'include' : 'same-origin'); send.call(this, body);
    };
    const responseURL = Object.getOwnPropertyDescriptor(native.XMLHttpRequest.prototype, 'responseURL');
    if (responseURL?.get) getter(native.XMLHttpRequest.prototype, 'responseURL', function(this: XMLHttpRequest) { return unmap(responseURL.get!.call(this)); });
  }
  const Socket = globalThis.WebSocket;
  globalThis.WebSocket = new Proxy(Socket, { construct(Target, args) {
    const url = new URL(String(args[0]), currentURL());
    if (url.protocol === 'http:') url.protocol = 'ws:'; if (url.protocol === 'https:') url.protocol = 'wss:';
    const translated = new URL(map(url)); translated.protocol = native.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return Reflect.construct(Target, [translated.href, ...args.slice(1)]);
  } });
  if (globalThis.EventSource) { const Source = globalThis.EventSource; globalThis.EventSource = new Proxy(Source, { construct(Target, args) { return Reflect.construct(Target, [map(args[0]), ...args.slice(1)]); } }); }
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const beacon = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (url, data) => beacon(map(url), data);
  }
}
