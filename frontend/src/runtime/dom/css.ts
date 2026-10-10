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
  for (const key of ['background', 'backgroundImage', 'listStyle', 'listStyleImage', 'cursor', 'mask', 'maskImage', 'borderImage', 'borderImageSource', 'content'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, key);
    if (descriptor?.set) Object.defineProperty(CSSStyleDeclaration.prototype, key, { ...descriptor, set(value) { descriptor.set!.call(this, rewriteStyle(String(value), 'value')); } });
  }
  const insertRule = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function(rule, index) { return insertRule.call(this, rewriteStyle(rule), index); };
  if (CSSStyleSheet.prototype.replace) { const replace = CSSStyleSheet.prototype.replace; CSSStyleSheet.prototype.replace = function(text) { return replace.call(this, rewriteStyle(text)); }; }
  if (CSSStyleSheet.prototype.replaceSync) { const replaceSync = CSSStyleSheet.prototype.replaceSync; CSSStyleSheet.prototype.replaceSync = function(text) { return replaceSync.call(this, rewriteStyle(text)); }; }
}
