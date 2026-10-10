import { runtime, root, config, setConfig, map, unmap, report, currentURL, type RuntimeConfig } from './core/context';
import { installLocation } from './location';
import { installNetwork } from './network';
import { installStorage } from './storage';
import { installWorkers } from './workers';
import { installNavigation } from './navigation';
import { installCookies } from './cookies';
import { installDOM } from './dom';
import { installFrames } from './frames';
import { installScripts } from './dom/scripts';

function initialize(value: RuntimeConfig) {
  if (config) return;
  setConfig(value);
  Object.assign(runtime, { initialize, map, unmap, report, currentURL,
    mapImport: (input: string, base: string) => /^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(input) ? map(input, base) : input });
  if (value.worker) runtime.postMessage = (target: any, ...args: any[]) => target.postMessage(...args);
  if (!value.worker && navigator.serviceWorker) navigator.serviceWorker.register('/sw.js').catch(() => report('workers', 'Proxy routing worker could not initialize'));
  if (!value.worker) installLocation();
  else runtime.location = new URL(value.url);
  installNetwork(); installStorage(); installWorkers();
  if (!value.worker) { installCookies(); installScripts(); installDOM(); installNavigation(); installFrames(); }
  for (const warning of value.warnings || []) report('rewriting', warning);
}
runtime.initialize = initialize;
if (root.__RAX_CONFIG__) initialize(root.__RAX_CONFIG__);
