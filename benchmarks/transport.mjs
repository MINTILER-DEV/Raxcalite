import { performance } from 'node:perf_hooks';
import { encodeURL } from '../shared/url.mjs';
import { writeFile } from 'node:fs/promises';
const origin=process.env.RAX_BENCH_ORIGIN||'http://localhost:3031';
const fixture=process.env.RAX_BENCH_FIXTURE||'http://localhost:4040';
const result={date:new Date().toISOString(),measurements:{}};
for(const size of [1,16]){
 const start=performance.now();const responses=await Promise.all(Array.from({length:size},async()=>{
  const response=await fetch(encodeURL(`${fixture}/large`,fixture,origin));if(!response.ok)throw new Error(`HTTP ${response.status}`);
  let bytes=0;for await(const chunk of response.body)bytes+=chunk.length;return bytes;
 }));
 const ms=performance.now()-start;
 result.measurements[`downloads-${size}`]={bytes:responses.reduce((a,b)=>a+b,0),elapsedMs:Number(ms.toFixed(2)),MiBPerSecond:Number((responses.reduce((a,b)=>a+b,0)/1048576/(ms/1000)).toFixed(2))};
}
for(const label of ['cold','cached-transform']){
const start=performance.now();const response=await fetch(encodeURL(`${fixture}/`,fixture,origin));await response.text();
result.measurements[label]={status:response.status,elapsedMs:Number((performance.now()-start).toFixed(2))};
}
console.log(JSON.stringify(result,null,2));await writeFile('benchmarks/transport-latest.json',JSON.stringify(result,null,2)+'\n');
