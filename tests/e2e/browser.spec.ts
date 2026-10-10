import { test, expect } from '@playwright/test';
import { encodeURL } from '../../shared/url.mjs';
const contentOrigin = 'http://localhost:3031';
const proxy = (url: string) => encodeURL(url,url,contentOrigin);
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
