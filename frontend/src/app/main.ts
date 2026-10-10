import './style.css';
import { encodeURL, decodeURL } from '../../../shared/url.mjs';
const app = document.querySelector<HTMLDivElement>('#app')!;
const configured = (globalThis as any).__RAX_APP_CONFIG__;
const proxyOrigin = configured?.proxyOrigin || `${location.protocol}//${location.hostname}:${Number(location.port || 3030) + 1}`;
const icons: Record<string, string> = {
  back: '<path d="m10 4-6 4 6 4M4 8h10"/>', forward: '<path d="m6 4 6 4-6 4M2 8h10"/>',
  reload: '<path d="M13 6a5 5 0 1 0 0 5M13 2v4H9"/>', plus: '<path d="M8 3v10M3 8h10"/>',
  settings: '<circle cx="8" cy="8" r="2.5"/><path d="m6 2 1-.8h2l1 .8 2 .5 1 1.7-.5 2v2l.5 2-1 1.7-2 .5-1 .8H7l-1-.8-2-.5-1-1.7.5-2v-2l-.5-2 1-1.7z"/>',
  hide: '<path d="m4 10 4-4 4 4"/>', diagnostics: '<path d="M2 12h12M4 9V5m4 4V2m4 7V6"/>', go: '<path d="M3 8h10m-4-4 4 4-4 4"/>',
};
const svg = (name: string) => `<svg viewBox="0 0 16 16" aria-hidden="true">${icons[name]}</svg>`;
const tool = (id: string, label: string, optional = false) => `<button class="tool${optional ? ' optional' : ''}" id="${id}" aria-label="${label}" title="${label}">${svg(id)}</button>`;
app.innerHTML = `<header class="chrome"><div class="tabs"><img class="brand" src="/icon.svg" alt="Raxcalite"><div id="tab-list" style="display:contents"></div><button class="new-tab" id="new-tab" aria-label="New tab" title="New tab">${svg('plus')}</button><span class="spacer"></span></div><nav class="toolbar" aria-label="Browser navigation">${tool('back','Back')}${tool('forward','Forward')}${tool('reload','Reload')}<form class="address" id="address-form"><span class="indicator" title="Connection status"></span><input id="address" aria-label="Address" placeholder="Search or enter address" autocomplete="off" spellcheck="false"><button type="submit" aria-label="Go">↵</button></form>${tool('diagnostics','Compatibility diagnostics',true)}${tool('settings','Settings')}${tool('hide','Collapse toolbar (Ctrl+Shift+B)')}</nav></header><button class="reveal" id="reveal" title="Show toolbar (Ctrl+L)"><img src="/icon.svg" alt="">Show controls</button><main class="viewport" id="viewport"><section class="home" id="home"><img src="/icon.svg" alt=""><h1>Raxcalite</h1><p>A little less browser. A lot more web.</p><form id="home-form"><input id="home-address" aria-label="Start browsing" placeholder="Search or enter address" autocomplete="off" spellcheck="false"><button type="submit" aria-label="Open address">${svg('go')}</button></form><kbd>Ctrl + L to go somewhere</kbd></section></main><section class="panel" id="settings-panel" aria-label="Settings" hidden><header>Settings<button data-close="settings-panel" aria-label="Close settings">×</button></header><label>Hide controls after navigation<input type="checkbox" id="auto-hide"></label><label>Appearance<select id="theme"><option value="dark">Dark</option><option value="light">Light</option></select></label><button class="action" id="clear-cookies">Clear website cookies</button><button class="action" id="recover">Reset application worker</button><p>Controls: Ctrl+L · Collapse: Ctrl+Shift+B<br>Virtual origins provide compatibility; they share a content origin.</p></section><section class="panel" id="diagnostics-panel" aria-label="Compatibility diagnostics" hidden><header>Compatibility<button data-close="diagnostics-panel" aria-label="Close diagnostics">×</button></header><div id="diagnostic-list"><p>No reported errors in this tab.</p></div></section><div class="status" id="status" role="status" hidden></div>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
interface Tab { id: number; url: string; title: string; history: string[]; index: number; frame: HTMLIFrameElement; loading: boolean; diagnostics: { subsystem: string; message: string }[]; navigating?: boolean }
const tabs: Tab[] = []; let selected = 0; let nextId = 0;
const prefs = JSON.parse(localStorage.getItem('rax:preferences') || '{}');
function active() { return tabs.find(t => t.id === selected)!; }
function status(message: string) { el('status').textContent = message; el('status').hidden = false; setTimeout(() => el('status').hidden = true, 4500); }
function collapse(value: boolean) { app.classList.toggle('collapsed', value); }
function focusAddress() { collapse(false); el<HTMLInputElement>('address').focus(); el<HTMLInputElement>('address').select(); }
function savePrefs() { localStorage.setItem('rax:preferences', JSON.stringify(prefs)); }
function normalize(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).href;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^localhost:\d/i.test(trimmed)) throw new Error('Enter an HTTP or HTTPS address');
  if (!trimmed.includes(' ') && (trimmed.includes('.') || /^localhost(?::\d+)?(?:\/|$)/.test(trimmed))) return new URL(`https://${trimmed}`).href;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
function renderDiagnostics() {
  const list = el('diagnostic-list'); list.replaceChildren();
  if (!active().diagnostics.length) { const p = document.createElement('p'); p.textContent = 'No reported errors in this tab.'; list.append(p); }
  for (const entry of active().diagnostics.slice(-40).reverse()) { const row = document.createElement('div'); row.className = 'diagnostic'; const name = document.createElement('b'); name.textContent = `${entry.subsystem}: `; row.append(name, document.createTextNode(entry.message)); list.append(row); }
}
function render() {
  const list = el('tab-list'); list.replaceChildren();
  for (const tab of tabs) {
    const wrapper = document.createElement('div'); wrapper.className = `tab ${tab.id === selected ? 'active' : ''}`;
    const button = document.createElement('button'); button.setAttribute('aria-label', `Switch to ${tab.title}`); button.setAttribute('aria-current', String(tab.id === selected));
    const icon = document.createElement('img'); icon.src = '/icon.svg'; icon.alt = ''; const title = document.createElement('span'); title.textContent = tab.title;
    button.append(icon, title); button.onclick = () => { selected = tab.id; render(); };
    const close = document.createElement('button'); close.textContent = '×'; close.className = 'close'; close.setAttribute('aria-label', `Close ${tab.title}`); close.onclick = () => closeTab(tab.id);
    wrapper.append(button, close); list.append(wrapper); tab.frame.hidden = tab.id !== selected || !tab.url;
  }
  const tab = active(); el('home').hidden = !!tab.url; el('home').style.display = tab.url ? 'none' : 'grid';
  if (document.activeElement !== el('address')) el<HTMLInputElement>('address').value = tab.url;
  el('address-form').classList.toggle('loading', tab.loading);
  el<HTMLButtonElement>('back').disabled = tab.index <= 0; el<HTMLButtonElement>('forward').disabled = tab.index >= tab.history.length - 1;
  el<HTMLButtonElement>('reload').disabled = !tab.url;
  document.title = tab.url ? `${tab.title} · Raxcalite` : 'Raxcalite'; renderDiagnostics();
}
function newTab() {
  if (tabs.length >= 12) { status('Close a tab before opening another.'); return; }
  const frame = document.createElement('iframe'); frame.title = 'Website'; frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-downloads allow-modals'); frame.referrerPolicy = 'same-origin';
  const tab: Tab = { id: ++nextId, url: '', title: 'New tab', history: [], index: -1, frame, loading: false, diagnostics: [] };
  frame.onload = () => { tab.loading = false; render(); if (prefs.autoHide && tab.url) collapse(true); };
  tabs.push(tab); selected = tab.id; el('viewport').append(frame); render();
}
function closeTab(id: number) { const index = tabs.findIndex(t => t.id === id); tabs[index].frame.remove(); tabs.splice(index, 1); if (!tabs.length) newTab(); else { if (selected === id) selected = tabs[Math.min(index, tabs.length - 1)].id; render(); } }
function navigate(value: string, record = true) {
  try {
    const url = normalize(value); const tab = active();
    tab.url = url; tab.title = new URL(url).hostname; tab.loading = true; tab.diagnostics = []; tab.navigating = true;
    if (record) { tab.history.splice(tab.index + 1); tab.history.push(url); tab.index = tab.history.length - 1; }
    tab.frame.src = encodeURL(url, url, proxyOrigin); el<HTMLInputElement>('address').value = url; el<HTMLInputElement>('address').blur(); render();
  } catch (error) { status((error as Error).message); }
}
el('address-form').onsubmit = event => { event.preventDefault(); navigate(el<HTMLInputElement>('address').value); };
el('home-form').onsubmit = event => { event.preventDefault(); navigate(el<HTMLInputElement>('home-address').value); };
el('new-tab').onclick = newTab; el('hide').onclick = () => collapse(true); el('reveal').onclick = () => collapse(false);
el('back').onclick = () => { const tab = active(); if (tab.index > 0) { tab.index--; navigate(tab.history[tab.index], false); } };
el('forward').onclick = () => { const tab = active(); if (tab.index < tab.history.length - 1) { tab.index++; navigate(tab.history[tab.index], false); } };
el('reload').onclick = () => { if (active().url) navigate(active().url, false); };
for (const name of ['settings', 'diagnostics']) el(name).onclick = () => { const panel = el(`${name}-panel`); const hidden = panel.hidden; el('settings-panel').hidden = true; el('diagnostics-panel').hidden = true; panel.hidden = !hidden; };
for (const close of document.querySelectorAll<HTMLElement>('[data-close]')) close.onclick = () => el(close.dataset.close!).hidden = true;
el<HTMLInputElement>('auto-hide').checked = !!prefs.autoHide;
el('auto-hide').onchange = () => { prefs.autoHide = el<HTMLInputElement>('auto-hide').checked; savePrefs(); };
el<HTMLSelectElement>('theme').value = prefs.theme || 'dark'; document.documentElement.classList.toggle('light', prefs.theme === 'light');
el('theme').onchange = () => { prefs.theme = el<HTMLSelectElement>('theme').value; document.documentElement.classList.toggle('light', prefs.theme === 'light'); savePrefs(); };
el('clear-cookies').onclick = async () => { try { const response = await fetch(`${proxyOrigin}/api/session/reset`, { method: 'POST', credentials: 'include' }); if (!response.ok) throw new Error(); status('Website cookies cleared.'); } catch { status('Could not clear cookies.'); } };
el('recover').onclick = async () => { for (const worker of await navigator.serviceWorker.getRegistrations()) await worker.unregister(); for (const cache of await caches.keys()) if (cache.startsWith('rax-shell-')) await caches.delete(cache); status('Application worker reset. Reload to reinstall.'); };
addEventListener('message', event => {
  if (event.origin !== proxyOrigin) return;
  const tab = tabs.find(t => t.frame.contentWindow === event.source); if (!tab) return;
  if (event.data?.type === 'rax:navigation') {
    try {
      const url = new URL(event.data.url); if (!['https:', 'http:'].includes(url.protocol)) return;
      if (tab.url !== url.href) { if (tab.navigating) tab.history[tab.index] = url.href; else { tab.history.splice(tab.index + 1); tab.history.push(url.href); tab.index++; } }
      tab.url = url.href; tab.title = String(event.data.title || url.hostname).slice(0, 120); tab.navigating = false; tab.loading = false; render();
    } catch { /* Ignore invalid messages from documents. */ }
  } else if (event.data?.type === 'rax:diagnostic') {
    const entry = event.data.entry; if (typeof entry?.subsystem === 'string' && typeof entry?.message === 'string') { tab.diagnostics.push({ subsystem: entry.subsystem.slice(0, 40), message: entry.message.slice(0, 250) }); tab.diagnostics = tab.diagnostics.slice(-100); if (selected === tab.id) renderDiagnostics(); }
  } else if (event.data?.type === 'rax:focus-address') focusAddress();
});
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); focusAddress(); }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); collapse(!app.classList.contains('collapsed')); }
  if (event.key === 'Escape') { el('settings-panel').hidden = true; el('diagnostics-panel').hidden = true; }
});
newTab();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => status('Offline shell is unavailable. Browsing still works.'));
