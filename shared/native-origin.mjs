import { sha256 } from '@noble/hashes/sha2.js';
export function siteHash(origin) {
  const url = new URL(origin); if (url.protocol === 'ws:') url.protocol = 'http:'; if (url.protocol === 'wss:') url.protocol = 'https:';
  return Array.from(sha256(new TextEncoder().encode(url.origin)).subarray(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}
export function nativeOrigin(origin, isolation) {
  const url = new URL(isolation.proxyOrigin); url.hostname = `${isolation.user}-${siteHash(origin)}.${isolation.domain}`;
  return url.origin;
}
