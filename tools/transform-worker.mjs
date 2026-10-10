import { rewrite } from './rewrite.mjs';
process.on('message', input => {
  try { process.send({ result: rewrite(input), rss:process.memoryUsage().rss }); }
  catch { process.send({ error: 'Parser rejected the resource' }); }
});
