import { rewriteJS, rewriteFunction } from '../../../../tools/rewriting/javascript.mjs';
import { runtime, currentURL, report } from '../core/context';
export function installScripts() {
  const rewrite = (source: unknown, shadowedNames: string[] = []) => {
    if (typeof source !== 'string') return source;
    try { return rewriteJS(source, currentURL(), { shadowedNames, inlineHandler: true }).code; }
    catch { report('javascript', 'Generated script could not be transformed'); throw new SyntaxError('Generated script transformation failed'); }
  };
  runtime.rewriteScript = rewrite;
  const constructors=[
    {value:globalThis.Function,async:false,generator:false},
    {value:Object.getPrototypeOf(async function(){}).constructor,async:true,generator:false},
    {value:Object.getPrototypeOf(function*(){}).constructor,async:false,generator:true},
    {value:Object.getPrototypeOf(async function*(){}).constructor,async:true,generator:true},
  ];
  for(const {value:Constructor,async,generator} of constructors){
    const wrap=(args:any[])=>{try{return rewriteFunction(args,currentURL(),{async,generator});}catch(error){report('javascript','Generated function could not be transformed');throw error;}};
    const proxy=new Proxy(Constructor,{
      apply(target,receiver,args){return Reflect.apply(target,receiver,wrap(args));},
      construct(target,args,newTarget){return Reflect.construct(target,wrap(args),newTarget);},
    });
    Object.defineProperty(Constructor.prototype,'constructor',{...Object.getOwnPropertyDescriptor(Constructor.prototype,'constructor'),value:proxy});
    if(!async && !generator)globalThis.Function=proxy;
  }
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
