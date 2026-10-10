import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { startTransformer } from './transformer.mjs';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const env = { ...process.env, RAX_TRANSFORM_TOKEN: process.env.RAX_TRANSFORM_TOKEN || randomBytes(32).toString('hex') };
if (!process.argv.includes('--shared') && !env.RAX_PROXY_ORIGIN) {
  env.RAX_ISOLATION_DOMAIN ||= 'rax.localhost';
  env.RAX_APP_ORIGIN ||= `http://app.${env.RAX_ISOLATION_DOMAIN}:${env.RAX_APP_PORT || 3030}`;
  env.RAX_PROXY_ORIGIN ||= `http://${env.RAX_ISOLATION_DOMAIN}:${env.RAX_PROXY_PORT || 3031}`;
}

async function run(command, args) { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: 'inherit', env, shell: false }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); }); }
await run(process.execPath, ['tools/build.mjs']);
const transformer = startTransformer(Number(env.RAX_TRANSFORM_PORT || 3032), env.RAX_TRANSFORM_TOKEN);
const server = spawn('cargo', ['run', ...(process.argv.includes('--release') ? ['--release'] : [])], { stdio: 'inherit', env });
server.on('exit', code => { transformer.close(); process.exitCode = code || 0; });
function stop() { server.kill(); transformer.close(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
