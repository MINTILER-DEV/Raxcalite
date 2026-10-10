export function immutableHeaders(source: Headers): Headers {
  return new Proxy(source, { get(target, key) {
    if (['append', 'set', 'delete'].includes(String(key))) return () => { throw new TypeError('Response headers are immutable'); };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
export function filteredHeaders(source: Headers, cors: boolean, credentials: boolean): Headers {
  const exposed = (source.get('x-rax-exposed-headers') || '').toLowerCase().split(',').map(v => v.trim());
  const safelist = ['cache-control', 'content-language', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma'];
  const headers = new Headers();
  source.forEach((value, key) => {
    if (key.startsWith('x-rax-') || key === 'set-cookie' || key === 'set-cookie2') return;
    if (!cors || safelist.includes(key) || exposed.includes(key) || (!credentials && exposed.includes('*'))) headers.append(key, value);
  }); return immutableHeaders(headers);
}
export function responseView(response: Response, type: ResponseType, credentials: boolean): Response {
  const opaque = type === 'opaque';
  if (opaque) void response.body?.cancel();
  const target = opaque ? new Response(null) : response;
  const headers = opaque ? immutableHeaders(new Headers()) : filteredHeaders(response.headers, type === 'cors', credentials);
  // Keep the actual Response brand for native consumers (Cache.put/respondWith).
  const clone = target.clone.bind(target);
  Object.defineProperties(target, { headers:{value:headers,configurable:true}, type:{value:type,configurable:true}, clone:{value:()=>responseView(clone(),type,credentials),configurable:true} });
  if (opaque) for (const key of ['status','statusText','url','ok','redirected']) Object.defineProperty(target,key,{value:key==='status'?0:['ok','redirected'].includes(key)?false:'',configurable:true});
  return target;
}
