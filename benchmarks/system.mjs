import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { startFixtures } from '../tests/fixtures/server.mjs';
import { startTransformer } from '../tools/transformer.mjs';
import { encodeURL } from '../shared/url.mjs';
const fixtures=startFixtures();const token=randomBytes(32).toString('hex');const transformer=startTransformer(3032,token);
const server=spawn(process.platform==='win32'?'target/debug/raxcalite.exe':'target/debug/raxcalite',[],{stdio:'inherit',windowsHide:true,env:{...process.env,RAX_TRANSFORM_TOKEN:token,RAX_FIXTURE_HOSTS:'localhost,127.0.0.1'}});
let browser;
try {
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch('http://localhost:3031/health')).ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  if(!ready)throw new Error('Build the Rust binary with cargo build before benchmarking');
  await import('./transport.mjs');
  browser=await chromium.launch();const page=await browser.newPage();const result={date:new Date().toISOString(),pages:{}};
  for(const [label,url] of [['direct','http://localhost:4040/next'],['proxied',encodeURL('http://localhost:4040/next','http://localhost:4040','http://localhost:3031')]]) {
    const start=performance.now();await page.goto(url);result.pages[label]={loadMs:Number((performance.now()-start).toFixed(2)),heapBytes:await page.evaluate(()=>performance.memory?.usedJSHeapSize||null)};
  }
  const response=await fetch(encodeURL('https://example.com/','https://example.com','http://localhost:3031'));
  const html=await response.text();result.publicWebsite={status:response.status,hasRuntime:html.includes('/runtime.js'),hasContent:html.includes('Example Domain')};
  console.log(JSON.stringify(result,null,2));await writeFile('benchmarks/browser-latest.json',JSON.stringify(result,null,2)+'\n');
} finally {if(browser)await browser.close();server.kill();fixtures.closeAllConnections();fixtures.close();transformer.closeAllConnections();transformer.close();}
