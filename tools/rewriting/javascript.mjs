import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generatorModule from '@babel/generator';
import * as t from '@babel/types';
import { encodeURL } from '../../shared/url.mjs';
const traverse = traverseModule.default || traverseModule;
const generate = generatorModule.default || generatorModule;
const runtime = key => t.memberExpression(t.identifier('__rax'), t.identifier(key));

export function rewriteJS(source, url, options = {}) {
  const ast = parse(source, { sourceType: 'unambiguous', allowReturnOutsideFunction: !!options.inlineHandler,
    plugins: ['importAttributes'], createImportExpressions: true });
  let changed = false;
  const map = value => /^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(value) ? encodeURL(value, url) : value;
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property, { name: 'postMessage' })) {
        path.replaceWith(t.callExpression(runtime('postMessage'), [callee.object, ...path.node.arguments])); changed = true; path.skip();
      }
    },
    Identifier(path) {
      if (path.node.name !== 'location' || path.scope.hasBinding('location', true)) return;
      if (path.isReferencedIdentifier() || (path.parentPath.isAssignmentExpression() && path.key === 'left')) {
        path.replaceWith(runtime('location')); changed = true; path.skip();
      }
    },
    MemberExpression(path) {
      const n = path.node;
      const prop = n.computed && t.isStringLiteral(n.property) ? n.property.value : !n.computed && t.isIdentifier(n.property) ? n.property.name : '';
      if (prop === 'location' && t.isIdentifier(n.object) && ['window', 'self', 'globalThis', 'document'].includes(n.object.name) && !path.scope.hasBinding(n.object.name, true)) {
        path.replaceWith(runtime('location')); changed = true; path.skip();
      } else if (prop === 'url' && t.isMetaProperty(n.object) && n.object.meta.name === 'import') {
        path.replaceWith(t.stringLiteral(url)); changed = true;
      }
    },
    ImportDeclaration(path) { path.node.source.value = map(path.node.source.value); changed = true; },
    ExportNamedDeclaration(path) { if (path.node.source) { path.node.source.value = map(path.node.source.value); changed = true; } },
    ExportAllDeclaration(path) { path.node.source.value = map(path.node.source.value); changed = true; },
    ImportExpression(path) {
      path.node.source = t.callExpression(runtime('mapImport'), [path.node.source, t.stringLiteral(url)]); changed = true;
      path.skip();
    }
  });
  if (!changed && !options.sourceMaps) return { code: source, map: null };
  return generate(ast, { sourceMaps: !!options.sourceMaps, sourceFileName: url, comments: true, retainLines: true }, source);
}
