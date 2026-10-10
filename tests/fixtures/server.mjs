import http from 'node:http';
import { WebSocketServer } from 'ws';
const html = `<!doctype html><title>Compatibility fixture</title><link rel="stylesheet" href="/style.css"><h1 id="title">Fixture</h1><a id="next" href="/next">Next page</a><form id="form" action="/form" method="post"><input name="value" value="posted"><button>Submit</button></form><img id="image" src="/pixel.svg"><div id="results"></div><script src="/app.js"></script>`;
const script = `
window.results={url:location.href,docURL:document.URL,base:document.baseURI};
const locallyShadowed=(location)=>location;results.shadow=locallyShadowed('local');
localStorage.setItem('test','local-value');sessionStorage.setItem('test','session-value');results.local=localStorage.test;results.session=sessionStorage.getItem('test');
document.cookie='script=yes; Path=/';results.cookie=document.cookie;
(async()=>{
try{
results.fetch=await (await fetch('/api/echo',{method:'POST',body:'body-value'})).json();
results.request=await (await fetch(new Request('/api/echo'))).json();
const xhr=new XMLHttpRequest();xhr.open('GET','/api/echo');xhr.responseType='json';xhr.onload=()=>results.xhr=xhr.response;xhr.send();
const module=await import('/module.js');results.module=module.value;results.moduleURL=module.url;
const worker=new Worker('/worker.js');worker.onmessage=e=>{results.worker=e.data;worker.terminate()};
const moduleWorker=new Worker('/module-worker.js',{type:'module'});moduleWorker.onmessage=e=>{results.moduleWorker=e.data;moduleWorker.terminate()};moduleWorker.onerror=e=>results.moduleWorkerError=e.message;
const ws=new WebSocket('ws://localhost:4040/socket','echo');ws.onopen=()=>ws.send('socket-value');ws.onmessage=e=>{results.socket=e.data;ws.close(1000,'done')};
const source=new EventSource('/events');source.onmessage=e=>{results.sse=e.data;source.close()};
const database=indexedDB.open('fixture');database.onupgradeneeded=()=>database.result.createObjectStore('values');database.onsuccess=()=>{results.idb=database.result.name;database.result.close()};
const cache=await caches.open('fixture');await cache.put('/cache-key',new Response('cache-value'));results.cache=await(await cache.match('/cache-key')).text();
results.ready=true;
}catch(e){results.failure=e.message}
})();
`;
export function startFixtures(port = 4040) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (url.pathname === '/style.css') { res.setHeader('content-type','text/css'); res.end('h1{color:rgb(123,45,67)}body{background:#f6f6f9}#image{width:20px}'); }
    else if (url.pathname === '/large-bundle.js') {res.setHeader('content-type','text/javascript');res.end('/*'+'padding'.repeat(750000)+'*/\nwindow.largeBundle={url:location.href,shadow:(location=>location)("lexical")};');}
    else if (url.pathname === '/native-aliases') {res.setHeader('content-type','text/html');res.end(`<meta name="referrer" content="no-referrer"><title>Native aliases</title><button id="alias-next">Next</button><script>const alias=window;const {location:extracted}=alias;document.cookie='bridge=yes; Path=/';window.aliasResults={url:alias.location.href,optional:alias?.location.href,document:document.defaultView.location.href,extracted:extracted.href,plain:({location:'plain'}).location,cookie:document.cookie};const channel=new MessageChannel();channel.port1.onmessage=e=>{window.portResult=e.data;channel.port1.close();channel.port2.close();};channel.port2.postMessage({value:'one argument'});const custom={postMessage(){window.messageArguments=arguments.length;}};custom.postMessage('value');document.querySelector('#alias-next').onclick=()=>alias.location.assign('/next?alias=yes');</script>`);}
    else if (url.pathname === '/resource-cookie') {res.setHeader('set-cookie','private_resource=yes; Path=/; HttpOnly');res.setHeader('content-type','text/html');res.end('<title>Resource cookie</title>');}
    else if (url.pathname.startsWith('/public-resource-')) {
      res.setHeader('access-control-allow-origin','*');res.setHeader('x-fixture-cookie',req.headers.cookie||'');res.setHeader('set-cookie','anonymous_asset=ignored; Path=/');
      if(url.pathname.endsWith('.js')){res.setHeader('content-type','text/javascript');res.end('window.publicResource='+JSON.stringify({cookie:req.headers.cookie||'',origin:req.headers.origin||'',authorization:req.headers.authorization||''})+';');}
      else if(url.pathname.endsWith('.css')){res.setHeader('content-type','text/css');res.end('@font-face{font-family:FixtureFont;src:url(/public-resource-font.woff2)}body{--resource-loaded:yes}');}
      else {res.setHeader('content-type','font/woff2');res.end('fixture-font-network-bytes');}
    }
    else if (url.pathname === '/app.js') { res.setHeader('content-type','text/javascript'); res.end(script); }
    else if (url.pathname === '/import-map') { res.setHeader('content-type','text/html');res.end('<title>Import maps</title><script type="importmap">{"imports":{"fixture-package":"/module.js","/remapped.js":"/module.js"},"scopes":{"/":{"scoped-package":"/module.js"}}}</script><script type="module">import {value} from "fixture-package";import {value as remapped} from "/remapped.js";import {value as scoped} from "scoped-package";window.importMapResult={value,remapped,scoped,url:import.meta.url};</script>'); }
    else if (url.pathname === '/module.js') { res.setHeader('content-type','text/javascript'); res.end('export const value="module-value";export const url=import.meta.url;'); }
    else if (url.pathname === '/worker.js') { res.setHeader('content-type','text/javascript'); res.end('importScripts("/worker-import.js");fetch("/api/echo").then(r=>r.json()).then(r=>postMessage({value:"worker-value",method:r.method,imported:self.imported}));'); }
    else if (url.pathname === '/worker-import.js') { res.setHeader('content-type','text/javascript'); res.end('self.imported="imported-value";'); }
    else if (url.pathname === '/module-worker.js') { res.setHeader('content-type','text/javascript'); res.end('import {value} from "/module.js";postMessage(value);'); }
    else if (url.pathname === '/pixel.svg') { res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'); }
    else if (url.pathname === '/api/echo' || url.pathname === '/protected/echo') {
      res.setHeader('content-type','application/json');res.setHeader('x-hidden','secret');res.setHeader('x-visible','public');res.setHeader('access-control-expose-headers','x-visible');
      if(url.searchParams.get('cors')==='yes') { res.setHeader('access-control-allow-origin',req.headers.origin||'*');res.setHeader('access-control-allow-credentials','true');res.setHeader('access-control-allow-methods','GET, POST, PUT, PATCH, DELETE');res.setHeader('access-control-allow-headers',req.headers['access-control-request-headers']||'content-type'); }
      res.end(JSON.stringify({method:req.method,body:Buffer.concat(chunks).toString(),cookie:req.headers.cookie||'',origin:req.headers.origin||'',authorization:req.headers.authorization||'',query:url.search}));
    }
    else if (url.pathname === '/cors-policy') { res.setHeader('access-control-allow-origin',req.headers.origin||'*');res.setHeader('access-control-allow-credentials','true');res.setHeader('access-control-allow-headers',url.searchParams.get('variant')==='named'?'x-fixture':'*');res.setHeader('access-control-allow-methods',url.searchParams.get('variant')==='named'?'GET':'*');res.end('cors-value'); }
    else if (url.pathname === '/shared-worker.js') { res.setHeader('content-type','text/javascript');res.end("onconnect=e=>{const port=e.ports[0];port.onmessage=()=>port.postMessage({url:location.href,name:'shared'});port.start()}"); }
    else if (url.pathname === '/cross-redirect') { res.writeHead(302,{location:'http://127.0.0.1:4040/api/echo?cors=yes','access-control-allow-origin':req.headers.origin||'*','access-control-allow-credentials':'true'}).end(); }
    else if (url.pathname === '/too-large-text') { res.setHeader('content-type','text/html');res.end('a'.repeat(5*1024*1024)); }
    else if (url.pathname === '/too-large-binary') { res.writeHead(200,{'content-type':'application/octet-stream','content-length':129*1024*1024});res.end(); }
    else if (url.pathname === '/download') { res.setHeader('content-type','application/octet-stream');res.setHeader('content-disposition','attachment; filename="fixture.bin"');res.end(Buffer.from([0,1,2,255])); }
    else if (url.pathname === '/audio.wav') { const wav=Buffer.alloc(44+1600);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(1600,40);res.setHeader('content-type','audio/wav');res.end(wav); }
    else if (url.pathname === '/reconnect') { res.writeHead(200,{'content-type':'text/event-stream'});res.end(`retry: 25\nid: ${Number(req.headers['last-event-id']||0)+1}\ndata: reconnect\n\n`); }
    else if (url.pathname === '/site-worker.js') { res.setHeader('content-type','text/javascript');res.end("self.skipWaiting();addEventListener('activate',event=>event.waitUntil(clients.claim()));addEventListener('fetch',event=>{if(new URL(event.request.url).pathname==='/sw-resource')event.respondWith(new Response('worker-response'));});addEventListener('message',event=>event.waitUntil(clients.matchAll({includeUncontrolled:true,type:'window'}).then(values=>event.ports[0].postMessage(values.map(client=>client.url)))));"); }
    else if (url.pathname === '/module-site-worker.js') { res.setHeader('content-type','text/javascript');res.end("import {value} from '/module.js';self.skipWaiting();addEventListener('activate',event=>event.waitUntil(clients.claim()));addEventListener('fetch',event=>{if(new URL(event.request.url).pathname==='/module-sw-resource')event.respondWith(new Response(value));});"); }
    else if (url.pathname === '/generated') { res.setHeader('content-type','text/html');res.end(`<title>Generated scripts</title><script>
      const __rax='author';const {location:aliased}=window;
      window.generated={collision:__rax,alias:aliased.href,evalURL:eval('location.href'),functionURL:new Function('return location.href')()};
      function lexical(location){return eval('location')};generated.lexical=lexical('local');
      const script=document.createElement('script');script.text='window.generated.inlineURL=location.href';document.head.append(script);
      setTimeout('window.generated.timerURL=location.href',0);
      </script>`); }
    else if (url.pathname === '/legacy') { res.setHeader('content-type','text/html; charset=windows-1252');res.end(Buffer.from('<title>caf\xe9</title><h1>caf\xe9</h1>', 'latin1')); }
    else if (url.pathname === '/upload') { res.setHeader('content-type','application/json');res.end(JSON.stringify({bytes:Buffer.concat(chunks).length,type:req.headers['content-type'],last:Buffer.concat(chunks).subarray(-16).toString()})); }
    else if (url.pathname === '/slow') { setTimeout(()=>{res.setHeader('content-type','text/plain');res.end('slow')},500); }
    else if (url.pathname === '/range') { const match=/bytes=(\d+)-(\d+)/.exec(req.headers.range||'');res.setHeader('content-type','application/octet-stream');if(match){res.statusCode=206;res.setHeader('content-range',`bytes ${match[1]}-${match[2]}/256`);res.end(Buffer.from(Array.from({length:Number(match[2])-Number(match[1])+1},(_,i)=>Number(match[1])+i)))}else res.end(Buffer.from(Array.from({length:256},(_,i)=>i))); }
    else if (url.pathname === '/form') { res.setHeader('content-type','text/html');res.end(`<title>Form result</title><h1>${Buffer.concat(chunks).toString()}</h1>`); }
    else if (url.pathname === '/redirect') { res.writeHead(302,{location:'/next'}).end(); }
    else if (url.pathname === '/unsafe-redirect') { res.writeHead(302,{location:'http://169.254.169.254/'}).end(); }
    else if (url.pathname === '/binary') { res.setHeader('content-type','application/octet-stream');res.end(Buffer.from([0,1,2,255])); }
    else if (url.pathname === '/large') { res.setHeader('content-type','application/octet-stream'); for(let i=0;i<32;i++)res.write(Buffer.alloc(256*1024,42));res.end(); }
    else if (url.pathname === '/events') { res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: stream-value\n\n'); }
    else if (url.pathname === '/cookie') { res.setHeader('set-cookie',['server=yes; Path=/; HttpOnly','secret_path=yes; Path=/protected; HttpOnly','visible=yes; Path=/; SameSite=Lax']);res.setHeader('content-type','text/html');res.end(html); }
    else if (url.pathname === '/next') { res.setHeader('content-type','text/html');res.end('<title>Next fixture</title><h1>Next page</h1><a href="/">Home</a>'); }
    else if (url.pathname === '/frame') { res.setHeader('content-type','text/html');res.end('<title>Frame fixture</title><iframe src="http://127.0.0.1:4040/child"></iframe><script>addEventListener("message",e=>{window.messageResult={data:e.data,origin:e.origin}})</script>'); }
    else if (url.pathname === '/child') { res.setHeader('content-type','text/html');res.end('<script>parent.postMessage("child-value","http://localhost:4040")</script>'); }
    else { res.setHeader('content-type','text/html'); res.end(html); }
  });
  const ws = new WebSocketServer({ server, path:'/socket', handleProtocols: protocols => protocols.has('echo') ? 'echo' : false });
  ws.on('connection',socket=>{socket.on('message',(data,binary)=>data.toString()==='close-me'?socket.close(4001,'fixture-close'):socket.send(data,{binary}));socket.ping('control');socket.on('pong',data=>{if(data.toString()==='control')socket.controlVerified=true;});});
  server.listen(port,'0.0.0.0',()=>console.log(`Raxcalite fixtures: ${port}`)); return server;
}
if(process.argv[1]?.endsWith('server.mjs')) startFixtures();
