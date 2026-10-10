import { performance } from 'node:perf_hooks';
import { rewrite } from '../tools/transformer.mjs';
import { writeFile } from 'node:fs/promises';
const sources = {
  html: `<title>Benchmark</title>${'<a href="/next">Next</a><img src="image.png"><style>a{background:url(a.png)}</style>'.repeat(250)}`,
  css: Array.from({length:250},(_,i)=>`.a${i}{background:url(image${i}.png);font-size:14px}`).join(''),
  js: Array.from({length:250},(_,i)=>`function f${i}(){return location.href}const a${i}=()=>import('./module${i}.js');`).join('\n')
};
const result = { node: process.version, platform: process.platform, date: new Date().toISOString(), measurements: {} };
for (const [kind, source] of Object.entries(sources)) {
  const input={kind,source,url:`https://example.com/assets/bench.${kind}`};
  for(let i=0;i<5;i++)rewrite(input);
  const timings=[];const before=process.memoryUsage().rss;
  for(let i=0;i<40;i++){const start=performance.now();rewrite(input);timings.push(performance.now()-start);}
  timings.sort((a,b)=>a-b);
  result.measurements[kind]={bytes:Buffer.byteLength(source),iterations:40,medianMs:Number(timings[20].toFixed(2)),p95Ms:Number(timings[38].toFixed(2)),rssDeltaMiB:Number(((process.memoryUsage().rss-before)/1048576).toFixed(2))};
}
console.log(JSON.stringify(result,null,2));
await writeFile('benchmarks/latest.json',JSON.stringify(result,null,2)+'\n');
