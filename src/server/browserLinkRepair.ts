import path from 'node:path';
import type { ParserOptions } from 'prettier';

type Span = {start: {offset: number}; end: {offset: number}};
type HtmlNode = {
  name?: string;
  attrs?: {name: string; value: string; valueSpan?: Span}[];
  children?: HtmlNode[];
  startSourceSpan?: Span;
};
type Relink = {oldString: string; newString: string};

/** Only repair missing local references with an explicit, unambiguous destination.
 * Use the HTML parser's source offsets to preserve the user's markup and skip
 * script strings, comments, inline styles, remote URLs and working references. */
export async function requestedLinkRepairs(html: string, file: string, prompt: string, exists: (file: string) => boolean): Promise<Relink[]> {
  const directive = prompt.split(/(?:[.!?;]\s+|\n+)/).find(clause =>
    /\b(?:fix|repair|update|connect|link)\b/i.test(clause) &&
    /\b(?:link[s]?|load[s]?|connect)\b/i.test(clause) &&
    !/\b(?:don't|do not|never|without|instead of|except|or|example)\b/i.test(clause) &&
    clause.match(/(?:[\w./-]+\.html?)\b/gi)?.some(entry => entry === file || entry === path.posix.basename(file)));
  if (!directive || /\b(?:don't|do not|never)\s+(?:change|edit|touch|modify)\s+(?:the\s+)?(?:html|index\.html)\b/i.test(prompt)) return [];
  const targets = new Set(directive.match(/(?:[\w./-]+\.(?:css|[cm]?js))\b/gi) || []);
  if (!targets.size) return [];
  const {parsers} = await import('prettier/plugins/html');
  let root: HtmlNode;
  try { root = await parsers.html.parse(html, {originalText: html} as ParserOptions); }
  catch { return []; }
  const nodes: HtmlNode[] = [];
  function visit(node: HtmlNode) {
    if (node.name === 'script' || node.name === 'link') nodes.push(node);
    else if (node.name !== 'template') node.children?.forEach(visit);
  }
  visit(root);
  const edits: Relink[] = [];
  for (const name of ['script', 'link']) {
    const candidates = nodes.filter(node => node.name === name && node.attrs?.some(a =>
      name === 'script' ? a.name === 'src' : a.name === 'rel' && /\bstylesheet\b/i.test(a.value)));
    const requested = [...targets].filter(asset => (name === 'link' ? /\.css$/i : /\.[cm]?js$/i).test(asset));
    if (candidates.length === 0 && name === 'script' && requested.length === 1) {
      const asset = requested[0];
      const relative = (value: string) => path.posix.join(path.posix.dirname(file), value);
      if (!/^(?:\.\/)?[\w./-]+$/.test(asset) || asset.startsWith('/') || asset.split('/').includes('..') || !exists(relative(asset))) continue;
      const tag = `<script src="${asset.replace(/^\.\//, '')}"></script>`;
      const bodyClose = html.toLowerCase().lastIndexOf('</body>');
      if (bodyClose < 0 || html.toLowerCase().indexOf('</body>') !== bodyClose) continue;
      edits.push({oldString: '</body>', newString: `${tag}\n</body>`});
      continue;
    }
    if (candidates.length !== 1 || requested.length !== 1) continue;
    const asset = requested[0];
    const node = candidates[0];
    const attr = node.attrs?.find(a => a.name === (name === 'link' ? 'href' : 'src'));
    if (!attr?.valueSpan || !node.startSourceSpan || !(name === 'link' ? /\.css$/i : /\.[cm]?js$/i).test(attr.value) ||
        !/^(?:\.\/)?[\w./-]+$/.test(attr.value) ||
        attr.value.startsWith('/') || asset.startsWith('/') || [asset, attr.value].some(p => p.split('/').includes('..'))) continue;
    const relative = (value: string) => path.posix.join(path.posix.dirname(file), value);
    if (exists(relative(attr.value)) || !exists(relative(asset))) continue;
    const tagStart = node.startSourceSpan.start.offset;
    const tagEnd = node.startSourceSpan.end.offset;
    const oldString = html.slice(tagStart, tagEnd);
    const {start, end} = attr.valueSpan;
    const raw = html.slice(start.offset, end.offset);
    const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : '';
    if (raw !== quote + attr.value + quote || html.indexOf(oldString) !== html.lastIndexOf(oldString)) continue;
    const newString = html.slice(tagStart, start.offset) + quote + asset + quote + html.slice(end.offset, tagEnd);
    edits.push({oldString, newString});
  }
  return edits;
}
