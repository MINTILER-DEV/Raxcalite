import {test,expect} from '@playwright/test';
test('HTTPS gateway preserves native isolation, Secure cookies, streaming and WebSocket upgrades',async({page,context})=>{
  await page.goto('https://app.rax.localhost:3443');await page.locator('#address').fill('http://localhost:4040/cookie');await page.locator('#address').press('Enter');
  await expect.poll(()=>page.frames().find(f=>f.url().endsWith('/cookie'))?.url()).toBeTruthy();const frame=page.frames().find(f=>f.url().endsWith('/cookie'))!;
  await expect.poll(()=>frame.evaluate(()=>(window as any).results),{timeout:15000}).toMatchObject({ready:true,socket:'socket-value',worker:{value:'worker-value'},sse:'stream-value'});
  expect(await frame.evaluate(()=>isSecureContext)).toBe(true);expect((await context.cookies()).find(c=>c.name==='rax_session')?.secure).toBe(true);
  expect(await frame.evaluate(()=>{try{return parent.document.title}catch(e){return(e as DOMException).name}})).toBe('SecurityError');
  expect(await frame.evaluate(async()=>await(await fetch('http://127.0.0.1:4040/api/echo?cors=yes')).json())).toMatchObject({origin:'http://localhost:4040'});
});
