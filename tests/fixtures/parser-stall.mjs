import { parentPort } from 'node:worker_threads';
parentPort.on('message', input => { if (input.stall) while (true) {} else parentPort.postMessage({ result: 'recovered' }); });
