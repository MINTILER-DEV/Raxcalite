import { native, map, currentURL, unmap, getter, report, config } from '../core/context';
import { responseView, filteredHeaders } from './responses';
export function installNetwork() {
  globalThis.Request = new Proxy(native.Request, { construct(Target, args) {
    return Reflect.construct(Target, [args[0] instanceof native.Request ? args[0] : map(args[0]), ...args.slice(1)]);
  } });
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const original = new native.Request(input instanceof native.Request ? input : new URL(String(input), currentURL()), init);
    if (['blob:', 'data:'].includes(new URL(original.url).protocol)) return native.fetch(original);
    const headers = new Headers(original.headers);
    headers.set('x-rax-origin', new URL(currentURL()).origin);
    headers.set('x-rax-credentials', original.credentials);
    headers.set('x-rax-mode', original.mode);
    if(headers.has('authorization')) { headers.set('x-rax-authorization',headers.get('authorization')!);headers.set('x-rax-auth-origin',new URL(original.url).origin);headers.delete('authorization'); }
    // Reconstructing a Request from its .body stream forces HTTP/2 streaming uploads in Chromium.
    // Buffer bounded uploads so normal form/text bodies work through an HTTP/1 local proxy too.
    let body: Uint8Array<ArrayBuffer> | undefined;
    if (original.body) {
      const reader = original.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      const cancel = () => { void reader.cancel(original.signal.reason); }; original.signal.addEventListener('abort', cancel, { once: true });
      try {
        while (true) {
          original.signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength; if (size > 64 * 1024 * 1024) { await reader.cancel(); throw new TypeError('Request body exceeds 64 MiB'); } chunks.push(value);
        }
        original.signal.throwIfAborted(); body = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      } finally { original.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
    } else if (!['GET','HEAD'].includes(original.method)) {
      // Firefox exposes null for Request.body while its body readers still work.
      body = new Uint8Array(await original.arrayBuffer());
      if (body.byteLength > 64 * 1024 * 1024) throw new TypeError('Request body exceeds 64 MiB');
    }
    const mapped = new native.Request(map(original.url), { method: original.method, headers, body,
      credentials: 'include', mode: config.isolation ? 'cors' : 'same-origin', signal: original.signal, redirect: original.redirect,
      cache: original.cache, keepalive: original.keepalive, referrerPolicy: original.referrerPolicy });
    try {
      const response = await native.fetch(mapped);
      if (response.headers.get('x-rax-cors-error')) throw new TypeError('Upstream CORS policy rejected the virtual origin');
      if (response.type === 'opaqueredirect') return response;
      const cross = new URL(response.url).origin !== new URL(currentURL()).origin;
      return responseView(response, cross ? original.mode === 'no-cors' ? 'opaque' : 'cors' : 'basic', original.credentials === 'include');
    }
    catch (error) { report('network', 'Fetch failed'); throw error; }
  };
  for (const prototype of [Response.prototype, native.Request.prototype]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'url');
    if (descriptor?.get) getter(prototype, 'url', function(this: Request | Response) { return unmap(descriptor.get!.call(this)); });
  }
  if (native.XMLHttpRequest) {
    const targets = new WeakMap<XMLHttpRequest,string>();
    const set = native.XMLHttpRequest.prototype.setRequestHeader;
    native.XMLHttpRequest.prototype.setRequestHeader = function(name,value) { if(name.toLowerCase()==='authorization') {set.call(this,'x-rax-auth-origin',new URL(targets.get(this)!).origin);set.call(this,'x-rax-authorization',value);} else set.call(this,name,value); };
    const open = native.XMLHttpRequest.prototype.open as (this: XMLHttpRequest, method: string, url: string, async: boolean, username?: string | null, password?: string | null) => void;
    native.XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null) {
      targets.set(this,new URL(String(url),currentURL()).href);
      open.call(this, method, map(url), async, username, password);
      this.setRequestHeader('x-rax-origin', new URL(currentURL()).origin);
      this.setRequestHeader('x-rax-mode', 'cors');
    };
    const send = native.XMLHttpRequest.prototype.send as (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;
    native.XMLHttpRequest.prototype.send = function(body) {
      this.setRequestHeader('x-rax-credentials', this.withCredentials ? 'include' : 'same-origin'); send.call(this, body);
    };
    const responseURL = Object.getOwnPropertyDescriptor(native.XMLHttpRequest.prototype, 'responseURL');
    if (responseURL?.get) getter(native.XMLHttpRequest.prototype, 'responseURL', function(this: XMLHttpRequest) { return unmap(responseURL.get!.call(this)); });
    const all = native.XMLHttpRequest.prototype.getAllResponseHeaders;
    const headers = (xhr:XMLHttpRequest) => {
      const source=new Headers();for(const line of all.call(xhr).trim().split(/\r?\n/)){const colon=line.indexOf(':');if(colon>0)source.append(line.slice(0,colon),line.slice(colon+1).trim());}
      const url=xhr.responseURL || targets.get(xhr) || currentURL();return filteredHeaders(source,new URL(url).origin!==new URL(currentURL()).origin,xhr.withCredentials);
    };
    native.XMLHttpRequest.prototype.getResponseHeader=function(name){return headers(this).get(name)};
    native.XMLHttpRequest.prototype.getAllResponseHeaders=function(){return [...headers(this)].map(([name,value])=>`${name}: ${value}\r\n`).join('')};
  }
  const Socket = globalThis.WebSocket;
  const socketURLs=new WeakMap<WebSocket,string>();
  const socketURL=Object.getOwnPropertyDescriptor(Socket.prototype,'url');if(socketURL?.get)getter(Socket.prototype,'url',function(this:WebSocket){return socketURLs.get(this)||unmap(socketURL.get!.call(this))});
  globalThis.WebSocket = new Proxy(Socket, { construct(Target, args) {
    const url = new URL(String(args[0]), currentURL());
    if (url.protocol === 'http:') url.protocol = 'ws:'; if (url.protocol === 'https:') url.protocol = 'wss:';
    const translated = new URL(map(url)); translated.protocol = native.location.protocol === 'https:' ? 'wss:' : 'ws:';
    translated.search += `${translated.search ? '&' : '?'}__rax_origin=${encodeURIComponent(new URL(currentURL()).origin)}`;
    const socket=Reflect.construct(Target, [translated.href, ...args.slice(1)]);socketURLs.set(socket,url.href);return socket;
  } });
  if (globalThis.EventSource) { const Source=globalThis.EventSource;const urls=new WeakMap<EventSource,string>();const descriptor=Object.getOwnPropertyDescriptor(Source.prototype,'url');if(descriptor?.get)getter(Source.prototype,'url',function(this:EventSource){return urls.get(this)||unmap(descriptor.get!.call(this))});
    globalThis.EventSource=new Proxy(Source,{construct(Target,args){const translated=new URL(map(args[0]));translated.search+=`${translated.search?'&':'?'}__rax_origin=${encodeURIComponent(new URL(currentURL()).origin)}&__rax_credentials=${args[1]?.withCredentials?'include':'same-origin'}`;const source=Reflect.construct(Target,[translated.href,{...args[1],withCredentials:true}]);urls.set(source,new URL(String(args[0]),currentURL()).href);return source;}});
  }
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const beacon = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = (url, data) => beacon(map(url), data);
  }
}
