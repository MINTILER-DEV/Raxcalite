// Canonical contract: /p/<base64url UTF-8 origin>/<original path>?query#fragment.
import { nativeOrigin } from './native-origin.mjs';
let isolation;
export function configureMapping(value) { isolation = value; }
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
  const raw = String(input);
  const mapped = /^\/(p|ws)\/([^/]+)(?:\/|$)/.exec(raw);
  if (mapped) {
    try { const origin = decodeOrigin(mapped[2]); if (['http:', 'https:', 'ws:', 'wss:'].includes(new URL(origin).protocol)) return (isolation ? nativeOrigin(origin, isolation) : proxyOrigin) + raw; } catch { /* An upstream path can resemble a proxy route. */ }
  }
  const url = new URL(input, base);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return url.href;
  if (isolation && /^\/(p|ws)\//.test(url.pathname)) {
    try { const match = /^\/(?:p|ws)\/([^/]+)/.exec(url.pathname); if (nativeOrigin(decodeOrigin(match[1]), isolation) === url.origin) return url.href; } catch { /* Ordinary upstream path. */ }
  }
  if (proxyOrigin && url.origin === proxyOrigin && /^\/(p|ws)\//.test(url.pathname)) return url.href;
  const socket = url.protocol === 'ws:' || url.protocol === 'wss:';
  if (isolation) proxyOrigin = nativeOrigin(url.origin, isolation);
  return `${proxyOrigin}/${socket ? 'ws' : 'p'}/${encodeOrigin(url.origin)}${url.pathname}${url.search}${url.hash}`;
}
export function decodeURL(input, proxyOrigin) {
  const url = new URL(input, proxyOrigin);
  const match = /^\/(?:p|ws)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!match) return url.href;
  const query=url.search.slice(1).split('&').filter(p=>!['__rax_worker','__rax_origin','__rax_credentials'].includes(p.split('=')[0])).join('&');
  return `${decodeOrigin(match[1])}${match[2] || '/'}${query?'?'+query:''}${url.hash}`;
}
// Keep original resource credentials separate from gateway authentication.
export function resourceCredentials(mapped, mode) {
  if (!/^(?:https?:\/\/[^/]+)?\/p\//.test(mapped)) return mapped;
  const hash=mapped.indexOf('#'), head=hash<0?mapped:mapped.slice(0,hash), tail=hash<0?'':mapped.slice(hash);
  const question=head.indexOf('?'), path=question<0?head:head.slice(0,question);
  const query=(question<0?[]:head.slice(question+1).split('&')).filter(p=>p.split('=')[0]!=='__rax_credentials');
  query.push(`__rax_credentials=${mode}`);return `${path}?${query.join('&')}${tail}`;
}
