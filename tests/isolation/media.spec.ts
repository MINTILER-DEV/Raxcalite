import {test,expect} from '@playwright/test';

test('media session artwork uses mapped resources and preserves native metadata behavior',async({page})=>{
  await page.addInitScript(()=>{
    if(typeof MediaMetadata!=='undefined') (window as any).__nativeArtwork={
      Constructor:MediaMetadata,
      get:Object.getOwnPropertyDescriptor(MediaMetadata.prototype,'artwork')!.get
    };
  });
  await page.goto('http://app.rax.localhost:3040');
  await page.locator('#address').fill('http://localhost:4040/next');await page.locator('#address').press('Enter');
  await expect.poll(()=>page.frames().find(f=>f.url().endsWith('/next'))?.url(),{timeout:15000}).toBeTruthy();
  const frame=page.frames().find(f=>f.url().endsWith('/next'))!;
  await frame.waitForFunction(()=>!!(window as any).__rax?.map && document.readyState!=='loading');
  const result=await frame.evaluate(()=>{
    const native=(window as any).__nativeArtwork;
    if(!native)return {supported:false};
    const url='http://127.0.0.1:4040/pixel.png';let reads=0,titleReads=0;
    const input={get src(){reads++;return url;},sizes:'128x128',type:'image/png'};
    class Metadata extends MediaMetadata {}
    const metadata=new Metadata({get title(){titleReads++;return 'Playing';},artwork:[input]});
    const initial=metadata.artwork;
    const constructor={src:initial[0].src,nativeSrc:native.get.call(metadata)[0].src,
      mapped:(window as any).__rax.map(url),reads,titleReads,title:metadata.title,
      instance:metadata instanceof MediaMetadata && metadata instanceof Metadata,
      constructor:MediaMetadata.prototype.constructor===MediaMetadata,
      stable:initial===metadata.artwork,frozen:Object.isFrozen(initial)&&Object.isFrozen(initial[0])};
    navigator.mediaSession.metadata=metadata;
    let iterations=0;
    metadata.artwork={*[Symbol.iterator](){iterations++;yield {src:'/pixel.png',sizes:'32x32'};}} as any;
    const setter={src:metadata.artwork[0].src,nativeSrc:native.get.call(metadata)[0].src,
      mapped:(window as any).__rax.map('http://localhost:4040/pixel.png'),iterations};
    const previous=metadata.artwork;
    const failure=(fn:()=>unknown)=>{try{fn();return '';}catch(error){return (error as Error).name;}};
    const invalid={proxy:failure(()=>metadata.artwork=[{src:Symbol('bad') as any}]),
      native:failure(()=>new native.Constructor({artwork:[{src:Symbol('bad')}]})),
      retained:metadata.artwork===previous,
      getter:failure(()=>Object.getOwnPropertyDescriptor(MediaMetadata.prototype,'artwork')!.get!.call({})),
      setter:failure(()=>Object.getOwnPropertyDescriptor(MediaMetadata.prototype,'artwork')!.set!.call({},[]))};
    const data='data:image/png;base64,iVBORw0KGgo=';
    metadata.artwork=[{src:data}];
    const unchanged={logical:metadata.artwork[0].src,native:native.get.call(metadata)[0].src};
    metadata.artwork=[];
    return {supported:true,constructor,setter,invalid,unchanged,empty:metadata.artwork.length};
  });
  test.info().annotations.push({type:'Native MediaMetadata support',description:String(result.supported)});
  if(!result.supported)return;
  expect(result.constructor).toMatchObject({src:'http://127.0.0.1:4040/pixel.png',reads:1,titleReads:1,title:'Playing',instance:true,constructor:true,stable:true,frozen:true});
  expect(result.constructor!.nativeSrc).toBe(result.constructor!.mapped);
  expect(result.constructor!.nativeSrc).not.toBe(result.constructor!.src);
  expect(result.setter).toMatchObject({src:'http://localhost:4040/pixel.png',iterations:1});
  expect(result.setter!.nativeSrc).toBe(result.setter!.mapped);
  expect(result.invalid).toEqual({proxy:'TypeError',native:'TypeError',retained:true,getter:'TypeError',setter:'TypeError'});
  expect(result.unchanged!.native).toBe(result.unchanged!.logical);
  expect(result.empty).toBe(0);
});

async function installMSE({mime,url}:{mime:string,url:string}){
  try{
    document.querySelector<HTMLVideoElement>('#native-media')?.pause();
    const v=document.createElement('video');v.id='mse-media';v.muted=true;document.body.append(v);
    const source=new MediaSource();v.src=URL.createObjectURL(source);
    await new Promise<void>(resolve=>source.addEventListener('sourceopen',()=>resolve(),{once:true}));
    const buffer=source.addSourceBuffer(mime);
    const bytes=await(await fetch(url,{cache:'reload'})).arrayBuffer();
    await new Promise<void>((resolve,reject)=>{buffer.addEventListener('updateend',()=>resolve(),{once:true});buffer.addEventListener('error',()=>reject(Error('MediaSource append failed')),{once:true});buffer.appendBuffer(bytes);});
    source.endOfStream();await v.play();return true;
  }catch(error){
    // Engines may advertise the format but reject its constructor, buffer or decoding.
    if((error as DOMException).name==='NotSupportedError')return false;
    throw error;
  }
}

// Public media endpoints commonly reject OPTIONS. Browser cache policy must not
// turn a safelisted GET into a preflight, while author headers still require one.
test('cross-origin video streams play with native and MediaSource loading',async({page,browser})=>{
  test.setTimeout(60000);
  await page.goto('http://app.rax.localhost:3040');
  await page.locator('#address').fill('http://localhost:4040/next');await page.locator('#address').press('Enter');
  await expect.poll(()=>page.frames().find(f=>f.url().endsWith('/next'))?.url(),{timeout:15000}).toBeTruthy();
  const frame=page.frames().find(f=>f.url().endsWith('/next'))!;
  await frame.waitForFunction(()=>!!(window as any).__rax?.map && document.readyState!=='loading');
  await frame.evaluate(async()=>{const iframe=document.createElement('iframe');iframe.src='http://127.0.0.1:4040/resource-cookie';await new Promise<void>(resolve=>{iframe.onload=()=>resolve();document.body.append(iframe)});});
  const requests=await frame.evaluate(async()=>{
    const url='http://127.0.0.1:4040/stream.mp4';
    const response=await fetch(url,{cache:'no-store',headers:{range:'bytes=0-31'}});
    const xhr=await new Promise(resolve=>{const x=new XMLHttpRequest();x.open('GET',url);x.responseType='arraybuffer';x.onload=()=>resolve({status:x.status,bytes:x.response.byteLength,cookie:x.getResponseHeader('x-fixture-cookie')});x.onerror=()=>resolve({status:x.status});x.send();});
    const rejected=[];
    for(const headers of [{'cache-control':'no-cache'},{pragma:'no-cache'},{range:'bytes=0-1,3-4'},{'x-page-header':'value'},{'icy-metadata':'1'}])rejected.push(await fetch(url,{headers}).then(()=>'',e=>e.name));
    return {status:response.status,range:response.headers.get('content-range'),bytes:(await response.arrayBuffer()).byteLength,cookie:response.headers.get('x-fixture-cookie'),xhr,rejected};
  });
  expect(requests).toMatchObject({status:206,range:expect.stringMatching(/^bytes 0-31\/\d+$/),bytes:32,cookie:'',xhr:{status:200,cookie:''},rejected:['TypeError','TypeError','TypeError','TypeError','TypeError']});
  expect((requests.xhr as {bytes:number}).bytes).toBeGreaterThan(1000);
  const mime='video/mp4; codecs="avc1.42c00b, mp4a.40.2"';
  const reference=await browser.newContext();const direct=await reference.newPage();await direct.goto('http://localhost:4040/next');
  const nativePlayback=await direct.evaluate(async()=>{const v=document.createElement('video');v.muted=true;v.src='/stream.mp4';document.body.append(v);void v.play().catch(()=>{});await new Promise(resolve=>setTimeout(resolve,1500));return v.currentTime>0.5;});
  // isTypeSupported can report true even when addSourceBuffer rejects muxed media.
  // Check the same source directly before requiring proxied MediaSource playback.
  const supported=await direct.evaluate(mime=>typeof MediaSource!=='undefined' && MediaSource.isTypeSupported(mime),mime) && await direct.evaluate(installMSE,{mime,url:'http://127.0.0.1:4040/stream.mp4'});await reference.close();
  test.info().annotations.push({type:'Native video playback support',description:String(nativePlayback)});
  if(nativePlayback){
    await frame.evaluate(()=>{const v=document.createElement('video');v.id='native-media';v.muted=true;v.crossOrigin='anonymous';v.src='http://127.0.0.1:4040/stream.mp4';document.body.append(v);void v.play();});
    await expect.poll(()=>frame.evaluate(()=>document.querySelector<HTMLVideoElement>('#native-media')!.currentTime)).toBeGreaterThan(0.5);
    expect(await frame.evaluate(()=>document.querySelector<HTMLVideoElement>('#native-media')!.error?.message??null)).toBeNull();
  }
  test.info().annotations.push({type:'MediaSource codec support',description:String(supported)});
  if(supported){
    expect(await frame.evaluate(installMSE,{mime,url:'http://127.0.0.1:4040/stream.mp4'})).toBe(true);
    await expect.poll(()=>frame.evaluate(()=>document.querySelector<HTMLVideoElement>('#mse-media')!.currentTime)).toBeGreaterThan(0.5);
    expect(await frame.evaluate(()=>document.querySelector<HTMLVideoElement>('#mse-media')!.error?.message??null)).toBeNull();
  }
  const cookieFrame=page.frames().find(f=>f.url().endsWith('/resource-cookie'))!;
  expect(await cookieFrame.evaluate(async()=>await(await fetch('/api/echo')).json())).toMatchObject({cookie:expect.stringContaining('private_resource=yes')});
});
