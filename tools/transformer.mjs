import http from 'node:http';
import { createHash } from 'node:crypto';
import { rewriteHTML } from './rewriting/html.mjs';
import { rewriteCSS } from './rewriting/css.mjs';
import { rewriteJS } from './rewriting/javascript.mjs';
const cache = new Map(); let cacheBytes = 0;
export function rewrite({ kind, source, url, debug, sourceMaps, worker }) {
  if (kind === 'html') return rewriteHTML(source, url, { debug, sourceMaps });
  if (kind === 'css') return { code: rewriteCSS(source, url), warnings: [] };
  const result = rewriteJS(source, url, { sourceMaps });
  let code = result.code;
  if (sourceMaps && result.map) code += `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(result.map)).toString('base64')}`;
  if (worker) {
    const config = JSON.stringify({ url, base: url, worker: true }).replaceAll('<', '\\u003c');
    code = worker === 'module' ? `import '/worker-runtime.js';globalThis.__rax.initialize(${config});\n${code}` : `globalThis.__RAX_CONFIG__=${config};importScripts('/worker-runtime.js');\n${code}`;
  }
  return { code, warnings: [] };
}
export function startTransformer(port = 3032, token = process.env.RAX_TRANSFORM_TOKEN) {
  if (!token) throw new Error('RAX_TRANSFORM_TOKEN is required');
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403).end(); return; }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 12 * 1024 * 1024) throw new Error('Transform input limit exceeded'); chunks.push(chunk); }
      const input = Buffer.concat(chunks).toString();
      const key = createHash('sha256').update(input).digest('hex');
      let result = cache.get(key);
      if (!result) {
        result = JSON.stringify(rewrite(JSON.parse(input)));
        while (cacheBytes + result.length > 32 * 1024 * 1024 && cache.size) { const [k, v] = cache.entries().next().value; cache.delete(k); cacheBytes -= v.length; }
        if (result.length <= 32 * 1024 * 1024) { cache.set(key, result); cacheBytes += result.length; }
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(result);
    } catch (error) {
      res.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `Transformation failed: ${error.message.slice(0, 160)}` }));
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`Raxcalite transformer: 127.0.0.1:${port}`));
  return server;
}
if (process.argv[1]?.endsWith('transformer.mjs')) startTransformer(Number(process.env.RAX_TRANSFORM_PORT || 3032));
