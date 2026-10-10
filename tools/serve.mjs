import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { startTransformer } from './transformer.mjs';
const env={...process.env,RAX_TRANSFORM_TOKEN:process.env.RAX_TRANSFORM_TOKEN||randomBytes(32).toString('hex')};
const transformer=startTransformer(Number(env.RAX_TRANSFORM_PORT||3032),env.RAX_TRANSFORM_TOKEN);
const server=spawn(process.env.RAX_BINARY||'./raxcalite',[],{stdio:'inherit',env,windowsHide:true});
server.on('error',error=>{console.error(error.message);transformer.close();process.exitCode=1});
server.on('exit',code=>{transformer.close();process.exitCode=code||0});
process.on('SIGINT',()=>{server.kill();transformer.closeAllConnections();transformer.close()});process.on('SIGTERM',()=>{server.kill();transformer.closeAllConnections();transformer.close()});
