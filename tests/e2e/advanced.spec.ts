import {test,expect} from '@playwright/test';
import {encodeURL} from '../../shared/url.mjs';
const proxy=(url:string)=>encodeURL(url,url,'http://localhost:3031');
test('CORS preflights preserve wildcard restrictions and safelisted methods',async({page,browser})=>{
  const compare=async(target:typeof page)=>target.evaluate(async()=>{
    const request=(variant:string,init:RequestInit)=>fetch('http://127.0.0.1:4040/cors-policy?variant='+variant+'&case='+encodeURIComponent(JSON.stringify(init)),init).then(r=>r.text(),e=>e.name);
    return [await request('named',{headers:{'x-fixture':'test'},credentials:'include'}),await request('wildcard',{method:'PATCH',headers:{'x-fixture':'test'},credentials:'omit'}),await request('wildcard',{method:'PATCH',headers:{'x-fixture':'test'},credentials:'include'}),await request('wildcard',{headers:{authorization:'Bearer fixture'},credentials:'omit'})];
  });
  const context=await browser.newContext();const direct=await context.newPage();await direct.goto('http://localhost:4040/next');const reference=await compare(direct);
  await page.goto(proxy('http://localhost:4040/next'));const proxied=await compare(page);expect(proxied.slice(0,3)).toEqual(reference.slice(0,3));expect(proxied).toEqual(['cors-value','cors-value','TypeError','TypeError']);test.info().annotations.push({type:'native Authorization wildcard behavior',description:reference[3]});await context.close();
});
test('explicit Authorization survives CORS but is stripped across redirect origins; XHR headers are filtered',async({page})=>{
  await page.goto(proxy('http://localhost:4040/next'));
  const result=await page.evaluate(async()=>{
    const direct=await(await fetch('http://127.0.0.1:4040/api/echo?cors=yes',{headers:{authorization:'Bearer fixture'}})).json();
    const redirected=await(await fetch('/cross-redirect',{headers:{authorization:'Bearer fixture'}})).json();
    const manual=await fetch('/redirect',{redirect:'manual'});const error=await fetch('/redirect',{redirect:'error'}).then(()=>'',e=>e.name);
    const xhr=await new Promise(resolve=>{const x=new XMLHttpRequest();x.open('GET','http://127.0.0.1:4040/api/echo?cors=yes');x.setRequestHeader('authorization','Bearer xhr');x.responseType='json';x.onload=()=>resolve({visible:x.getResponseHeader('x-visible'),hidden:x.getResponseHeader('x-hidden'),authorization:x.response.authorization});x.send()});
    return {direct:direct.authorization,redirected:redirected.authorization,manual:{type:manual.type,status:manual.status},error,xhr};
  });
  expect(result).toEqual({direct:'Bearer fixture',redirected:'',manual:{type:'opaqueredirect',status:0},error:'TypeError',xhr:{visible:'public',hidden:null,authorization:'Bearer xhr'}});
});
test('SharedWorker, BroadcastChannel, storage events and transferable MessageChannel buffers',async({page,context})=>{
  await page.goto(proxy('http://localhost:4040/next'));const other=await context.newPage();await other.goto(proxy('http://localhost:4040/next'));
  await other.evaluate(()=>{addEventListener('storage',e=>(window as any).storageResult={key:e.key,newValue:e.newValue,url:e.url,area:e.storageArea===localStorage});const channel=new BroadcastChannel('fixture');channel.onmessage=e=>(window as any).broadcastResult={data:e.data,name:channel.name};(window as any).channel=channel;});
  const result=await page.evaluate(async()=>{
    const worker=new SharedWorker('/shared-worker.js','fixture');worker.port.start();const shared=await new Promise(resolve=>{worker.port.onmessage=e=>{resolve(e.data);worker.port.close()};worker.port.postMessage('start');});
    const transfer=await new Promise(resolve=>{const channel=new MessageChannel();const buffer=new Uint8Array([1,2,255]).buffer;channel.port1.onmessage=e=>{resolve({bytes:[...new Uint8Array(e.data)],detached:buffer.byteLength});channel.port1.close();channel.port2.close()};channel.port2.postMessage(buffer,[buffer])});
    localStorage.setItem('event-key','event-value');const channel=new BroadcastChannel('fixture');channel.postMessage('broadcast');channel.close();return {shared,transfer};
  });
  expect(result).toEqual({shared:{url:'http://localhost:4040/shared-worker.js',name:'shared'},transfer:{bytes:[1,2,255],detached:0}});
  await expect.poll(()=>other.evaluate(()=>(window as any).storageResult)).toMatchObject({key:'event-key',newValue:'event-value',url:'http://localhost:4040/next',area:true});
  await expect.poll(()=>other.evaluate(()=>(window as any).broadcastResult)).toEqual({data:'broadcast',name:'fixture'});
});
test('binary WebSockets, close codes, SSE reconnect, downloads, media and response limits',async({page,request})=>{
  await page.goto(proxy('http://localhost:4040/next'));
  const result=await page.evaluate(async()=>{
    const socket=await new Promise(resolve=>{const ws=new WebSocket('ws://localhost:4040/socket','echo');ws.binaryType='arraybuffer';let bytes:number[]=[];ws.onopen=()=>ws.send(new Uint8Array([0,1,255]));ws.onmessage=e=>{bytes=[...new Uint8Array(e.data)];ws.send('close-me')};ws.onclose=e=>resolve({bytes,code:e.code,reason:e.reason,url:ws.url});});
    const sse=await new Promise(resolve=>{const source=new EventSource('/reconnect');const ids:string[]=[];source.onmessage=e=>{ids.push(e.lastEventId);if(ids.length===2){source.close();resolve({ids,url:source.url})}};});
    const audio=document.createElement('audio');audio.src='/audio.wav';document.body.append(audio);const media=await new Promise(resolve=>{audio.onloadedmetadata=()=>resolve({duration:audio.duration,type:audio.canPlayType('audio/wav')});audio.onerror=()=>resolve({error:audio.error?.code})});
    return {socket,sse,media};
  });
  expect(result.socket).toEqual({bytes:[0,1,255],code:4001,reason:'fixture-close',url:'ws://localhost:4040/socket'});expect(result.sse).toEqual({ids:['1','2'],url:'http://localhost:4040/reconnect'});
  expect(result.media).toMatchObject({duration:0.1});
  const download=page.waitForEvent('download');await page.evaluate(()=>{const a=document.createElement('a');a.href='/download';a.download='fixture.bin';document.body.append(a);a.click();});expect((await download).suggestedFilename()).toBe('fixture.bin');
  expect((await request.get(proxy('http://localhost:4040/too-large-text'))).status()).toBe(413);expect((await request.get(proxy('http://localhost:4040/too-large-binary'))).status()).toBe(413);
});
