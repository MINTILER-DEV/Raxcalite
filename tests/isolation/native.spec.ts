import {test, expect} from '@playwright/test';
const app = 'http://app.rax.localhost:3040';
test('classic upstream service worker owns only its isolated virtual scope',async({page})=>{
  await page.goto(app);await page.locator('#address').fill('http://localhost:4040/next');await page.locator('#address').press('Enter');
  await expect.poll(()=>page.frames().find(f=>f.url().endsWith('/next'))?.url()).toBeTruthy();const frame=page.frames().find(f=>f.url().endsWith('/next'))!;await frame.waitForFunction(()=>!!(window as any).__rax?.map && document.readyState!=='loading');
  const registration=await frame.evaluate(async()=>{const r=await navigator.serviceWorker.register('/site-worker.js',{scope:'/'});await navigator.serviceWorker.ready;return {scope:r.scope,script:r.active!.scriptURL}});
  expect(registration).toEqual({scope:'http://localhost:4040/',script:'http://localhost:4040/site-worker.js'});
  await expect.poll(()=>frame.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  expect(await frame.evaluate(async()=>await(await fetch('/sw-resource')).text())).toBe('worker-response');
  expect(await frame.evaluate(async()=>{try{await navigator.serviceWorker.register('http://127.0.0.1:4040/site-worker.js');return ''}catch(e){return(e as DOMException).name}})).toBe('SecurityError');
});
test('native origins isolate hostile frames, storage, assertions and independent users', async ({page,browser}) => {
  await page.goto(app);await page.locator('#address').fill('http://localhost:4040/frame');await page.locator('#address').press('Enter');
  await expect.poll(()=>page.frames().find(f=>f.url().includes('/p/') && f.url().endsWith('/frame'))?.url()).toBeTruthy();
  const frame=page.frames().find(f=>f.url().endsWith('/frame'))!;
  await expect.poll(()=>frame.evaluate(()=>(window as any).messageResult)).toEqual({data:'child-value',origin:'http://127.0.0.1:4040'});
  const child=page.frames().find(f=>f.url().endsWith('/child'))!;
  expect(new URL(child.url()).origin).not.toBe(new URL(frame.url()).origin);
  expect(await child.evaluate(()=>{try{return parent.document.title}catch(e){return (e as DOMException).name}})).toBe('SecurityError');
  expect(await frame.evaluate(()=>{try{return parent.document.title}catch(e){return (e as DOMException).name}})).toBe('SecurityError');
  await frame.evaluate(()=>localStorage.setItem('private','parent'));expect(await child.evaluate(()=>localStorage.getItem('private'))).toBeNull();
  const bypass=await frame.evaluate(async()=>{
    const blank=document.createElement('iframe');document.body.append(blank);const fetchNative=blank.contentWindow!.fetch.bind(blank.contentWindow);
    const virtual=(window as any).__rax;const response=await fetchNative(virtual.map('/api/echo'),{headers:{'x-rax-origin':'http://127.0.0.1:4040','x-rax-mode':'cors'}});
    const cookies=await fetchNative(location.origin+'/api/cookie?url='+encodeURIComponent('http://127.0.0.1:4040/'));
    blank.remove();return {assertion:response.status,cookies:cookies.status};
  });
  expect(bypass).toEqual({assertion:403,cookies:403});
  const other=await browser.newContext();const otherPage=await other.newPage();await otherPage.goto(app);await otherPage.locator('#address').fill('http://localhost:4040/frame');await otherPage.locator('#address').press('Enter');
  await expect.poll(()=>otherPage.frames().find(f=>f.url().endsWith('/frame'))?.url()).toBeTruthy();
  expect(new URL(otherPage.frames().find(f=>f.url().endsWith('/frame'))!.url()).hostname).not.toBe(new URL(frame.url()).hostname);await other.close();
});
test('isolated routing supports API wrappers, module workers, cookies, CORS and sockets',async({page})=>{
  await page.goto(app);await page.locator('#address').fill('http://localhost:4040/cookie');await page.locator('#address').press('Enter');
  await expect.poll(()=>page.frames().find(f=>f.url().includes('/p/') && f.url().endsWith('/cookie'))?.url()).toBeTruthy();
  const frame=page.frames().find(f=>f.url().endsWith('/cookie'))!;
  await expect.poll(()=>frame.evaluate(()=>(window as any).results)).toMatchObject({ready:true,worker:{value:'worker-value'},moduleWorker:'module-value',socket:'socket-value',xhr:{method:'GET'}});
  expect(await frame.evaluate(()=>document.cookie)).not.toContain('server=yes');expect(await frame.evaluate(()=>(window as any).results.fetch.cookie)).toContain('server=yes');
  expect(await frame.evaluate(async()=>await(await fetch('http://127.0.0.1:4040/api/echo?cors=yes')).json())).toMatchObject({origin:'http://localhost:4040'});
  expect(await frame.evaluate(async()=>fetch('http://127.0.0.1:4040/api/echo').then(()=>'',e=>e.name))).toBe('TypeError');
});
