const urls=new Set(['href','src','action','formaction','poster','data','background','xlink:href','cite']);
export function isURLAttribute(tag,name) {
  return urls.has(name) && (name!=='data' || tag.toLowerCase()==='object');
}
// Binding expressions are interpreted by the page's template system. Concrete
// values pass through the normal DOM setters after the framework resolves them.
export function isTemplateBinding(value) {
  return /\{\{[\s\S]*?\}\}|\[\[[\s\S]*?\]\]/.test(String(value));
}
