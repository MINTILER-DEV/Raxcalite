import { fork } from 'node:child_process';
// Parsing runs outside the HTTP event loop. A deadline kills the entire isolate,
// including a parser that never yields. Limits also bound queued source buffers.
export class TransformPool {
  constructor({ size = 4, deadline = 10000, workerURL = new URL('./transform-worker.mjs', import.meta.url) } = {}) {
    this.size = size; this.deadline = deadline; this.workerURL = workerURL;
    this.slots = new Set(); this.queue = []; this.closed = false;
  }
  get active() { return [...this.slots].filter(s => s.task).length; }
  run(input, signal) {
    if (this.closed || signal?.aborted) return Promise.reject(new Error('Transformer stopped'));
    if (this.active >= this.size && this.queue.length >= 8) return Promise.reject(new Error('Transformer queue full'));
    return new Promise((resolve, reject) => {
      const task = { input, resolve, reject, signal };
      task.cancel = () => this.finish(task, new Error('Transform cancelled or timed out'));
      task.timer = setTimeout(task.cancel, this.deadline);
      signal?.addEventListener('abort', task.cancel, { once: true });
      this.queue.push(task); this.dispatch();
    });
  }
  dispatch() {
    while (this.queue.length && !this.closed) {
      let slot = [...this.slots].find(s => !s.task);
      if (!slot && this.slots.size < this.size) {
        slot = { worker: fork(this.workerURL, [], { execArgv:['--max-old-space-size=192'], stdio:['ignore','ignore','ignore','ipc'] }) };
        this.slots.add(slot);
        slot.worker.on('message', message => { slot.rss=message.rss||0; if (slot.task) this.finish(slot.task, message.error ? new Error(message.error) : null, message.result); });
        slot.worker.on('error', () => { if (slot.task) this.finish(slot.task, new Error('Parser worker failed')); });
        slot.worker.on('exit', () => { this.slots.delete(slot); if (slot.task) this.finish(slot.task, new Error('Parser worker exited')); this.dispatch(); });
      }
      if (!slot) return;
      const task = this.queue.shift(); slot.task = task; task.slot = slot; slot.worker.send(task.input);
    }
  }
  finish(task, error, result) {
    if (task.done) return; task.done = true;
    clearTimeout(task.timer); task.signal?.removeEventListener('abort', task.cancel);
    if (task.slot) {
      task.slot.task = null;
      if (error) { this.slots.delete(task.slot); task.slot.worker.kill('SIGKILL'); }
    } else this.queue = this.queue.filter(t => t !== task);
    if (error) task.reject(error); else task.resolve(result);
    this.dispatch();
  }
  close() {
    this.closed = true;
    for (const task of [...this.queue, ...[...this.slots].map(s => s.task).filter(Boolean)]) this.finish(task, new Error('Transformer stopped'));
    for (const slot of this.slots) slot.worker.kill('SIGKILL'); this.slots.clear();
  }
}
