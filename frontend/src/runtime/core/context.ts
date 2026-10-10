import { encodeURL, decodeURL, configureMapping } from '../../../../shared/url.mjs';
export interface RuntimeConfig { url: string; base: string; worker?: boolean; debug?: boolean; warnings?: string[]; appOrigin?: string; isolation?: { domain: string; user: string; proxyOrigin: string } }
export interface Diagnostic { subsystem: string; message: string; time: number }
export const root = globalThis as typeof globalThis & { __RAX_CONFIG__?: RuntimeConfig; __rax: any };
export const runtime: any = {};
Object.defineProperty(root,'__RAX_RUNTIME_v1__',{value:runtime});
root.__rax=runtime;
declare global { var __rax: any; }
export const native = {
  fetch: globalThis.fetch.bind(globalThis),
  Request: globalThis.Request,
  location: globalThis.location,
  XMLHttpRequest: globalThis.XMLHttpRequest,
  xhrOpen: globalThis.XMLHttpRequest?.prototype.open,
  xhrSend: globalThis.XMLHttpRequest?.prototype.send,
  workerRegistrations: typeof navigator !== 'undefined' ? navigator.serviceWorker?.getRegistrations.bind(navigator.serviceWorker) : undefined,
  cacheKeys: globalThis.caches?.keys.bind(globalThis.caches),
  cacheDelete: globalThis.caches?.delete.bind(globalThis.caches),
  postMessage: (typeof window !== 'undefined' ? window.postMessage : undefined) as ((this: Window, message: any, targetOrigin: string, transfer?: Transferable[]) => void) | undefined,
};
export let config: RuntimeConfig;
export function setConfig(value: RuntimeConfig) { config = value; configureMapping(value.isolation); }
export function currentURL(): string {
  if (config.worker) return config.url;
  return decodeURL(native.location.href, native.location.origin);
}
export function baseURL(): string { return config.base === config.url ? currentURL() : config.base; }
export function map(input: string | URL, base = baseURL()): string { return encodeURL(String(input), base, native.location.origin); }
export function unmap(input: string): string { return input ? decodeURL(input, native.location.origin) : input; }
export function report(subsystem: string, message: string) {
  const entry: Diagnostic = { subsystem, message, time: Date.now() };
  if (config.debug) console.debug('[Raxcalite]', subsystem, message);
  if (!config.worker && parent !== window) native.postMessage!.call(parent, { type: 'rax:diagnostic', entry }, '*');
}
export function getter(object: object, key: string, get: () => unknown, set?: (value: any) => void) {
  try { const old = Object.getOwnPropertyDescriptor(object, key); Object.defineProperty(object, key, { configurable: old?.configurable ?? true, enumerable: old?.enumerable ?? true, get, set }); }
  catch { report('runtime', `Cannot virtualize ${key}`); }
}
