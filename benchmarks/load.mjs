import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {readFile,writeFile} from 'node:fs/promises';
import {startFixtures} from '../tests/fixtures/server.mjs';
import {startTransformer} from '../tools/transformer.mjs';
import {encodeURL} from '../shared/url.mjs';
const run=promisify(execFile),token=randomBytes(32).toString('hex'),origin='http://localhost:3081';
const fixtures=startFixtures(4080),transformer=startTransformer(3082,token);
const env={...process.env,RAX_APP_PORT:'3080',RAX_PROXY_PORT:'3081',RAX_TRANSFORM_PORT:'3082',RAX_APP_ORIGIN:'http://localhost:3080',RAX_PROXY_ORIGIN:origin,RAX_TRANSFORM_TOKEN:token,RAX_FIXTURE_HOSTS:'localhost'};delete env.RAX_ISOLATION_DOMAIN;
const server=spawn(process.platform==='win32'?'target/debug/raxcalite.exe':'target/debug/raxcalite',[],{stdio:'inherit',windowsHide:true,env});
const result={date:new Date().toISOString(),platform:process.platform,node:process.version,build:'Rust debug',paceMsPerWorker:1000,memory:{rustPeakSampledBytes:0,nodeParentPeakSampledBytes:0,parserTaskEndMaxBytes:0,samples:0},measurements:[]};
let sampling=true,sampler;
const metric=()=>fetch('http://localhost:3082/metrics',{headers:{authorization:`Bearer ${token}`}}).then(r=>r.json());
try{
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(origin+'/ready')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw new Error('Build Rust first');
  const bootstrap=await fetch(origin+'/api/session',{headers:{origin:'http://localhost:3080'}});const cookie=bootstrap.headers.get('set-cookie').split(';')[0];
  sampler=(async()=>{while(sampling){try{
    let rust=0;if(process.platform==='win32'){const {stdout}=await run('powershell',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${server.pid}).WorkingSet64`],{windowsHide:true});rust=Number(stdout.trim());}else if(process.platform==='linux'){rust=Number(/VmRSS:\s+(\d+)/.exec(await readFile(`/proc/${server.pid}/status`,'utf8'))?.[1]||0)*1024;}
    const stats=await metric();result.memory.rustPeakSampledBytes=Math.max(result.memory.rustPeakSampledBytes,rust);result.memory.nodeParentPeakSampledBytes=Math.max(result.memory.nodeParentPeakSampledBytes,process.memoryUsage().rss);result.memory.parserTaskEndMaxBytes=Math.max(result.memory.parserTaskEndMaxBytes,stats.parserRss);result.memory.samples++;
  }catch{}await new Promise(r=>setTimeout(r,100));}})();
  for(const [label,concurrency,count] of [['cold-unique',8,160],['cached',16,160]]){
    let next=0;const timings=[],statuses={};const start=performance.now();
    await Promise.all(Array.from({length:concurrency},async()=>{while(next<count){const i=next++;const started=performance.now();const response=await fetch(encodeURL(`http://localhost:4080/next?sample=${label==='cached'?0:i}`,'http://localhost:4080',origin),{headers:{cookie}});await response.text();statuses[response.status]=(statuses[response.status]||0)+1;timings.push(performance.now()-started);await new Promise(r=>setTimeout(r,result.paceMsPerWorker));}}));
    timings.sort((a,b)=>a-b);result.measurements.push({label,concurrency,requests:count,statuses,elapsedMs:Number((performance.now()-start).toFixed(2)),medianMs:Number(timings[Math.floor(count/2)].toFixed(2)),p95Ms:Number(timings[Math.floor(count*.95)].toFixed(2))});
  }
  result.transformer=await metric();result.backend=await(await fetch(origin+'/metrics',{headers:{authorization:`Bearer ${token}`}})).json();sampling=false;await sampler;
  console.log(JSON.stringify(result,null,2));await writeFile('benchmarks/load-latest.json',JSON.stringify(result,null,2)+'\n');
}finally{sampling=false;await sampler;server.kill();fixtures.closeAllConnections();fixtures.close();transformer.closeAllConnections();transformer.close();}
