import {test,expect} from '@playwright/test';
import {encodeURL} from '../../shared/url.mjs';
test('import maps resolve bare, URL-shaped and scoped module keys',async({page,browser})=>{
  const context=await browser.newContext();const direct=await context.newPage();await direct.goto('http://localhost:4040/import-map');await expect.poll(()=>direct.evaluate(()=>(window as any).importMapResult)).toBeTruthy();
  await page.goto(encodeURL('http://localhost:4040/import-map','http://localhost:4040','http://localhost:3031'));await expect.poll(()=>page.evaluate(()=>(window as any).importMapResult)).toEqual(await direct.evaluate(()=>(window as any).importMapResult));await context.close();
});
test('DOM fragment parsing preserves contexts, single custom-element construction and inert JSON',async({page,browser})=>{
  const exercise=async(target:typeof page)=>target.evaluate(()=>{
    let constructions=0;customElements.define('fixture-custom-once',class extends HTMLElement{constructor(){super();constructions++;}});const custom=document.createElement('div');document.body.append(custom);custom.innerHTML='<fixture-custom-once></fixture-custom-once>';custom.firstElementChild!.outerHTML='<fixture-custom-once></fixture-custom-once>';custom.insertAdjacentHTML('beforeend','<fixture-custom-once></fixture-custom-once>');
    const reflected=document.createElement('div');reflected.setAttribute('class','initial');reflected.classList.add('later');reflected.setAttribute('title','initial');reflected.title='later';reflected.setAttribute('style','display:none');reflected.style.display='block';
    const bindings=document.createElement('div');bindings.innerHTML='<fixture-component data="[[payload]]"></fixture-component><img src="{{image}}">';const component=bindings.firstElementChild!;component.setAttribute('data','{{updated}}');const coercion=document.createElement('a');let coercions=0;coercion.setAttribute('href',{toString(){coercions++;return '/pixel.svg';}} as unknown as string);let coercionError='';try{coercion.setAttribute('href',Symbol('url') as unknown as string);}catch(e){coercionError=(e as Error).name;}document.body.append(bindings);
    const table=document.createElement('table');document.body.append(table);table.innerHTML='<tr><td><img id="cell-image" src="/pixel.svg"></td></tr>';
    const cell=table.rows[0].cells[0];cell.outerHTML='<td id="replacement"><img id="outer-image" src="/pixel.svg"></td>';
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.innerHTML='<image id="svg-image" href="/pixel.svg"/>';document.body.append(svg);
    const namespaced=document.createElementNS('http://www.w3.org/2000/svg','image');namespaced.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href','/pixel.svg');svg.append(namespaced);
    const json=document.createElement('script');json.type='application/json';json.text='{"location":"data","value":1}';document.head.append(json);
    const script=document.createElement('script');script.append(document.createTextNode('window.insertedURL=location.href'));document.head.append(script);
    const shadow=document.createElement('div');document.body.append(shadow);shadow.attachShadow({mode:'open'}).innerHTML='<img id="shadow-image" src="/pixel.svg">';(window as any).testShadow=shadow;
    const handler=document.createElement('button');handler.setAttribute('onclick','window.handlerURL=location.href');handler.click();
    return {coercionError,coercions,coercedURL:coercion.href,bindings:{data:component.attributes.getNamedItem('data')!.value,src:bindings.lastElementChild!.attributes.getNamedItem('src')!.value},reflection:{class:reflected.getAttribute('class'),title:reflected.getAttribute('title'),style:reflected.getAttribute('style')},constructions,customItems:custom.children.length,table:table.rows.length,cell:table.rows[0].cells[0].id,svg:svg.firstElementChild!.namespaceURI,xlink:namespaced.getAttributeNS('http://www.w3.org/1999/xlink','href'),json:JSON.parse(json.text),inline:(window as any).insertedURL,handler:(window as any).handlerURL};
  });
  const context=await browser.newContext();const direct=await context.newPage();await direct.goto('http://localhost:4040/next');const reference=await exercise(direct);expect(reference.constructions).toBe(3);expect(reference.customItems).toBe(2);
  await page.goto(encodeURL('http://localhost:4040/next','http://localhost:4040','http://localhost:3031'));expect(await exercise(page)).toEqual(reference);
  await expect.poll(()=>page.locator('#outer-image').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(10);
  await expect.poll(()=>page.evaluate(()=>(window as any).testShadow.shadowRoot.querySelector('img').naturalWidth)).toBe(10);
  await context.close();
});
