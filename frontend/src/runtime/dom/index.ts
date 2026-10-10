import { map, unmap, baseURL, report } from '../core/context';
const urls = new Set(['href', 'src', 'action', 'formaction', 'poster', 'data', 'background', 'xlink:href']);
export function installDOM() {
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (urls.has(name.toLowerCase()) && value && !value.startsWith('#')) { try { value = map(value); } catch { report('dom', 'Invalid dynamic resource URL'); } }
    setAttribute.call(this, name, value);
  };
  const getAttribute = Element.prototype.getAttribute;
  Element.prototype.getAttribute = function(name) {
    const value = getAttribute.call(this, name);
    if (value && urls.has(name.toLowerCase()) && value.startsWith('/p/')) return unmap(value);
    return value;
  };
  const pairs: [any, string[]][] = [
    [HTMLAnchorElement, ['href']], [HTMLAreaElement, ['href']], [HTMLImageElement, ['src']],
    [HTMLScriptElement, ['src']], [HTMLLinkElement, ['href']], [HTMLIFrameElement, ['src']],
    [HTMLFormElement, ['action']], [HTMLInputElement, ['src', 'formAction']], [HTMLButtonElement, ['formAction']],
    [HTMLMediaElement, ['src']], [HTMLSourceElement, ['src']], [HTMLVideoElement, ['poster']], [HTMLObjectElement, ['data']],
  ];
  for (const [Constructor, keys] of pairs) for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(Constructor.prototype, key);
    if (!descriptor?.get || !descriptor.set) continue;
    Object.defineProperty(Constructor.prototype, key, { ...descriptor,
      get() { return unmap(descriptor.get!.call(this)); },
      set(value) { descriptor.set!.call(this, value ? map(value) : value); }
    });
  }
  const fixTree = (node: Node) => {
    if (!(node instanceof Element)) return;
    for (const element of [node, ...node.querySelectorAll('*')]) for (const name of urls) {
      const value = getAttribute.call(element, name);
      if (value && !value.startsWith('#')) { try { setAttribute.call(element, name, map(value)); } catch { report('dom', 'Failed to map an inserted resource'); } }
    }
  };
  for (const key of ['innerHTML', 'outerHTML'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, key)!;
    Object.defineProperty(Element.prototype, key, { ...descriptor, set(value: string) {
      const template = document.createElement('template'); descriptor.set!.call(template, value);
      for (const child of template.content.children) fixTree(child);
      descriptor.set!.call(this, descriptor.get!.call(template));
    } });
  }
  const insert = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function(position, text) {
    const template = document.createElement('template'); template.innerHTML = text; insert.call(this, position, template.innerHTML);
  };
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) fixTree(node);
  }).observe(document.documentElement, { childList: true, subtree: true });
  // Dynamic style and srcset strings need parsing; server rewrites authored CSS and srcset.
  globalThis.__rax.base = baseURL;
}
