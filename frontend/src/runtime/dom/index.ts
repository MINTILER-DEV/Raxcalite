import { runtime, map, unmap, baseURL, report } from '../core/context';
import { rewriteStyle, installCSS } from './css';
import parseSrcset from 'parse-srcset';
const urls = new Set(['href', 'src', 'action', 'formaction', 'poster', 'data', 'background', 'xlink:href']);
export function installDOM() {
  installCSS();
  const srcset = (value: string) => parseSrcset(value).map(s => `${map(s.url)}${s.w ? ` ${s.w}w` : s.d ? ` ${s.d}x` : ''}`).join(', ');
  const setAttribute = Element.prototype.setAttribute;
  const getAttribute = Element.prototype.getAttribute;
  const authored = new WeakMap<Element, Record<string, string>>();
  const originals = (element: Element) => {
    let values = authored.get(element);
    if (!values) { try { values = JSON.parse(getAttribute.call(element, 'data-rax-authored') || '{}'); } catch { values = {}; } authored.set(element, values!); }
    return values!;
  };
  Element.prototype.setAttribute = function(name, value) {
    originals(this)[name.toLowerCase()] = String(value);
    if (urls.has(name.toLowerCase()) && value && !value.startsWith('#')) { try { value = map(value); } catch { report('dom', 'Invalid dynamic resource URL'); } }
    else if (['srcset', 'imagesrcset'].includes(name.toLowerCase())) value = srcset(value);
    else if (name.toLowerCase() === 'style') value = rewriteStyle(value, 'declarationList');
    setAttribute.call(this, name, value);
  };
  Element.prototype.getAttribute = function(name) {
    const value = getAttribute.call(this, name);
    if (value !== null && Object.hasOwn(originals(this), name.toLowerCase())) return originals(this)[name.toLowerCase()];
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
      set(value) { originals(this)[key.toLowerCase()] = String(value); descriptor.set!.call(this, value ? map(value) : value); }
    });
  }
  const fixTree = (node: Node) => {
    if (node instanceof DocumentFragment) { for (const child of node.children) fixTree(child); return; }
    if (!(node instanceof Element)) return;
    for (const element of [node, ...node.querySelectorAll('*')]) for (const name of urls) {
      const value = getAttribute.call(element, name);
      if (value && !value.startsWith('#')) { try { const mapped = map(value); if (mapped !== value) { if (!Object.hasOwn(originals(element), name)) originals(element)[name] = value; setAttribute.call(element, name, mapped); } } catch { report('dom', 'Failed to map an inserted resource'); } }
    }
    for (const element of [node, ...node.querySelectorAll('*')]) {
      for (const name of ['srcset', 'imagesrcset']) { const value = getAttribute.call(element, name); if (value) setAttribute.call(element, name, srcset(value)); }
      const style = getAttribute.call(element, 'style'); if (style) setAttribute.call(element, 'style', rewriteStyle(style, 'declarationList'));
      if (element instanceof HTMLStyleElement && element.textContent) { const rewritten = rewriteStyle(element.textContent); if (rewritten !== element.textContent) element.textContent = rewritten; }
      if (Object.keys(originals(element)).length) setAttribute.call(element, 'data-rax-authored', JSON.stringify(originals(element)));
    }
  };
  for (const Constructor of [HTMLImageElement, HTMLSourceElement]) {
    const descriptor = Object.getOwnPropertyDescriptor(Constructor.prototype, 'srcset')!;
    Object.defineProperty(Constructor.prototype, 'srcset', { ...descriptor, set(value) { descriptor.set!.call(this, srcset(String(value))); } });
  }
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
  // Intercept insertion before the browser starts resource loading. The observer
  // below remains a fallback for native parsing and APIs without patchable hooks.
  for (const key of ['appendChild', 'insertBefore', 'replaceChild'] as const) {
    const original = Node.prototype[key];
    (Node.prototype as any)[key] = function(node: Node, ...args: any[]) { fixTree(node); return Reflect.apply(original, this, [node, ...args]); };
  }
  for (const prototype of [Element.prototype, Document.prototype, DocumentFragment.prototype]) {
    for (const key of ['append', 'prepend', 'replaceChildren'] as const) {
      const original = prototype[key];
      (prototype as any)[key] = function(...nodes: (Node | string)[]) { for (const node of nodes) if (node instanceof Node) fixTree(node); return Reflect.apply(original, this, nodes); };
    }
  }
  for (const key of ['write', 'writeln'] as const) {
    const original = document[key].bind(document);
    document[key] = (...values: string[]) => {
      const template = document.createElement('template'); template.innerHTML = values.join('');
      for (const script of template.content.querySelectorAll('script:not([src])')) if (!script.getAttribute('type') || script.getAttribute('type') === 'module') script.textContent = runtime.rewriteScript(script.textContent);
      original(template.innerHTML);
    };
  }
  if (typeof SVGAnimatedString !== 'undefined') {
    const references = new WeakSet<SVGAnimatedString>();
    for (const Constructor of [SVGImageElement, SVGUseElement, SVGAElement, SVGScriptElement, SVGFEImageElement]) {
      const href = Object.getOwnPropertyDescriptor(Constructor.prototype, 'href');
      if (href?.get) Object.defineProperty(Constructor.prototype, 'href', { ...href, get() { const value = href.get!.call(this); references.add(value); return value; } });
    }
    const descriptor = Object.getOwnPropertyDescriptor(SVGAnimatedString.prototype, 'baseVal');
    if (descriptor?.set && descriptor.get) Object.defineProperty(SVGAnimatedString.prototype, 'baseVal', { ...descriptor,
      get() { const value = descriptor.get!.call(this); return references.has(this) ? unmap(value) : value; }, set(value) { descriptor.set!.call(this, references.has(this) ? map(value) : value); } });
  }
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) fixTree(node);
  }).observe(document.documentElement, { childList: true, subtree: true });
  // Dynamic style and srcset strings need parsing; server rewrites authored CSS and srcset.
  runtime.base = baseURL;
}
