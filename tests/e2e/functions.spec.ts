import {test,expect} from '@playwright/test';
import {encodeURL} from '../../shared/url.mjs';
test('generated function variants preserve await, yield, lexical parameters and prototype constructors',async({page,browser})=>{
  const exercise=async(target:typeof page)=>target.evaluate(async()=>{
    const Async=Object.getPrototypeOf(async function(){}).constructor,Generator=Object.getPrototypeOf(function*(){}).constructor,AsyncGenerator=Object.getPrototypeOf(async function*(){}).constructor;
    return {ordinary:(function(){}).constructor('return location.href')(),async:await Async('return await Promise.resolve(location.href)')(),generator:Generator('yield location.href')().next().value,asyncGenerator:(await AsyncGenerator('yield await Promise.resolve(location.href)')().next()).value,shadow:await Async('location','return await Promise.resolve(location)')('local')};
  });
  const context=await browser.newContext();const direct=await context.newPage();await direct.goto('http://localhost:4040/next');const reference=await exercise(direct);
  await page.goto(encodeURL('http://localhost:4040/next','http://localhost:4040','http://localhost:3031'));expect(await exercise(page)).toEqual(reference);await context.close();
});
