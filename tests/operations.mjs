import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import {WebSocket} from 'ws';
import {startFixtures} from './fixtures/server.mjs';
import {startTransformer} from '../tools/transformer.mjs';
import {encodeURL} from '../shared/url.mjs';
const token=randomBytes(32).toString('hex'), origin='http://localhost:3061';
const fixtures=startFixtures(4060), transformer=startTransformer(3062,token);
const env={...process.env,RAX_APP_PORT:'3060',RAX_PROXY_PORT:'3061',RAX_TRANSFORM_PORT:'3062',RAX_APP_ORIGIN:'http://localhost:3060',RAX_PROXY_ORIGIN:origin,RAX_TRANSFORM_TOKEN:token,RAX_FIXTURE_HOSTS:'localhost'};delete env.RAX_ISOLATION_DOMAIN;
const server=spawn(process.platform==='win32'?'target/debug/raxcalite.exe':'target/debug/raxcalite',[],{windowsHide:true,stdio:'inherit',env});
const sockets=[];
try {
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(origin+'/ready')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'backend readiness');
  for(const encoding of ['gzip','br']){
    const response=await new Promise((resolve,reject)=>http.get(origin+'/runtime.js',{headers:{'accept-encoding':encoding}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({headers:r.headers,body:Buffer.concat(chunks)}));r.on('error',reject);}).on('error',reject));
    assert.equal(response.headers['content-encoding'],encoding);assert((encoding==='br'?brotliDecompressSync:gunzipSync)(response.body).length>10000);
  }
  console.log('gzip and Brotli response decoding passed');
  const bootstrap=await fetch(origin+'/api/session',{headers:{origin:'http://localhost:3060'}});const cookie=bootstrap.headers.get('set-cookie').split(';')[0];
  const connect=()=>new WebSocket(encodeURL('ws://localhost:4060/socket','ws://localhost:4060',origin).replace('http:','ws:'),{headers:{origin,cookie}});
  for(let i=0;i<8;i++){const socket=connect();sockets.push(socket);await once(socket,'open');}
  console.log('Eight concurrent session sockets opened');
  const rejected=connect();rejected.on('error',()=>{});const [request,response]=await once(rejected,'unexpected-response');
  assert.equal(response.statusCode,429);request.destroy();rejected.terminate();
  console.log('Ninth socket rejected with 429');
  sockets.pop().close();await new Promise(r=>setTimeout(r,300));const replacement=connect();sockets.push(replacement);await once(replacement,'open');
  for(const socket of sockets)socket.close();await new Promise(r=>setTimeout(r,300));
  const metrics=await(await fetch(origin+'/metrics',{headers:{authorization:`Bearer ${token}`}})).json();assert.equal(metrics.active,0);
  await new Promise(resolve=>{transformer.closeAllConnections();transformer.close(resolve);});assert.equal((await fetch(origin+'/ready')).status,503);
  if(process.platform!=='win32'){const exited=once(server,'exit');server.kill('SIGTERM');const [code]=await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('shutdown deadline')),12000).unref())]);assert.equal(code,0);}
  console.log('Operational compression, WebSocket quota cleanup, readiness and supported signal checks passed');
} finally {for(const socket of sockets)socket.terminate();server.kill();fixtures.closeAllConnections();fixtures.close();transformer.closeAllConnections();transformer.close();}
