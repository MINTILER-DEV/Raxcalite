// Loopback-only test gateway. It verifies TLS, Host preservation, streaming and
// upgrades; production gateways must additionally authenticate and rate-limit.
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
mkdirSync('local/tls',{recursive:true});
if(!existsSync('local/tls/cert.pem')) {
  const result=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-keyout','local/tls/key.pem','-out','local/tls/cert.pem','-subj','/CN=rax.localhost','-addext','subjectAltName=DNS:rax.localhost,DNS:*.rax.localhost'],{stdio:'ignore',windowsHide:true});
  if(result.status!==0)throw new Error('OpenSSL is required for HTTPS fixture certificates');
}
const port=host=>host.startsWith('app.rax.localhost:')?3050:3051;
const server=https.createServer({key:readFileSync('local/tls/key.pem'),cert:readFileSync('local/tls/cert.pem')},(req,res)=>{
  if(req.url==='/gateway-ready'){res.writeHead(200).end('ready');return;}
  const upstream=http.request({hostname:'127.0.0.1',port:port(req.headers.host||''),path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Gateway transport failed')});req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy()});req.pipe(upstream);
});
server.on('upgrade',(req,socket,head)=>{
  const upstream=net.connect(port(req.headers.host||''),'127.0.0.1',()=>{
    const headers=[];for(let i=0;i<req.rawHeaders.length;i+=2)headers.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}`);
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`);if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
  });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
});
server.listen(3443,'127.0.0.1',()=>console.log('Raxcalite HTTPS fixture: 3443'));
