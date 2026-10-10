import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generatorModule from '@babel/generator';
import * as t from '@babel/types';
import { encodeURL } from '../../shared/url.mjs';
import { rewriteLargeJS } from './large-javascript.mjs';
const traverse = traverseModule.default || traverseModule;
const generate = generatorModule.default || generatorModule;
const runtime = key => t.memberExpression(t.identifier('__RAX_RUNTIME_v1__'), t.identifier(key));

export function rewriteJS(source, url, options = {}) {
  if(source.length > 512 * 1024) return rewriteLargeJS(source,url,options);
  const ast = parse(source, { sourceType: 'unambiguous', allowReturnOutsideFunction: !!options.inlineHandler,
    plugins: ['importAttributes'], createImportExpressions: true });
  let changed = false;
  // Keep ordinary globalThis/__rax bindings intact. Only the reserved runtime
  // identifier is renamed if an author happens to declare that exact name.
  traverse(ast, { Scope(path) { if (path.scope.hasOwnBinding('__RAX_RUNTIME_v1__')) path.scope.rename('__RAX_RUNTIME_v1__', path.scope.generateUid('runtime')); } });
  const bound = (path, name) => path.scope.hasBinding(name, true) || options.shadowedNames?.includes(name);
  const map = value => /^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(value) ? encodeURL(value, url) : value;
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (t.isIdentifier(callee, { name: 'eval' }) && !bound(path, 'eval') && path.node.arguments.length) {
        path.node.arguments[0] = t.callExpression(runtime('rewriteScript'), [path.node.arguments[0], t.arrayExpression(Object.keys(path.scope.getAllBindings()).map(n => t.stringLiteral(n)))]); changed = true;
      }
      const prop = t.isMemberExpression(callee) ? callee.computed && t.isStringLiteral(callee.property) ? callee.property.value : !callee.computed && t.isIdentifier(callee.property) ? callee.property.name : '' : '';
      if (prop === 'postMessage' && !t.isIdentifier(callee.object,{name:'__RAX_RUNTIME_v1__'})) {
        path.replaceWith(t.callExpression(runtime('postMessage'), [callee.object, ...path.node.arguments])); changed = true;
      }
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.object, { name: 'Reflect' }) && !bound(path, 'Reflect') && ['get', 'set'].includes(callee.property.name) && t.isStringLiteral(path.node.arguments[1], { value: 'location' })) {
        path.node.arguments[0] = t.callExpression(runtime('locationObject'), [path.node.arguments[0]]); changed = true;
      }
    },
    OptionalCallExpression(path) {
      const callee = path.node.callee;
      if (!t.isOptionalMemberExpression(callee) && !t.isMemberExpression(callee)) return;
      const name = callee.computed && t.isStringLiteral(callee.property) ? callee.property.value : !callee.computed && t.isIdentifier(callee.property) ? callee.property.name : '';
      if (name !== 'postMessage') return;
      const receiver = path.scope.generateUidIdentifier('messageTarget'); path.scope.push({ id: receiver });
      const assign = t.assignmentExpression('=', t.cloneNode(receiver), callee.object);
      const missingTarget = t.binaryExpression('==', t.cloneNode(receiver), t.nullLiteral());
      const missingMethod = t.binaryExpression('==', t.memberExpression(t.cloneNode(receiver), t.identifier('postMessage')), t.nullLiteral());
      const guard = callee.optional && path.node.optional ? t.logicalExpression('||', missingTarget, missingMethod) : callee.optional ? missingTarget : missingMethod;
      path.replaceWith(t.sequenceExpression([assign, t.conditionalExpression(guard, t.unaryExpression('void', t.numericLiteral(0)), t.callExpression(runtime('postMessage'), [t.cloneNode(receiver), ...path.node.arguments]))])); changed = true;
    },
    Identifier(path) {
      if (path.node.name !== 'location' || bound(path, 'location')) return;
      if (path.isReferencedIdentifier() || (path.parentPath.isAssignmentExpression() && path.key === 'left')) {
        path.replaceWith(runtime('location')); changed = true; path.skip();
      }
    },
    MemberExpression(path) {
      const n = path.node;
      const prop = n.computed && t.isStringLiteral(n.property) ? n.property.value : !n.computed && t.isIdentifier(n.property) ? n.property.name : '';
      if (prop === 'location' && t.isIdentifier(n.object) && ['window', 'self', 'globalThis', 'document'].includes(n.object.name) && !bound(path, n.object.name)) {
        path.replaceWith(runtime('location')); changed = true; path.skip();
      } else if (prop === 'location' && !t.isIdentifier(n.object,{name:'__RAX_RUNTIME_v1__'})) {
        n.object=t.callExpression(runtime('locationObject'),[n.object]); changed=true;
      } else if (prop === 'url' && t.isMetaProperty(n.object) && n.object.meta.name === 'import') {
        path.replaceWith(t.stringLiteral(url)); changed = true;
      }
    },
    OptionalMemberExpression(path) {
      const n=path.node;const prop=n.computed && t.isStringLiteral(n.property)?n.property.value:!n.computed && t.isIdentifier(n.property)?n.property.name:'';
      if(prop==='location' && !t.isIdentifier(n.object,{name:'__RAX_RUNTIME_v1__'})){n.object=t.callExpression(runtime('locationObject'),[n.object]);changed=true;}
    },
    VariableDeclarator(path) {
      if (!t.isObjectPattern(path.node.id) || !path.node.init) return;
      // A proxy preserves all other destructured keys and evaluates getters once.
      if (path.node.id.properties.some(p => t.isObjectProperty(p) && (t.isIdentifier(p.key, {name:'location'}) || t.isStringLiteral(p.key, {value:'location'})))) {
        path.node.init = t.callExpression(runtime('locationObject'), [path.node.init]); changed = true;
      }
    },
    ImportDeclaration(path) { path.node.source.value = map(path.node.source.value); changed = true; },
    ExportNamedDeclaration(path) { if (path.node.source) { path.node.source.value = map(path.node.source.value); changed = true; } },
    ExportAllDeclaration(path) { path.node.source.value = map(path.node.source.value); changed = true; },
    ImportExpression(path) {
      path.node.source = t.callExpression(runtime('mapImport'), [path.node.source, t.stringLiteral(url)]); changed = true;
    }
  });
  if (!changed && !options.sourceMaps) return { code: source, map: null };
  return generate(ast, { sourceMaps: !!options.sourceMaps, sourceFileName: url, comments: true, retainLines: true }, source);
}
export function rewriteFunction(args, url, {async=false,generator=false}={}) {
  const values = args.map(String); const body = values.pop() || '';
  const transformed = rewriteJS(`${async?'async ':''}function${generator?'*':''} anonymous(${values.join(',')}\n){${body}\n}`, url).code;
  const fn = parse(transformed).program.body[0];
  return [...fn.params.map(p => generate(p).code), generate(fn.body).code.slice(1, -1)];
}
