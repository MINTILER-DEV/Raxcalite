import http from 'node:http';
import { createHash } from 'node:crypto';
import { TransformPool } from './transform-pool.mjs';
export { rewrite } from './rewrite.mjs';
export function startTransformer(port = 3032, token = process.env.RAX_TRANSFORM_TOKEN) {
  if (!token) throw new Error('RAX_TRANSFORM_TOKEN is required');
  const pool = new TransformPool();
  const cache = new Map(); let cacheBytes = 0;
  const stats = { requests: 0, hits: 0, failures: 0 };
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403).end(); return; }
    if (req.url === '/health' && req.method === 'GET') { res.writeHead(pool.closed ? 503 : 200).end('ready'); return; }
    if (req.url === '/metrics' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...stats, cacheBytes, cacheEntries: cache.size, active: pool.active, queued: pool.queue.length, rss: process.memoryUsage().rss, parserRss:[...pool.slots].reduce((sum,slot)=>sum+(slot.rss||0),0) })); return;
    }
    if (req.method !== 'POST' || req.url !== '/') { res.writeHead(404).end(); return; }
    stats.requests++;
    const controller = new AbortController(); res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 24 * 1024 * 1024) throw new Error('Transform input limit exceeded'); chunks.push(chunk); }
      const input = Buffer.concat(chunks).toString(); const parsed = JSON.parse(input);
      if (!['html', 'css', 'js'].includes(parsed.kind) || typeof parsed.source !== 'string' || typeof parsed.url !== 'string') throw new Error('Invalid transform contract');
      const cacheable = parsed.cache !== false; const key = createHash('sha256').update(input).digest('hex');
      let result = cacheable ? cache.get(key) : undefined;
      if (result) stats.hits++;
      else {
        result = JSON.stringify(await pool.run(parsed, controller.signal));
        const bytes = Buffer.byteLength(result);
        while (cacheBytes + bytes > 32 * 1024 * 1024 && cache.size) { const [k, v] = cache.entries().next().value; cache.delete(k); cacheBytes -= Buffer.byteLength(v); }
        if (cacheable && bytes <= 32 * 1024 * 1024) { cache.set(key, result); cacheBytes += bytes; }
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(result);
    } catch {
      stats.failures++;
      if (!res.destroyed) res.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Transformation failed or exceeded resource limits' }));
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.on('close', () => pool.close());
  server.listen(port, '127.0.0.1', () => console.log(`Raxcalite transformer: 127.0.0.1:${port}`));
  return server;
}
if (process.argv[1]?.endsWith('transformer.mjs')) startTransformer(Number(process.env.RAX_TRANSFORM_PORT || 3032));
