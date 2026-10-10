import { currentURL, native, unmap } from '../core/context';
export function installFrames() {
  // postMessage remains native. Envelopes carry virtual sender/target origins to mapped receivers.
  const original = native.postMessage!;
  globalThis.__rax.postMessage = function(targetWindow: Window | MessagePort | Worker, message: any, targetOrigin: string | WindowPostMessageOptions = '/', transfer?: Transferable[]) {
    if (!(targetWindow instanceof Window)) return (targetWindow.postMessage as any)(message, targetOrigin, transfer);
    const expected = typeof targetOrigin === 'string' ? targetOrigin : targetOrigin.targetOrigin ?? '/';
    const target = expected === '/' ? new URL(currentURL()).origin : expected;
    const payload = { __rax_message__: true, sender: new URL(currentURL()).origin, target, payload: message };
    return original.call(targetWindow, payload, native.location.origin, transfer || (typeof targetOrigin === 'object' ? targetOrigin.transfer : undefined) || []);
  };
  addEventListener('message', event => {
    const envelope = event.data;
    if (!envelope || envelope.__rax_message__ !== true) return;
    if (envelope.target !== '*' && envelope.target !== new URL(currentURL()).origin) { event.stopImmediatePropagation(); return; }
    Object.defineProperty(event, 'data', { value: envelope.payload });
    Object.defineProperty(event, 'origin', { value: envelope.sender });
  }, true);
  // Parent location and arbitrary WindowProxy access cannot be securely emulated on shared origins.
  globalThis.__rax.frameOrigin = (frame: HTMLIFrameElement) => { try { return new URL(unmap(frame.src)).origin; } catch { return 'null'; } };
}
