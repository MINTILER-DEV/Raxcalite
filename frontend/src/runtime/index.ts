import { root, config, setConfig, map, unmap, report, currentURL, type RuntimeConfig } from './core/context';
import { installLocation } from './location';
import { installNetwork } from './network';
import { installStorage } from './storage';
import { installWorkers } from './workers';
import { installNavigation } from './navigation';
import { installCookies } from './cookies';
import { installDOM } from './dom';
import { installFrames } from './frames';

function initialize(value: RuntimeConfig) {
  if (config) return;
  setConfig(value);
  root.__rax = { initialize, map, unmap, report, currentURL };
  if (!value.worker) installLocation();
  else root.__rax.location = new URL(value.url);
  installNetwork(); installStorage(); installWorkers();
  if (!value.worker) { installCookies(); installDOM(); installNavigation(); installFrames(); }
}
root.__rax = { initialize };
if (root.__RAX_CONFIG__) initialize(root.__RAX_CONFIG__);
