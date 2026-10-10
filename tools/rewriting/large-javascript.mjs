import {parse} from 'acorn';
import {analyze} from 'eslint-scope';
import MagicString from 'magic-string';
import {encodeURL} from '../../shared/url.mjs';

// Source-range edits avoid Babel's per-node traversal paths and full regeneration
// for large bundles. Scope analysis still decides which identifiers are globals.
export function rewriteLargeJS(source,url,options={}) {
  const parseOptions={ecmaVersion:'latest',ranges:true,allowReturnOutsideFunction:!!options.inlineHandler};
  let ast;
  try {ast=parse(source,{...parseOptions,sourceType:'script'});} catch {ast=parse(source,{...parseOptions,sourceType:'module'});}
  let manager=analyze(ast,{ecmaVersion:2025,sourceType:ast.sourceType,optimistic:true,ignoreEval:true});
  const references=new WeakSet(),evalScopes=new WeakMap(),names=new Set();
  for(const scope of manager.scopes){for(const v of scope.variables)names.add(v.name);for(const ref of scope.references){
    if(!ref.resolved)references.add(ref.identifier);
    if(ref.identifier.name==='eval' && !ref.resolved){const shadowed=new Set(options.shadowedNames||[]);for(let current=ref.from;current;current=current.upper)for(const v of current.variables)shadowed.add(v.name);evalScopes.set(ref.identifier,[...shadowed]);}
    names.add(ref.identifier.name);
  }}
  const free=node=>node?.type==='Identifier' && references.has(node) && !options.shadowedNames?.includes(node.name);
  const edits=new MagicString(source);let changed=false;
  const overwrite=(start,end,text)=>{if(start===end)edits.appendLeft(start,text);else edits.overwrite(start,end,text);changed=true;};
  const wrap=(node,before,after)=>{edits.appendLeft(node.start,before);edits.appendRight(node.end,after);changed=true;};
  const prop=node=>node?.type==='MemberExpression' ? node.computed ? node.property.type==='Literal'?node.property.value:'' : node.property.name : '';
  function walk(node,parent,visit){
    if(!node || typeof node.type!=='string')return;
    visit(node,parent);
    for(const [key,value] of Object.entries(node)) {
      if(key==='parent'||key==='range')continue;
      if(Array.isArray(value)){for(const child of value)if(child?.type)walk(child,node,visit);}else if(value?.type)walk(value,node,visit);
    }
  }
  // A reserved author binding must not capture injected helpers. Rename only its
  // definitions/references, retaining shorthand property names.
  let serial=0;
  const unique=()=>{let name;do{name=`_raxBundle${serial++}`;}while(names.has(name));names.add(name);return name;};
  const replacements=new WeakMap();
  for(const scope of manager.scopes)for(const variable of scope.variables)if(variable.name==='__RAX_RUNTIME_v1__'){
    const name=unique();for(const id of variable.identifiers)replacements.set(id,name);for(const ref of variable.references)replacements.set(ref.identifier,name);
  }
  manager=null;
  const rt='__RAX_RUNTIME_v1__',temps=[];
  const map=value=>/^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(value)?encodeURL(value,url):value;
  walk(ast,null,(node,parent)=>{
    if(node.type==='Identifier'){
      let text=replacements.get(node);
      if(!text && ['location','parent','top'].includes(node.name) && free(node))text=`${rt}.${node.name}`;
      if(text){
        if(parent?.type==='Property' && parent.shorthand && (node===parent.value || node===parent.key)) {
          // Acorn represents a shorthand key/value with distinct nodes at the
          // same source span. The reference/definition carries the replacement.
          if(node===parent.value)overwrite(node.start,node.end,`${node.name}:${text}`);
        }else overwrite(node.start,node.end,text);
      }
    }
    if(node.type==='MemberExpression') {
      const key=prop(node),object=node.object;
      if(key==='location' && ['window','self','globalThis','document'].includes(object.name) && free(object)) {
        overwrite(node.start,node.end,`${rt}.location`);
      } else if(['parent','top'].includes(key) && ['window','self','globalThis'].includes(object.name) && free(object)) {
        overwrite(node.start,node.end,`${rt}.${key}`);
      } else if(['location','parent','top'].includes(key) && object.name!==rt) {
        wrap(object,`${rt}.locationObject(`,')');
      } else if(key==='url' && object.type==='MetaProperty' && object.meta.name==='import')overwrite(node.start,node.end,JSON.stringify(url));
    }
    if(node.type==='VariableDeclarator' && node.id.type==='ObjectPattern' && node.init && node.id.properties.some(p=>['location','parent','top'].includes(p.key?.name||p.key?.value)))wrap(node.init,`${rt}.locationObject(`,')');
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type) && node.source)overwrite(node.source.start,node.source.end,JSON.stringify(map(node.source.value)));
    if(node.type==='ImportExpression')wrap(node.source,`${rt}.mapImport(`,`,${JSON.stringify(url)})`);
    if(node.type!=='CallExpression')return;
    const callee=node.callee;
    if(callee.type==='Identifier' && callee.name==='eval' && free(callee) && node.arguments.length && node.arguments[0].type!=='SpreadElement') {
      wrap(node.arguments[0],`${rt}.rewriteScript(`,`,${JSON.stringify(evalScopes.get(callee)||[])})`);
    }
    if(prop(callee)==='postMessage' && callee.object.name!==rt) {
      const object=callee.object,first=node.arguments[0]?.start??node.end-1;
      if(callee.optional || node.optional){
        const temp=unique();temps.push(temp);
        overwrite(node.start,object.start,`(${temp}=(`);
        const guard=[...(callee.optional?[`${temp}==null`]:[]),...(node.optional?[`${temp}.postMessage==null`]:[])].join('||');
        overwrite(object.end,first,`),${guard}?void 0:${rt}.postMessage(${temp}${node.arguments.length?',':''}`);
        edits.appendRight(node.end,')');
      }else{
        overwrite(node.start,object.start,`${rt}.postMessage((`);
        overwrite(object.end,first,`)${node.arguments.length?',':''}`);
      }
    }
    if(callee.type==='MemberExpression' && callee.object.name==='Reflect' && free(callee.object) && ['get','set'].includes(prop(callee)) && ['location','parent','top'].includes(node.arguments[1]?.value))wrap(node.arguments[0],`${rt}.locationObject(`,')');
  });
  if(temps.length){const directives=ast.body.filter(n=>n.type==='ExpressionStatement' && n.directive);const start=directives.at(-1)?.end??(source.startsWith('#!')?source.indexOf('\n')+1:0);edits.appendRight(start,`;var ${temps.join(',')};`);}
  return {code:changed?edits.toString():source,map:options.sourceMaps?JSON.parse(edits.generateMap({source:url,includeContent:true,hires:true}).toString()):null};
}
