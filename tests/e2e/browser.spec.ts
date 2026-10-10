import { test, expect } from '@playwright/test';
import { encodeURL } from '../../shared/url.mjs';
const contentOrigin = 'http://localhost:3031';
const proxy = (url: string) => encodeURL(url,url,contentOrigin);
test('application worker restores the shell and configuration offline',async({page,context})=>{
  await page.goto('http://localhost:3030');await page.evaluate(()=>navigator.serviceWorker.ready);
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);await page.reload();await expect(page.locator('#home h1')).toHaveText('Raxcalite');await context.setOffline(false);
});
test('shell traverses native history with state intact and restores tabs', async ({page}) => {
  await page.goto('http://localhost:3030');await page.locator('#address').fill('http://localhost:4040/next');await page.locator('#address').press('Enter');
  await expect(page.frameLocator('iframe:not([hidden])').locator('h1')).toHaveText('Next page');
  const frame=page.frames().find(f=>f.url().endsWith('/next'))!;
  await frame.evaluate(()=>{(window as any).marker='kept';history.pushState({counter:1},'','/state');history.pushState({counter:2},'','/state?two');});
  await expect(page.locator('#address')).toHaveValue('http://localhost:4040/state?two');await page.locator('#back').click();
  await expect(page.locator('#address')).toHaveValue('http://localhost:4040/state');expect(await frame.evaluate(()=>({state:history.state,marker:(window as any).marker}))).toEqual({state:{counter:1},marker:'kept'});
  await page.locator('#forward').click();await expect(page.locator('#address')).toHaveValue('http://localhost:4040/state?two');
  expect(await frame.evaluate(()=>history.state)).toEqual({counter:2});
  await page.locator('#new-tab').click();await page.locator('#address').fill('http://localhost:4040/next');await page.locator('#address').press('Enter');await page.reload();
  await expect(page.locator('.tab')).toHaveCount(2);await expect(page.locator('#address')).toHaveValue('http://localhost:4040/next');
});
test('DOM insertion preserves authored strings, custom elements and adopted CSS; caches map Request keys', async ({ page }) => {
  await page.goto(proxy('http://localhost:4040/next'));
  const result = await page.evaluate(async () => {
    const image = document.createElement('img'); image.setAttribute('src','/pixel.svg'); document.body.append(image);
    const container=document.createElement('div');container.innerHTML='<img src="/pixel.svg">';document.body.append(container);
    customElements.define('fixture-image',class extends HTMLElement { connectedCallback(){this.innerHTML='<img src="/pixel.svg">';} });document.body.append(document.createElement('fixture-image'));
    const sheet=new CSSStyleSheet();sheet.replaceSync('body{background-image:url(/pixel.svg)}');document.adoptedStyleSheets=[sheet];
    const cache=await caches.open('requests');await cache.put(new Request('/mapped-key?q=1'),new Response('stored'));
    const hit=await cache.match('/mapped-key?q=1');const keys=await cache.keys();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.className.baseVal='unchanged';
    return { attribute:image.getAttribute('src'), property:image.src, htmlAttribute:container.firstElementChild!.getAttribute('src'), cache:await hit!.text(), key:keys[0].url, svg:svg.className.baseVal, css:sheet.cssRules[0].cssText };
  });
  expect(result).toMatchObject({attribute:'/pixel.svg',property:'http://localhost:4040/pixel.svg',htmlAttribute:'/pixel.svg',cache:'stored',key:'http://localhost:4040/mapped-key?q=1',svg:'unchanged'});
  expect(result.css).toContain('/p/');await expect.poll(()=>page.locator('fixture-image img').evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(10);
});
test('generated scripts, aliases and lexical eval observe the virtual environment', async ({page}) => {
  await page.goto(proxy('http://localhost:4040/generated'));
  await expect.poll(() => page.evaluate(() => (window as any).generated)).toEqual({ collision: 'author', alias: 'http://localhost:4040/generated', evalURL: 'http://localhost:4040/generated', functionURL: 'http://localhost:4040/generated', inlineURL: 'http://localhost:4040/generated', timerURL: 'http://localhost:4040/generated', lexical: 'local' });
});
test('CORS responses expose only permitted headers, no-cors is opaque and XHR fails natively', async ({page}) => {
  await page.goto(proxy('http://localhost:4040/next'));
  const result = await page.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:4040/api/echo?cors=yes');
    const opaque = await fetch('http://127.0.0.1:4040/api/echo', {mode:'no-cors'});
    const xhr = await new Promise(resolve => { const xhr=new XMLHttpRequest();const events:string[]=[];xhr.open('GET','http://127.0.0.1:4040/api/echo');xhr.onerror=()=>events.push('error');xhr.onload=()=>events.push('load');xhr.onloadend=()=>resolve({events,status:xhr.status,response:xhr.responseText});xhr.send(); });
    return { type:response.type, hidden:response.headers.get('x-hidden'), visible:response.headers.get('x-visible'), clone:response.clone().type, opaque:{type:opaque.type,status:opaque.status,url:opaque.url,body:await opaque.text(),headers:[...opaque.headers]}, xhr };
  });
  expect(result).toEqual({type:'cors',hidden:null,visible:'public',clone:'cors',opaque:{type:'opaque',status:0,url:'',body:'',headers:[]},xhr:{events:['error'],status:0,response:''}});
});
test('charset decoding, multipart and large streamed backend uploads, readiness and Host validation', async ({ page, request }) => {
  await page.goto(proxy('http://localhost:4040/legacy')); await expect(page.locator('h1')).toHaveText('café');
  const uploaded = await page.evaluate(async () => {
    const form = new FormData(); form.append('file', new Blob(['multipart-value']), 'fixture.txt');
    const multipart = await (await fetch('/upload', { method: 'POST', body: form })).json();
    const large = await (await fetch('/upload', { method: 'PUT', body: new Uint8Array(9 * 1024 * 1024) })).json();
    return { multipart, large };
  });
  expect(uploaded.multipart.type).toContain('multipart/form-data; boundary='); expect(uploaded.multipart.bytes).toBeGreaterThan(100);
  expect(uploaded.large.bytes).toBe(9 * 1024 * 1024);
  expect((await request.get(`${contentOrigin}/ready`)).status()).toBe(200);
  expect((await request.get(`${contentOrigin}/health`, { headers: { host: 'attacker.example:3031' } })).status()).toBe(421);
  expect((await request.get(`${contentOrigin}/metrics`)).status()).toBe(403);
});
test('browser chrome is compact, collapses, opens tabs and navigates', async ({ page }) => {
  await page.goto('http://localhost:3030');
  expect(await page.locator('.chrome').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(100);
  await page.locator('#address').fill('http://localhost:4040/next'); await page.locator('#address').press('Enter');
  await expect(page.frameLocator('iframe:not([hidden])').locator('h1')).toHaveText('Next page');
  await expect(page.locator('#address')).toHaveValue('http://localhost:4040/next');
  await page.locator('#hide').click();await expect(page.locator('.chrome')).not.toBeVisible();await expect(page.locator('#reveal')).toBeVisible();
  await page.screenshot({path:'test-results/browser-collapsed.png'});
  await page.locator('#reveal').click();await page.locator('#new-tab').click();await expect(page.locator('.tab')).toHaveCount(2);
  await page.locator('#address').fill('http://localhost:4040/redirect');await page.locator('#address').press('Enter');
  await expect(page.frameLocator('iframe:not([hidden])').locator('h1')).toHaveText('Next page');
  await page.screenshot({path:'test-results/browser-expanded.png'});
});
test('direct and proxied fixtures execute scripts, networking, state, modules, workers, sockets and SSE',async({page,context})=>{
  const direct=await context.newPage();await direct.goto('http://localhost:4040/');
  await expect.poll(()=>direct.evaluate(()=> (window as any).results?.ready)).toBe(true);
  await page.goto(proxy('http://localhost:4040/'));
  await expect.poll(()=>page.evaluate(()=> (window as any).results)).toMatchObject({ready:true,worker:{value:'worker-value',method:'GET',imported:'imported-value'},moduleWorker:'module-value',socket:'socket-value',sse:'stream-value',xhr:{method:'GET'}});
  // IndexedDB opens independently of the fixture's fetch/cache readiness flag.
  await expect.poll(()=>page.evaluate(()=> (window as any).results?.idb)).toBe('fixture');
  await expect.poll(()=>direct.evaluate(()=> (window as any).results?.idb)).toBe('fixture');
  const proxied=await page.evaluate(()=> (window as any).results);
  const actual=await direct.evaluate(()=> (window as any).results);
  for(const key of ['url','docURL','base','shadow','local','session','module','moduleURL','idb','cache'])expect(proxied[key],key).toEqual(actual[key]);
  expect(proxied.fetch.body).toBe('body-value');expect(proxied.fetch.cookie).toContain('script=yes');
  await expect(page.locator('h1')).toHaveCSS('color','rgb(123, 45, 67)');
  expect(await page.locator('#image').evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(10);
});
test('HttpOnly cookies stay server-side and independent contexts use separate sessions',async({page,browser})=>{
  await page.goto(proxy('http://localhost:4040/cookie'));
  await expect.poll(()=>page.evaluate(()=> (window as any).results?.ready)).toBe(true);
  const result=await page.evaluate(()=>({cookie:document.cookie,network:(window as any).results.fetch.cookie}));
  expect(result.cookie).toContain('visible=yes');expect(result.cookie).not.toContain('server=yes');expect(result.network).toContain('server=yes');
  const protectedCookie=await page.evaluate(async()=>{document.cookie='secret_path=hacked; Path=/protected';document.cookie='created=bad; HttpOnly=true';return await(await fetch('/protected/echo')).json()});
  expect(protectedCookie.cookie).toContain('secret_path=yes');expect(protectedCookie.cookie).not.toContain('created=bad');
  const isolated=await browser.newContext();const other=await isolated.newPage();await other.goto(proxy('http://localhost:4040/'));
  await expect.poll(()=>other.evaluate(()=> (window as any).results?.ready)).toBe(true);
  expect(await other.evaluate(()=> (window as any).results.fetch.cookie)).not.toContain('server=yes');await isolated.close();
});
test('virtual storage namespaces separate origins and history preserves virtual URLs',async({page})=>{
  await page.goto(proxy('http://localhost:4040/next'));
  await page.evaluate(()=>{localStorage.setItem('private','value');history.pushState({x:1},'','/changed?q=1');});
  expect(await page.evaluate(()=>document.URL)).toBe('http://localhost:4040/changed?q=1');
  await expect(page.evaluate(()=>history.pushState({},'','http://other.example/'))).rejects.toThrow();
  await page.goto(proxy('http://127.0.0.1:4040/next'));expect(await page.evaluate(()=>localStorage.getItem('private'))).toBeNull();
});
test('frames deliver virtual message origins and forms submit bodies',async({page})=>{
  await page.goto(proxy('http://localhost:4040/frame'));
  await expect.poll(()=>page.evaluate(()=> (window as any).messageResult)).toEqual({data:'child-value',origin:'http://127.0.0.1:4040'});
  await page.goto(proxy('http://localhost:4040/'));await page.locator('#form button').click();await expect(page.locator('h1')).toHaveText('value=posted');
});
test('unsafe destinations, unsafe redirects and unsupported workers fail explicitly',async({page,request})=>{
  const blocked=await request.get(proxy('http://169.254.169.254/'));expect(blocked.status()).toBe(403);
  const redirect=await request.get(proxy('http://localhost:4040/unsafe-redirect'));expect(redirect.status()).toBe(403);
  const binary=await request.get(proxy('http://localhost:4040/binary'));expect(await binary.body()).toEqual(Buffer.from([0,1,2,255]));
  await page.goto(proxy('http://localhost:4040/next'));
  expect(await page.evaluate(()=>{try{new Worker(URL.createObjectURL(new Blob(['postMessage(1)'])));return ''}catch(e){return (e as DOMException).name}})).toBe('NotSupportedError');
  expect(await page.evaluate(()=>navigator.serviceWorker.register('/worker.js').then(()=>'',e=>e.name))).toBe('NotSupportedError');
});
test('virtual CORS, credential modes, cancellation, HTTP methods and range requests',async({page,request})=>{
  await page.goto(proxy('http://localhost:4040/next'));
  const result=await page.evaluate(async()=>{
    document.cookie='mode=test; Path=/';
    const omitted=await(await fetch('/api/echo',{credentials:'omit'})).json();
    const allowed=await(await fetch('http://127.0.0.1:4040/api/echo?cors=yes',{method:'PUT',body:'cors-body',headers:{'content-type':'application/json'},credentials:'include'})).json();
    const blocked=await fetch('http://127.0.0.1:4040/api/echo').then(()=>'',e=>e.name);
    const sameOrigin=await fetch('http://127.0.0.1:4040/api/echo?cors=yes',{mode:'same-origin'}).then(()=>'',e=>e.name);
    const controller=new AbortController();const pending=fetch('/slow',{signal:controller.signal}).then(()=>'',e=>e.name);controller.abort();
    const methods=[];for(const method of ['GET','POST','PUT','PATCH','DELETE','HEAD']){const r=await fetch('/api/echo',{method});methods.push(r.status)}
    return {omitted,allowed,blocked,sameOrigin,aborted:await pending,methods};
  });
  expect(result.omitted.cookie).not.toContain('mode=test');expect(result.allowed).toMatchObject({method:'PUT',body:'cors-body',origin:'http://localhost:4040',authorization:''});
  expect(result.blocked).toBe('TypeError');expect(result.sameOrigin).toBe('TypeError');expect(result.aborted).toBe('AbortError');expect(result.methods).toEqual([200,200,200,200,200,200]);
  const range=await request.get(proxy('http://localhost:4040/range'),{headers:{range:'bytes=5-9'}});expect(range.status()).toBe(206);expect(await range.body()).toEqual(Buffer.from([5,6,7,8,9]));
});
test('shell origin isolation, mobile layout, auto-hide, native history and worker recovery',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('http://localhost:3030');
  await page.locator('#settings').click();await page.locator('#auto-hide').check();await page.locator('[data-close="settings-panel"]').click();
  await page.locator('#address').fill('http://localhost:4040/next');await page.locator('#address').press('Enter');
  await expect(page.locator('.chrome')).not.toBeVisible();
  const frame=page.frames().find(f=>f.url().startsWith(contentOrigin+'/p/'))!;
  expect(await frame.evaluate(()=>{try{return parent.document.title}catch(e){return (e as DOMException).name}})).toBe('SecurityError');
  await page.locator('#reveal').click();await page.locator('#settings').click();await page.locator('#recover').click();await expect(page.locator('#status')).toContainText('reset');
  await page.screenshot({path:'test-results/browser-mobile.png'});
  await page.goto(proxy('http://localhost:4040/next'));await page.evaluate(()=>history.pushState({},'','/state'));await page.evaluate(()=>history.back());
  await expect.poll(()=>page.evaluate(()=>document.URL)).toBe('http://localhost:4040/next');
});
test('dynamic DOM URLs, CSSOM and srcset load through the canonical route',async({page})=>{
  await page.goto(proxy('http://localhost:4040/next'));
  await page.evaluate(()=>{
    const host=document.createElement('div');host.id='dynamic';host.innerHTML='<img id="dynamic-image" src="/pixel.svg"><img id="dynamic-srcset" srcset="/pixel.svg 1x">';document.body.append(host);
    const image=document.createElement('img');image.id='property-image';image.src='/pixel.svg';document.body.append(image);
    const rule=document.createElement('style');document.head.append(rule);rule.sheet!.insertRule('#dynamic { background-image:url(/pixel.svg) }');
    host.style.setProperty('background-image','url(/pixel.svg)');
  });
  for(const id of ['dynamic-image','dynamic-srcset','property-image'])await expect.poll(()=>page.locator('#'+id).evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(10);
  expect(await page.locator('#dynamic').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('/p/');
});
