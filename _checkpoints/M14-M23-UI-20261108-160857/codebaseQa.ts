/**
 * Codebase question answering (M1.4) — symbol-precise, offline, deterministic.
 *
 * Answers "where is X defined?" / "what does X do?" with `file:line` and a
 * bounded snippet, using only the documents it is given. Pure so the ranking and
 * extraction logic is unit-tested independently of the HTTP layer; the caller
 * decides which files to scan (the source-context retriever already ranks them).
 */

export interface CodebaseDocument {
  file: string;
  content: string;
}

export interface DefinitionMatch {
  file: string;
  line: number;
  kind: string;
  symbol: string;
  snippet: string;
}

export type CodebaseAnswer =
  | { kind: 'definition'; match: DefinitionMatch; matches: DefinitionMatch[]; searchedFiles: number; text: string }
  | { kind: 'none'; matches: DefinitionMatch[]; searchedFiles: number; text: string };

const STOP = new Set(('the and for with this that from into your project files file code create update fix make use using should can will are was have has not only then than\n' +
  'where what which how when why who whom does do did defined define definition is it its in on of a an to show me tell find locate lookup search for\n' +
  'implemented implementation declared declaration exists exist please explain describe about used usage use case\n' +
  'work works working worked build builds built run runs running something anything everything').split(/\s+/));

/** Conservative declaration patterns: definitions only, never call sites. */
const DECLARATIONS: Array<[kind: string, pattern: RegExp]> = [
  ['class', /\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g],
  ['interface', /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g],
  ['type', /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/g],
  ['enum', /\b(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g],
  ['function', /\b(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g],
  ['function', /\b(?:def|fn|func)\s+([A-Za-z_$][\w$]*)/g],
  ['method', /\b(?:public|private|protected|internal|static|override|async|suspend|fun)\s+(?:[\w<>[\],.?]+\s+)?([A-Za-z_]\w*)\s*\(/g],
  ['method', /\bfunc\s*\([^)]*\)\s*([A-Za-z_]\w*)\s*\(/g],
  ['impl', /\bimpl(?:<[^>]+>)?\s+([A-Za-z_]\w*)/g],
  ['variable', /\b(?:export\s+)?(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)/g],
];

const SNIPPET_LIMIT = 400;
const SNIPPET_CONTEXT_LINES = 3;

/** Cross-language symbol equivalence: `formatConfig` === `format_config`. */
const normalize = (value: string): string => value.toLowerCase().replace(/[_\s-]+/g, '');

/** Identifiers the user is asking about, most specific first. */
export function extractIdentifiers(question: string): string[] {
  const found: string[] = [];
  const push = (value: string) => {
    const clean = value.trim().replace(/^[^\w$]+|[^\w$]+$/g, '');
    if (clean.length >= 3 && !STOP.has(clean.toLowerCase()) && !found.includes(clean)) found.push(clean);
  };
  // Quoted or backticked names are explicit intent and rank first.
  for (const match of String(question || '').matchAll(/[`'"]([^`'"\n]{2,64})[`'"]/g)) push(match[1]);
  for (const match of String(question || '').matchAll(/\b([A-Za-z_$][\w$]{2,})\b/g)) push(match[1]);
  // camelCase / snake_case compound names are strongest when present.
  for (const match of String(question || '').matchAll(/\b([a-z]+(?:[A-Z][a-z0-9]+)+|[\w]+_[\w]+)\b/g)) push(match[1]);
  return found.filter(name => /^[A-Za-z_$]/.test(name)).slice(0, 6);
}

/** Definition sites for the requested identifiers, exact matches first. */
export function findDefinitions(documents: CodebaseDocument[], identifiers: string[]): DefinitionMatch[] {
  const wanted = (identifiers || []).map(name => normalize(String(name || ''))).filter(Boolean);
  if (!wanted.length) return [];
  const matches: DefinitionMatch[] = [];
  for (const document of documents || []) {
    if (!document || typeof document.content !== 'string') continue;
    const lines = document.content.split(/\r?\n/);
    for (const [kind, pattern] of DECLARATIONS) {
      pattern.lastIndex = 0;
      for (const match of document.content.matchAll(pattern)) {
        const symbol = match[1];
        if (!symbol || !wanted.includes(normalize(symbol))) continue;
        const line = document.content.slice(0, match.index ?? 0).split(/\r?\n/).length;
        const snippet = lines.slice(line - 1, line - 1 + SNIPPET_CONTEXT_LINES).join('\n').slice(0, SNIPPET_LIMIT);
        const duplicate = matches.some(entry => entry.file === document.file && entry.line === line && entry.symbol === symbol);
        if (!duplicate) matches.push({ file: document.file, line, kind, symbol, snippet });
      }
    }
  }
  return sortMatches(matches, wanted, identifiers);
}

/** Exact-name definitions first, then classes/interfaces, then functions. */
function sortMatches(matches: DefinitionMatch[], wanted: string[], identifiers: string[]): DefinitionMatch[] {
  const primary = identifiers[0] ? String(identifiers[0]) : '';
  const primaryLower = primary.toLowerCase();
  const rank = (match: DefinitionMatch): number => {
    let score = 0;
    if (match.kind === 'class' || match.kind === 'interface' || match.kind === 'type') score -= 4;
    if (match.kind === 'function' || match.kind === 'method') score -= 2;
    if (primary && match.symbol === primary) score -= 8;
    else if (primary && match.symbol.toLowerCase() === primaryLower) score -= 5;
    if (wanted.indexOf(normalize(match.symbol)) === 0) score -= 3;
    return score;
  };
  return [...matches].sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Answer a codebase question against the given documents. Never throws, never
 * invents: an unknown symbol reports `none` instead of a guessed location.
 */
export function answerCodebaseQuestion(question: string, documents: CodebaseDocument[]): CodebaseAnswer {
  const scanned = (documents || []).filter(document => document && typeof document.content === 'string');
  const identifiers = extractIdentifiers(question);
  const matches = findDefinitions(scanned, identifiers);
  const searchedFiles = scanned.length;
  if (!identifiers.length) {
    return { kind: 'none', matches, searchedFiles, text: 'I could not identify a symbol to look up. Try naming a function, class or variable.' };
  }
  if (!matches.length) {
    return { kind: 'none', matches, searchedFiles, text: `I could not find a definition for ${identifiers[0]} in the indexed sources.` };
  }
  const best = matches[0];
  const others = matches.slice(1);
  const text = `${best.symbol} is defined in ${best.file}:${best.line} (${best.kind}).` +
    (others.length ? ` ${others.length} other definition${others.length === 1 ? '' : 's'} also matched.` : '') +
    `\n\n${best.snippet}`;
  return { kind: 'definition', match: best, matches, searchedFiles, text };
}
