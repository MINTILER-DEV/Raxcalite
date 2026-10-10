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
  return new Proxy(target, { get(object, key) {
    if (key === 'headers') return headers;
    if (key === 'type') return type;
    if (opaque && ['status', 'statusText', 'url', 'ok', 'redirected'].includes(String(key))) return key === 'status' ? 0 : ['ok', 'redirected'].includes(String(key)) ? false : '';
    if (key === 'clone') return () => responseView(object.clone(), type, credentials);
    const value = Reflect.get(object, key, object); return typeof value === 'function' ? value.bind(object) : value;
  } });
}
