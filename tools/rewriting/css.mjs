import { transform, transformStyleAttribute } from 'lightningcss';
import { encodeURL } from '../../shared/url.mjs';
export function rewriteCSS(source, url, inline = false) {
  const options = {
    filename: url, code: Buffer.from(source), minify: false,
    visitor: {
      Url(value) { return { ...value, url: encodeURL(value.url, url) }; },
      Rule: { import(rule) {
        const value = { ...rule.value, url: encodeURL(rule.value.url, url) };
        // Lightning CSS emits null for absent optional fields; its visitor input expects omission.
        if (value.layer === null) delete value.layer;
        if (value.supports === null) delete value.supports;
        return { ...rule, value };
      } }
    }
  };
  return (inline ? transformStyleAttribute(options) : transform(options)).code.toString();
}
