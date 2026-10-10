import { parse } from 'parse5';
export function decodeText(bytes, kind, contentType = '') {
  // WHATWG TextDecoder maps legacy labels (including ISO-8859-1) to browser encodings.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes);
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(bytes);
  const charset = value => /(?:^|;)\s*charset\s*=\s*["']?([^\s;"']+)/i.exec(value)?.[1];
  let label = charset(contentType);
  if (!label && kind === 'html') {
    const tree = parse(Buffer.from(bytes.subarray(0, 1024)).toString('latin1'));
    const visit = node => {
      if (node.tagName === 'meta' && !label) {
        const attrs = Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
        label = attrs.charset || (attrs['http-equiv']?.toLowerCase() === 'content-type' ? charset(attrs.content || '') : undefined);
      }
      for (const child of node.childNodes || []) visit(child);
    }; visit(tree);
  }
  if (!label && kind === 'css') label = /^@charset "([^"]+)";/.exec(Buffer.from(bytes.subarray(0, 100)).toString('latin1'))?.[1];
  let decoder;
  try { decoder = new TextDecoder(label || (kind === 'html' ? 'windows-1252' : 'utf-8')); }
  catch { decoder = new TextDecoder(kind === 'html' ? 'windows-1252' : 'utf-8'); }
  return decoder.decode(bytes);
}
