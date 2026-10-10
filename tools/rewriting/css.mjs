import { transform, transformStyleAttribute } from 'lightningcss';
import { encodeURL } from '../../shared/url.mjs';
export function rewriteCSS(source, url, inline = false) {
  const options = {
    filename: url, code: Buffer.from(source), minify: false,
    visitor: {
      Url(value) { return { ...value, url: encodeURL(value.url, url) }; },
      Image(image) {
        if (image.type !== 'image-set') return;
        return { ...image, value: { ...image.value, options: image.value.options.map(option => {
          const result = { ...option };
          if (result.fileType === null) delete result.fileType;
          if (result.image.type === 'url') result.image = { ...result.image, value: { ...result.image.value, url: encodeURL(result.image.value.url, url) } };
          return result;
        }) } };
      },
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
