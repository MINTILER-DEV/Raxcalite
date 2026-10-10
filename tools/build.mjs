import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
await viteBuild({ root: 'frontend', build: { outDir: 'dist', emptyOutDir: true }, base: '/' });
const browserDefines = { 'process.env': '{}', 'process.platform': '"browser"' };
await build({ entryPoints: ['frontend/src/runtime/index.ts'], bundle: true, format: 'iife', target: 'es2022', define: browserDefines, outfile: 'frontend/dist/runtime.js', minify: true });
await build({ entryPoints: ['frontend/src/runtime/worker.ts'], bundle: true, format: 'iife', target: 'es2022', define: browserDefines, outfile: 'frontend/dist/worker-runtime.js', minify: true });
await build({ entryPoints: ['frontend/src/service-worker/index.ts'], bundle: true, format: 'iife', target: 'es2022', outfile: 'frontend/dist/sw.js' });
// Runtime configuration supports reverse proxies with independently hosted content origins.
if (process.env.RAX_PROXY_ORIGIN) {
  const { readFile } = await import('node:fs/promises'); const path = 'frontend/dist/index.html';
  const html = await readFile(path, 'utf8');
  await writeFile(path, html.replace('<head>', `<head><script>globalThis.__RAX_APP_CONFIG__=${JSON.stringify({ proxyOrigin: process.env.RAX_PROXY_ORIGIN }).replaceAll('<', '\\u003c')}</script>`));
}
