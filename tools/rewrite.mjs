import { rewriteHTML } from './rewriting/html.mjs';
import { rewriteCSS } from './rewriting/css.mjs';
import { rewriteJS } from './rewriting/javascript.mjs';
import { encodeURL } from '../shared/url.mjs';
export function rewrite({ kind, source, url, debug, sourceMaps, worker }) {
  if (kind === 'html') return rewriteHTML(source, url, { debug, sourceMaps });
  if (kind === 'css') return { code: rewriteCSS(source, url), warnings: [] };
  const result = rewriteJS(source, url, { sourceMaps });
  let code = result.code;
  if (sourceMaps && result.map) code += `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(result.map)).toString('base64')}`;
  if (worker) {
    const config = JSON.stringify({ url, base: url, worker: true }).replaceAll('<', '\\u003c');
    if (worker === 'module') {
      const entry = new URL(url); entry.search += `${entry.search ? '&' : '?'}__rax_worker=body`;
      // Initialize before evaluating static dependencies; those modules may immediately use browser APIs.
      code = `import '/worker-runtime.js';globalThis.__rax.initialize(${config});await import(${JSON.stringify(encodeURL(entry.href, url))});`;
    } else code = `globalThis.__RAX_CONFIG__=${config};importScripts('/worker-runtime.js');\n${code}`;
  }
  return { code, warnings: [] };
}
