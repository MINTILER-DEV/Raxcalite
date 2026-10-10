import { parse, walk, generate } from 'css-tree';
import { map, report } from '../core/context';
export function rewriteStyle(source: string, context: 'stylesheet' | 'declarationList' | 'value' = 'stylesheet'): string {
  if (!source.includes('url(') && !source.includes('@import') && !source.includes('image-set(')) return source;
  try {
    const ast = parse(source, { context, parseCustomProperty: true });
    walk(ast, function(node) {
      if (node.type === 'Url') node.value = map(node.value);
      if (node.type === 'String' && ((this.atrule?.name === 'import' && this.atrule.prelude) || this.function?.name.endsWith('image-set'))) node.value = map(node.value);
    });
    return generate(ast);
  } catch { report('css', 'Dynamic CSS could not be parsed'); return source; }
}
export function installCSS() {
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function(name, value, priority) { return setProperty.call(this, name, value ? rewriteStyle(value, 'value') : value, priority); };
  const cssText = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'cssText')!;
  Object.defineProperty(CSSStyleDeclaration.prototype, 'cssText', { ...cssText, set(value) { cssText.set!.call(this, rewriteStyle(String(value), 'declarationList')); } });
  // Firefox puts these accessors on CSSStyleProperties. Chromium exposes
  // named properties on each instance, which yield to an explicit prototype hook.
  const sample=document.createElement('div').style;
  const getPropertyValue=CSSStyleDeclaration.prototype.getPropertyValue;
  for (const camel of ['background', 'backgroundImage', 'listStyle', 'listStyleImage', 'cursor', 'mask', 'maskImage', 'borderImage', 'borderImageSource', 'content', 'filter', 'clipPath', 'offsetPath', 'shapeOutside', 'webkitMask', 'webkitMaskImage', 'webkitBorderImage']) {
    const cssName=camel.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase()).replace(/^webkit-/,'-webkit-');
    for(const key of new Set([camel,cssName])) {
      if(!(key in sample))continue;
      let owner=Object.getPrototypeOf(sample),descriptor:PropertyDescriptor|undefined;
      while(owner){descriptor=Object.getOwnPropertyDescriptor(owner,key);if(descriptor)break;owner=Object.getPrototypeOf(owner);}
      if(descriptor?.set)Object.defineProperty(owner,key,{...descriptor,set(value){descriptor!.set!.call(this,rewriteStyle(String(value),'value'));}});
      else Object.defineProperty(CSSStyleDeclaration.prototype,key,{configurable:true,enumerable:true,
        get(){return getPropertyValue.call(this,cssName);},
        set(value){setProperty.call(this,cssName,rewriteStyle(String(value),'value'));}
      });
    }
  }
  const insertRule = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function(rule, index) { return insertRule.call(this, rewriteStyle(rule), index); };
  if (CSSStyleSheet.prototype.replace) { const replace = CSSStyleSheet.prototype.replace; CSSStyleSheet.prototype.replace = function(text) { return replace.call(this, rewriteStyle(text)); }; }
  if (CSSStyleSheet.prototype.replaceSync) { const replaceSync = CSSStyleSheet.prototype.replaceSync; CSSStyleSheet.prototype.replaceSync = function(text) { return replaceSync.call(this, rewriteStyle(text)); }; }
}
