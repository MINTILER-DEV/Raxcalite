import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
await viteBuild({ root: 'frontend', build: { outDir: 'dist', emptyOutDir: true }, base: '/' });
const browserDefines = { 'process.env': '{}', 'process.platform': '"browser"' };
await build({ entryPoints: ['frontend/src/runtime/index.ts'], bundle: true, format: 'iife', target: 'es2022', define: browserDefines, outfile: 'frontend/dist/runtime.js', minify: true });
await build({ entryPoints: ['frontend/src/runtime/worker.ts'], bundle: true, format: 'iife', target: 'es2022', define: browserDefines, outfile: 'frontend/dist/worker-runtime.js', minify: true });
await build({ entryPoints: ['frontend/src/service-worker/index.ts'], bundle: true, format: 'iife', target: 'es2022', outfile: 'frontend/dist/sw.js' });
