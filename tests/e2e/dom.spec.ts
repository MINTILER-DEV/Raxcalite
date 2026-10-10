import {test,expect} from '@playwright/test';
import {encodeURL} from '../../shared/url.mjs';
test('DOM fragment parsing preserves table and SVG contexts, outerHTML and inert JSON',async({page,browser})=>{
  const exercise=async(target:typeof page)=>target.evaluate(()=>{
    const table=document.createElement('table');document.body.append(table);table.innerHTML='<tr><td><img id="cell-image" src="/pixel.svg"></td></tr>';
    const cell=table.rows[0].cells[0];cell.outerHTML='<td id="replacement"><img id="outer-image" src="/pixel.svg"></td>';
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.innerHTML='<image id="svg-image" href="/pixel.svg"/>';document.body.append(svg);
    const namespaced=document.createElementNS('http://www.w3.org/2000/svg','image');namespaced.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href','/pixel.svg');svg.append(namespaced);
    const json=document.createElement('script');json.type='application/json';json.text='{"location":"data","value":1}';document.head.append(json);
    const script=document.createElement('script');script.append(document.createTextNode('window.insertedURL=location.href'));document.head.append(script);
    const shadow=document.createElement('div');document.body.append(shadow);shadow.attachShadow({mode:'open'}).innerHTML='<img id="shadow-image" src="/pixel.svg">';(window as any).testShadow=shadow;
    const handler=document.createElement('button');handler.setAttribute('onclick','window.handlerURL=location.href');handler.click();
    return {table:table.rows.length,cell:table.rows[0].cells[0].id,svg:svg.firstElementChild!.namespaceURI,xlink:namespaced.getAttributeNS('http://www.w3.org/1999/xlink','href'),json:JSON.parse(json.text),inline:(window as any).insertedURL,handler:(window as any).handlerURL};
  });
  const context=await browser.newContext();const direct=await context.newPage();await direct.goto('http://localhost:4040/next');const reference=await exercise(direct);
  await page.goto(encodeURL('http://localhost:4040/next','http://localhost:4040','http://localhost:3031'));expect(await exercise(page)).toEqual(reference);
  await expect.poll(()=>page.locator('#outer-image').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(10);
  await expect.poll(()=>page.evaluate(()=>(window as any).testShadow.shadowRoot.querySelector('img').naturalWidth)).toBe(10);
  await context.close();
});
