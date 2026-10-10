// Canonical contract: /p/<base64url UTF-8 origin>/<original path>?query#fragment.
export function encodeOrigin(origin) {
  const bytes = new TextEncoder().encode(origin);
  let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function decodeOrigin(token) {
  const raw = atob(token.replaceAll('-', '+').replaceAll('_', '/'));
  return new TextDecoder().decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
}
export function encodeURL(input, base, proxyOrigin = '') {
  const url = new URL(input, base);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return url.href;
  if (proxyOrigin && url.origin === proxyOrigin && /^\/(p|ws)\//.test(url.pathname)) return url.href;
  const socket = url.protocol === 'ws:' || url.protocol === 'wss:';
  return `${proxyOrigin}/${socket ? 'ws' : 'p'}/${encodeOrigin(url.origin)}${url.pathname}${url.search}${url.hash}`;
}
export function decodeURL(input, proxyOrigin) {
  const url = new URL(input, proxyOrigin);
  const match = /^\/(?:p|ws)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!match) return url.href;
  return `${decodeOrigin(match[1])}${match[2] || '/'}${url.search}${url.hash}`;
}
