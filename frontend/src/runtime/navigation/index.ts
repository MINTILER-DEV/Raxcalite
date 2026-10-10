import { currentURL, map, report, native } from '../core/context';
export function installNavigation() {
  for (const key of ['pushState', 'replaceState'] as const) {
    const original = history[key].bind(history);
    history[key] = (data: any, unused: string, url?: string | URL | null) => {
      if (url != null) {
        const target = new URL(String(url), currentURL());
        if (target.origin !== new URL(currentURL()).origin) throw new DOMException('Virtual history requires the same origin', 'SecurityError');
        original(data, unused, map(target));
      } else original(data, unused, url);
      notify();
    };
  }
  const originalOpen = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => originalOpen(url ? map(url) : url, target, features);
  const notify = () => {
    if (parent !== window) native.postMessage!.call(parent, { type: 'rax:navigation', url: currentURL(), title: document.title }, '*');
  };
  addEventListener('popstate', notify); addEventListener('hashchange', notify); addEventListener('DOMContentLoaded', notify);
  new MutationObserver(notify).observe(document.querySelector('title') || document.documentElement, { childList: true, subtree: true, characterData: true });
  addEventListener('error', e => report('javascript', e.message || 'Resource failed to load'));
  addEventListener('unhandledrejection', () => report('javascript', 'Unhandled promise rejection'));
}
