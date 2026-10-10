import { runtime, root, config, setConfig, map, unmap, report, currentURL, type RuntimeConfig } from './core/context';
import { installNetwork } from './network';
import { installStorage } from './storage';
import { installWorkers } from './workers';
import { installScripts } from './dom/scripts';
function initialize(value: RuntimeConfig) {
  if (config) return;
  setConfig({ ...value, worker: true });
  const virtual = new URL(value.url);
  const location = new Proxy(virtual, {
    get(target, key) { const result = Reflect.get(target, key, target); return typeof result === 'function' ? result.bind(target) : result; },
    set() { throw new TypeError('Worker location is read-only'); }
  });
  Object.assign(runtime, { initialize, map, unmap, report, currentURL, location,
    mapImport: (input: string, base: string) => /^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(input) ? map(input, base) : input,
    postMessage: (target: any, ...args: any[]) => target.postMessage(...args) });
  installNetwork(); installStorage(); installWorkers(); installScripts();
}
runtime.initialize = initialize;
if (root.__RAX_CONFIG__) initialize(root.__RAX_CONFIG__);
