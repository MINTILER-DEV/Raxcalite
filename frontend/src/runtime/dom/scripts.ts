import { rewriteJS, rewriteFunction } from '../../../../tools/rewriting/javascript.mjs';
import { runtime, currentURL, report, root } from '../core/context';
export function installScripts() {
  const rewrite = (source: unknown, shadowedNames: string[] = []) => {
    if (typeof source !== 'string') return source;
    try { return rewriteJS(source, currentURL(), { shadowedNames, inlineHandler: true }).code; }
    catch { report('javascript', 'Generated script could not be transformed'); throw new SyntaxError('Generated script transformation failed'); }
  };
  runtime.rewriteScript = rewrite;
  runtime.locationObject = (object: any) => object !== root && (typeof document === 'undefined' || object !== document) ? object : new Proxy(object, {
    get(target, key) { return key === 'location' ? runtime.location : Reflect.get(target, key, target); },
    set(target, key, value) { if (key === 'location') { runtime.location = value; return true; } return Reflect.set(target, key, value, target); }
  });
  const Constructor = globalThis.Function;
  globalThis.Function = new Proxy(Constructor, {
    apply(target, receiver, args) { return Reflect.apply(target, receiver, rewriteFunction(args, currentURL())); },
    construct(target, args, newTarget) { return Reflect.construct(target, rewriteFunction(args, currentURL()), newTarget); }
  });
  for (const name of ['setTimeout', 'setInterval'] as const) {
    const schedule = globalThis[name];
    globalThis[name] = ((handler: TimerHandler, ...args: any[]) => (schedule as any)(typeof handler === 'string' ? rewrite(handler) : handler, ...args)) as any;
  }
  if (typeof HTMLScriptElement === 'undefined') return;
  const executable = (script: HTMLScriptElement) => !script.type || ['module', 'text/javascript', 'application/javascript'].includes(script.type.toLowerCase());
  const text = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'text');
  if (text?.set) Object.defineProperty(HTMLScriptElement.prototype, 'text', { ...text, set(value: string) { text.set!.call(this, executable(this) ? rewrite(value) : value); } });
  const content = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!;
  Object.defineProperty(Node.prototype, 'textContent', { ...content, set(value: string) {
    content.set!.call(this, this instanceof HTMLScriptElement && executable(this) ? rewrite(value) : value);
  } });
}
