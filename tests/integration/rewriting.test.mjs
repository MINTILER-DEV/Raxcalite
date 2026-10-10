import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rewriteHTML } from '../../tools/rewriting/html.mjs';
import { rewriteJS } from '../../tools/rewriting/javascript.mjs';
import { rewriteCSS } from '../../tools/rewriting/css.mjs';
import { encodeURL, decodeURL } from '../../shared/url.mjs';
import { decodeText } from '../../tools/rewriting/encoding.mjs';
test('text decoding respects BOM, HTTP charset, HTML meta and CSS charset', () => {
  const legacy = Buffer.from('<meta charset=windows-1252><title>caf\xe9</title>', 'latin1');
  assert.match(decodeText(legacy, 'html'), /café/);
  assert.equal(decodeText(Buffer.from([0x80]), 'js', 'text/javascript; charset=ISO-8859-1'), '€');
  assert.equal(decodeText(Buffer.from([0xff, 0xfe, 0x41, 0]), 'html'), 'A');
  assert.match(decodeText(Buffer.from('@charset "windows-1252";/*caf\xe9*/', 'latin1'), 'css'), /café/);
});
test('canonical mapping handles origins, Unicode, escapes, queries, fragments and non-network schemes', () => {
  for (const url of ['https://example.com/a%20b?q=%2F#frag', 'http://example.com:8080/', 'https://bücher.de/a']) {
    assert.equal(decodeURL(encodeURL(url, url, 'http://localhost:3031')), new URL(url).href);
  }
  assert.equal(encodeURL('data:text/plain,hello', 'https://example.com'), 'data:text/plain,hello');
  assert.equal(decodeURL(encodeURL('../a', 'https://example.com/dir/page'), 'http://localhost:3031'), 'https://example.com/a');
});
test('HTML5 parsing rewrites base, srcset, styles, script, forms and malformed structure', () => {
  const result = rewriteHTML('<title>A</title><base href="/assets/"><style>@import "a.css";a{background:url(b.png)}</style><img srcset="a.png 1x, b.png 2x"><form action="../submit"><script>location.href="/next"</script>', 'https://example.com/root/page');
  assert.deepEqual(result.warnings, []);
  assert.ok(result.code.indexOf('/runtime.js') < result.code.indexOf('location.href'));
  assert.match(result.code, /\/assets\/a.css/); assert.match(result.code, /\/assets\/a.png 1x/); assert.match(result.code, /\/submit/);
  assert.match(result.code, /__rax.location.href/);
});
test('CSS parser rewrites imports, fonts, image-set, inline values and custom properties', () => {
  const code = rewriteCSS('@import "a.css";@font-face{font-family:A;src:url(a.woff)}a{--picture:url(a.png);background:image-set(url(a.png) 1x,url(b.png) 2x)}', 'https://example.com/dir/');
  assert.match(code, /\/dir\/a.css/); assert.match(code, /\/dir\/a.woff/); assert.match(code, /\/dir\/b.png/);
  assert.match(rewriteCSS('background:url(a.png)', 'https://example.com/dir/', true), /\/dir\/a.png/);
});
test('AST respects shadowing and transforms assignments, computed globals, imports and meta URL', () => {
  const source = 'const a=location.href;window["location"]="/a";function f(location){return location.href}import x from "./a.js";const b=import("./b.js");const u=import.meta.url;';
  const code = rewriteJS(source, 'https://example.com/dir/main.js').code;
  assert.match(code, /__rax.location.href/); assert.match(code, /return location.href/);
  assert.match(code, /__rax.location =/); assert.match(code, /\/dir\/a.js/); assert.match(code, /import\(globalThis.__rax.mapImport/);
  assert.match(code, /https:\/\/example.com\/dir\/main.js/);
});
test('modern scripts and source maps preserve a debuggable AST', () => {
  const result = rewriteJS('class A{async *f(){yield location.href}};const f=async()=>await import("./x.js")', 'https://example.com/a.js', { sourceMaps: true });
  assert.ok(result.map?.sources.includes('https://example.com/a.js')); assert.match(result.code, /async \*f/);
});
test('AST preserves helper collisions, destructured location, optional calls, argument order and direct eval scope', () => {
  const calls = []; const virtual = { href: 'https://example.com/virtual' };
  const context = vm.createContext({ window: {location:{href:'physical'}}, __rax: { location: virtual,
    locationObject: object => new Proxy(object, {get: (target, key) => key === 'location' ? virtual : target[key]}),
    postMessage: (target, ...args) => { calls.push(args); },
    rewriteScript: (source, shadowedNames) => rewriteJS(source, 'https://example.com', {shadowedNames}).code } });
  const source = `const __rax='author';const {location:alias}=window;var result=[alias.href,__rax];
    function f(globalThis,location){return eval('location')};result.push(f('local','lexical'));
    let n=0;null?.postMessage(n++);window['postMessage'](location.href,'*');window?.postMessage(n++,'*');result.push(n);`;
  vm.runInContext(rewriteJS(source, 'https://example.com').code, context);
  assert.deepEqual(Array.from(context.result), ['https://example.com/virtual', 'author', 'lexical', 1]);
  assert.equal(calls[0][0], virtual.href); assert.equal(calls.length, 2);
});
