import { currentURL, native, unmap, config, map } from '../core/context';
import { nativeOrigin } from '../../../../shared/native-origin.mjs';
export function installFrames() {
  // postMessage remains native. Envelopes carry virtual sender/target origins to mapped receivers.
  const original = native.postMessage!;
  globalThis.__rax.postMessage = function(targetWindow: Window | MessagePort | Worker, message: any, targetOrigin: string | WindowPostMessageOptions = '/', transfer?: Transferable[]) {
    const isWindow = targetWindow === window || targetWindow === parent || targetWindow === top || Object.prototype.toString.call(targetWindow) === '[object Window]';
    if (!isWindow) return (targetWindow.postMessage as any)(message, targetOrigin, transfer);
    const expected = typeof targetOrigin === 'string' ? targetOrigin : targetOrigin.targetOrigin ?? '/';
    const target = expected === '/' ? new URL(currentURL()).origin : expected;
    const payload = { __rax_message__: true, sender: new URL(currentURL()).origin, target, payload: message };
    const actualTarget = config.isolation ? target === '*' ? '*' : new URL(map(target)).origin : native.location.origin;
    return original.call(targetWindow as Window, payload, actualTarget, transfer || (typeof targetOrigin === 'object' ? targetOrigin.transfer : undefined) || []);
  };
  addEventListener('message', event => {
    const envelope = event.data;
    if (envelope?.type?.startsWith?.('rax:')) {
      event.stopImmediatePropagation();
      if (envelope.type === 'rax:diagnostic' && parent !== window) original.call(parent, envelope, '*');
      return;
    }
    if (!envelope || envelope.__rax_message__ !== true) return;
    if (config.isolation && event.origin !== nativeOrigin(envelope.sender, config.isolation)) { event.stopImmediatePropagation(); return; }
    if (envelope.target !== '*' && envelope.target !== new URL(currentURL()).origin) { event.stopImmediatePropagation(); return; }
    Object.defineProperty(event, 'data', { value: envelope.payload });
    Object.defineProperty(event, 'origin', { value: envelope.sender });
  }, true);
  // Parent location and arbitrary WindowProxy access cannot be securely emulated on shared origins.
  globalThis.__rax.frameOrigin = (frame: HTMLIFrameElement) => { try { return new URL(unmap(frame.src)).origin; } catch { return 'null'; } };
}
