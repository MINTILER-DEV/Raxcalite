import { parse, serialize, parseFragment } from 'parse5';
import parseSrcset from 'parse-srcset';
import { encodeURL } from '../../shared/url.mjs';
import { rewriteCSS } from './css.mjs';
import { rewriteJS } from './javascript.mjs';

export function rewriteHTML(source, url, options = {}) {
  const document = parse(source);
  const warnings = [];
  let base = url;
  const visit = (node, fn) => { fn(node); for (const child of node.childNodes || []) visit(child, fn); if (node.content) visit(node.content, fn); };
  let foundBase = false;
  visit(document, node => {
    if (!foundBase && node.tagName === 'base') {
      const href = node.attrs.find(a => a.name === 'href');
      if (href) { base = new URL(href.value, url).href; foundBase = true; }
    }
  });
  const safe = (fn, subsystem) => { try { return fn(); } catch (error) { warnings.push(`${subsystem}: ${error.message.slice(0, 160)}`); return null; } };
  visit(document, node => {
    if (!node.tagName) return;
    for (const attr of node.attrs) {
      if (['href', 'src', 'action', 'formaction', 'poster', 'data', 'xlink:href', 'background', 'cite'].includes(attr.name) && attr.value && !attr.value.startsWith('#')) {
        attr.value = safe(() => encodeURL(attr.value, base), 'url') ?? attr.value;
      } else if (attr.name === 'srcset' || attr.name === 'imagesrcset') {
        attr.value = safe(() => parseSrcset(attr.value).map(s => `${encodeURL(s.url, base)}${s.w ? ` ${s.w}w` : s.d ? ` ${s.d}x` : ''}`).join(', '), 'srcset') ?? attr.value;
      } else if (attr.name === 'style') attr.value = safe(() => rewriteCSS(attr.value, base, true), 'css') ?? attr.value;
      else if (attr.name.startsWith('on')) attr.value = safe(() => rewriteJS(attr.value, base, { inlineHandler: true }).code, 'javascript') ?? attr.value;
    }
    // Transformed bytes cannot retain upstream integrity hashes.
    node.attrs = node.attrs.filter(a => !['integrity', 'nonce'].includes(a.name));
    if (node.tagName === 'meta') {
      const equiv = node.attrs.find(a => a.name === 'http-equiv')?.value.toLowerCase();
      const content = node.attrs.find(a => a.name === 'content');
      if (equiv === 'content-security-policy') node.attrs = [];
      if (equiv === 'refresh' && content) {
        const semi = content.value.indexOf(';');
        if (semi >= 0) {
          const target = content.value.slice(semi + 1).trim();
          if (target.slice(0, 4).toLowerCase() === 'url=') content.value = `${content.value.slice(0, semi)};url=${encodeURL(target.slice(4).replace(/^['"]|['"]$/g, ''), base)}`;
        }
      }
    }
    if (node.tagName === 'style') for (const child of node.childNodes || []) if (child.nodeName === '#text') child.value = safe(() => rewriteCSS(child.value, base), 'css') ?? child.value;
    if (node.tagName === 'iframe') {
      const srcdoc = node.attrs.find(a => a.name === 'srcdoc');
      if (srcdoc) srcdoc.value = rewriteHTML(srcdoc.value, base, options).code;
    }
    if (node.tagName === 'script' && !node.attrs.some(a => a.name === 'src')) {
      const type = node.attrs.find(a => a.name === 'type')?.value || '';
      if (!type || ['module', 'text/javascript', 'application/javascript'].includes(type)) {
        for (const child of node.childNodes || []) if (child.nodeName === '#text') child.value = safe(() => rewriteJS(child.value, base, options).code, 'javascript') ?? child.value;
      } else if (type === 'importmap') {
        for (const child of node.childNodes || []) if (child.nodeName === '#text') {
          const mapped = safe(() => {
            const data = JSON.parse(child.value);
            const entries = values => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' ? encodeURL(v, base) : v]));
            if (data.imports) data.imports = entries(data.imports);
            if (data.scopes) data.scopes = Object.fromEntries(Object.entries(data.scopes).map(([k, v]) => [encodeURL(k, base), entries(v)]));
            return JSON.stringify(data);
          }, 'importmap');
          if (mapped) child.value = mapped;
        }
      }
    }
  });
  let head;
  visit(document, node => { if (node.tagName === 'head') head = node; });
  const config = JSON.stringify({ url, base, debug: !!options.debug, warnings }).replaceAll('<', '\\u003c');
  const bootstrap = parseFragment(`<script>globalThis.__RAX_CONFIG__=${config}</script><script src="/runtime.js"></script>`).childNodes;
  for (const child of bootstrap) child.parentNode = head;
  head.childNodes.unshift(...bootstrap);
  return { code: serialize(document), warnings };
}
