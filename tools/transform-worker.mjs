import { parentPort } from 'node:worker_threads';
import { rewrite } from './rewrite.mjs';
parentPort.on('message', input => {
  try { parentPort.postMessage({ result: rewrite(input) }); }
  catch { parentPort.postMessage({ error: 'Parser rejected the resource' }); }
});
