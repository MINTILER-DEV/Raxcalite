import {test,expect} from '@playwright/test';

test('CSS named property assignments map URLs on native style objects',async({page})=>{
  await page.goto('http://app.rax.localhost:3040');await page.locator('#address').fill('http://localhost:4040/next');await page.locator('#address').press('Enter');
  await expect.poll(()=>page.frames().find(f=>f.url().endsWith('/next'))?.url(),{timeout:15000}).toBeTruthy();const frame=page.frames().find(f=>f.url().endsWith('/next'))!;
  await frame.waitForFunction(()=>!!(window as any).__rax?.map && document.readyState!=='loading');
  const loaded=page.waitForResponse(r=>r.url().includes('/pixel.svg?css=native-property') && r.status()===200);
  const styles=await frame.evaluate(()=>{
    const element=document.createElement('div');element.style.width='20px';element.style.height='20px';document.body.append(element);
    const values=[];
    for(const key of ['backgroundImage','background-image','maskImage','mask-image','borderImageSource','border-image-source','clipPath','clip-path','filter']){
      if(!(key in element.style))continue;
      (element.style as any)[key]='url("http://127.0.0.1:4040/pixel.svg?css=native-property")';values.push({key,value:(element.style as any)[key]});
    }
    return values;
  });
  expect(styles.length).toBeGreaterThan(4);
  for(const style of styles)expect(style.value,style.key).toContain('/p/aHR0cDovLzEyNy4wLjAuMTo0MDQw/pixel.svg');
  expect((await loaded).status()).toBe(200);
});
