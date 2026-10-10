import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {startTransformer} from '../tools/transformer.mjs';
import {encodeURL} from '../shared/url.mjs';
const sites=['https://example.com/','https://en.wikipedia.org/wiki/Web_browser','https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API','https://news.ycombinator.com/','https://www.rust-lang.org/'];
const token=randomBytes(32).toString('hex'),origin='http://rax.localhost:3071';
const transformer=startTransformer(3072,token);
const env={...process.env,RAX_APP_PORT:'3070',RAX_PROXY_PORT:'3071',RAX_TRANSFORM_PORT:'3072',RAX_APP_ORIGIN:'http://app.rax.localhost:3070',RAX_PROXY_ORIGIN:origin,RAX_ISOLATION_DOMAIN:'rax.localhost',RAX_TRANSFORM_TOKEN:token};delete env.RAX_FIXTURE_HOSTS;
const server=spawn(process.platform==='win32'?'target/debug/raxcalite.exe':'target/debug/raxcalite',[],{stdio:'inherit',windowsHide:true,env});let browser;
const result={date:new Date().toISOString(),node:process.version,platform:process.platform,scope:'Unauthenticated Chromium page rendering only; this does not validate complete website journeys.',sites:[]};
try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch('http://localhost:3071/ready')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw new Error('Build Rust first with cargo build');
  browser=await chromium.launch();
  for(const url of sites){
    const record={url};
    for(const mode of ['direct','proxied']){
      const context=await browser.newContext(),page=await context.newPage();const errors=[],failed=[],httpErrors=[],resourceWarnings=[];let requests=0;
      page.on('pageerror',e=>{if(errors.length<10)errors.push(e.message.slice(0,180));});page.on('request',()=>requests++);page.on('response',r=>{const warnings=r.headers()['x-rax-rewrite-warnings'];if(warnings && resourceWarnings.length<10)resourceWarnings.push({url:r.url().split('?')[0],count:Number(warnings)});if(r.status()>=400 && httpErrors.length<10)httpErrors.push({url:r.url().split('?')[0],status:r.status()});});page.on('requestfailed',r=>{if(failed.length<10)failed.push({url:r.url().split('?')[0],error:r.failure()?.errorText});});
      const started=performance.now();try{const response=await page.goto(mode==='direct'?url:encodeURL(url,url,origin),{waitUntil:'domcontentloaded',timeout:20000});await page.waitForTimeout(2000);record[mode]={status:response?.status(),title:await page.title(),bodyChars:await page.locator('body').innerText().then(t=>t.length),loadMs:Number((performance.now()-started).toFixed(2)),requests,errors,failed,httpErrors,resourceWarnings,warnings:await page.evaluate(()=>globalThis.__RAX_CONFIG__?.warnings||[])};}catch(e){record[mode]={error:e.message.split('\n')[0],requests,errors,failed};}finally{await context.close();}
    }
    if(record.direct.error||record.direct.status>=400){record.classification='unsupported';record.reason='Direct control failed in this environment; comparison is inconclusive.';}
    else if(record.proxied.status===403){record.classification='security-restricted';record.reason='Proxy destination or upstream policy rejected the request.';}
    else if(record.proxied.error||record.proxied.status>=400||record.proxied.title!==record.direct.title||record.proxied.errors.length||record.proxied.failed.length||record.proxied.httpErrors.length||record.proxied.warnings.length||record.proxied.resourceWarnings.length){record.classification='partially compatible';record.reason='Rendering, title, script or resource differences are recorded; inspect them before claiming journey compatibility.';}
    else{record.classification='correct';record.reason='Title and successful document status match within this limited render smoke check.';}
    result.sites.push(record);console.log(`${url}: ${record.classification}`);
  }
  await writeFile('benchmarks/cohort-latest.json',JSON.stringify(result,null,2)+'\n');
}finally{await browser?.close();server.kill();transformer.closeAllConnections();transformer.close();}
