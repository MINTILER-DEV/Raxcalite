import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parse} from 'acorn';
import {rewriteLargeJS} from '../../tools/rewriting/large-javascript.mjs';
import {rewriteJS} from '../../tools/rewriting/javascript.mjs';

for(const rewrite of [rewriteJS,rewriteLargeJS])test(`${rewrite.name}: lexical globals, optional messaging, nested arguments and direct eval`,()=>{
 const calls=[],virtual={href:'virtual'};
 const context=vm.createContext({window:{location:{href:'physical'},postMessage(){}},__RAX_RUNTIME_v1__:{location:virtual,locationObject:o=>new Proxy(o,{get:(t,k)=>k==='location'?virtual:t[k]}),postMessage:(target,...args)=>calls.push(args),rewriteScript:(s,shadowedNames)=>rewrite(s,'https://example.com/',{shadowedNames}).code}});
 const source=`'use strict';var result=[location.href,({location}).location.href];const {location:alias}=window;result.push(alias.href);
 function f(location){return eval('location')};result.push(f('lexical'));
 function nested(window){return window.location};result.push(nested({location:'local'}));
 let n=0;null?.postMessage(n++);window['postMessage'](location.href,'*');window?.postMessage(n++,'*');window.postMessage?.(n++,'*');result.push(n);
 const object={postMessage:window.postMessage};object.postMessage(window.location.href,'*');`;
 const code=rewrite(source,'https://example.com/').code;parse(code,{ecmaVersion:'latest'});vm.runInContext(code,context);
 assert.deepEqual(Array.from(context.result),['virtual','virtual','virtual','lexical','local',2]);assert.equal(calls.length,4);assert.equal(calls[0][0],'virtual');assert.equal(calls[3][0],'virtual');
});
test('large source edits preserve helper bindings, imports, reflection and source maps',()=>{
 const source=`const __RAX_RUNTIME_v1__='author';const obj={__RAX_RUNTIME_v1__};function f(){return __RAX_RUNTIME_v1__};const value=Reflect.get(window,'location');import x from './x.js';export {x} from './other.js';const later=import('./later.js');const url=import.meta.url;`;
 const result=rewriteLargeJS(source,'https://example.com/a.js',{sourceMaps:true});parse(result.code,{ecmaVersion:'latest',sourceType:'module'});
 assert.match(result.code,/__RAX_RUNTIME_v1__:_raxBundle/);assert.match(result.code,/locationObject\(window\)/);assert.match(result.code,/\/p\//);assert.match(result.code,/mapImport/);assert.ok(result.map.sources.includes('https://example.com/a.js'));
});
test('a multi-megabyte bundle uses source edits and retains lexical behavior',()=>{
 const source='/*'+ 'padding'.repeat(700000)+'*/\nvar result=location.href;function f(location){return location};';
 const code=rewriteJS(source,'https://example.com/a.js').code;
 const context=vm.createContext({__RAX_RUNTIME_v1__:{location:{href:'virtual'}}});vm.runInContext(code,context);assert.equal(context.result,'virtual');assert.equal(context.f('local'),'local');assert.equal(code.split('\n').length,source.split('\n').length);
});
