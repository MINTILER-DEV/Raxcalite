import { native, currentURL, getter, report } from '../core/context';
export function installCookies() {
  // A synchronous cookie bridge preserves setter/read/network ordering. HttpOnly stays server-side.
  getter(Document.prototype, 'cookie', () => {
    const request = new native.XMLHttpRequest();
    native.xhrOpen.call(request, 'GET', `/api/cookie?url=${encodeURIComponent(currentURL())}`, false);
    try { native.xhrSend.call(request); return request.status === 200 ? request.responseText : ''; }
    catch { report('cookies', 'Cookie bridge failed'); return ''; }
  }, value => {
    const request = new native.XMLHttpRequest();
    native.xhrOpen.call(request, 'POST', '/api/cookie', false); request.setRequestHeader('content-type', 'application/json');
    try { native.xhrSend.call(request, JSON.stringify({ url: currentURL(), value: String(value) })); if (request.status >= 400) report('cookies', 'Script cookie was rejected'); }
    catch { report('cookies', 'Cookie write failed'); }
  });
}
