import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { startTransformer } from './transformer.mjs';
const env = { ...process.env, RAX_TRANSFORM_TOKEN: process.env.RAX_TRANSFORM_TOKEN || randomBytes(32).toString('hex') };
async function run(command, args) { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: 'inherit', env, shell: false }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); }); }
await run(process.execPath, ['tools/build.mjs']);
const transformer = startTransformer(Number(env.RAX_TRANSFORM_PORT || 3032), env.RAX_TRANSFORM_TOKEN);
const server = spawn('cargo', ['run', ...(process.argv.includes('--release') ? ['--release'] : [])], { stdio: 'inherit', env });
server.on('exit', code => { transformer.close(); process.exitCode = code || 0; });
function stop() { server.kill(); transformer.close(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
