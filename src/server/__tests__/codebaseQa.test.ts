import { describe, expect, it } from 'vitest';
import { answerCodebaseQuestion, extractIdentifiers, findDefinitions } from '../codebaseQa.js';

// M1.4: "where is X defined?" must answer with a real file:line, never a guess.
const documents = [
  {
    file: 'src/parser.ts',
    content: 'import { readFile } from "node:fs";\n\nexport function parseConfig(raw: string) {\n  const value = JSON.parse(raw);\n  return value;\n}\n\nexport class ConfigParser {\n  parse(text: string) { return parseConfig(text); }\n}\n\nfunction unusedHelper() { return 1; }\n',
  },
  {
    file: 'src/other.ts',
    content: 'export const parseLimit = 10;\nexport function formatConfig(value: unknown) {\n  return String(value);\n}\n',
  },
  {
    file: 'scripts/run.py',
    content: 'def parse_config(raw):\n    return raw\n\ndef format_config(value):\n    return str(value)\n',
  },
];

describe('extractIdentifiers', () => {
  it('keeps the identifier from a natural-language question and drops question words', () => {
    const identifiers = extractIdentifiers('Where is the parseConfig function defined in this project?');
    expect(identifiers[0]).toBe('parseConfig');
    expect(identifiers).not.toContain('Where');
    expect(identifiers).not.toContain('project');
  });

  it('prefers explicitly quoted or backticked names', () => {
    expect(extractIdentifiers('what does `ConfigParser` do?').slice(0, 1)).toEqual(['ConfigParser']);
    expect(extractIdentifiers('show me "parseLimit" please')[0]).toBe('parseLimit');
  });

  it('returns nothing for a question with no usable identifier', () => {
    expect(extractIdentifiers('how does the and the with it?')).toEqual([]);
    expect(extractIdentifiers('')).toEqual([]);
  });
});

describe('findDefinitions', () => {
  it('finds the definition site with file, line and kind', () => {
    const matches = findDefinitions(documents, ['parseConfig']);
    expect(matches[0]).toMatchObject({ file: 'src/parser.ts', line: 3, kind: 'function', symbol: 'parseConfig' });
    expect(matches[0].snippet).toContain('export function parseConfig');
  });

  it('ranks a class definition above same-named call sites and unrelated matches', () => {
    const matches = findDefinitions(documents, ['ConfigParser']);
    expect(matches[0]).toMatchObject({ file: 'src/parser.ts', kind: 'class', line: 8, symbol: 'ConfigParser' });
    expect(matches.map(match => match.file)).toContain('src/parser.ts');
  });

  it('finds definitions across languages and skips non-declaration uses', () => {
    const matches = findDefinitions(documents, ['formatConfig']);
    expect(matches.some(match => match.file === 'scripts/run.py' && match.kind === 'function')).toBe(true);
    // A call site is not a definition.
    expect(findDefinitions([{ file: 'a.ts', content: 'export function go() {\n  parseConfig("{}");\n}\n' }], ['parseConfig'])).toEqual([]);
  });

  it('returns no matches for an unknown symbol instead of guessing', () => {
    expect(findDefinitions(documents, ['doesNotExist'])).toEqual([]);
    expect(findDefinitions(documents, [])).toEqual([]);
  });
});

describe('answerCodebaseQuestion', () => {
  it('answers with a precise file:line reference', () => {
    const answer = answerCodebaseQuestion('where is parseConfig defined?', documents);
    expect(answer.kind).toBe('definition');
    if (answer.kind !== 'definition') return;
    expect(answer.match.file).toBe('src/parser.ts');
    expect(answer.match.line).toBe(3);
    expect(answer.match.kind).toBe('function');
    expect(answer.text).toContain('src/parser.ts:3');
    expect(answer.searchedFiles).toBe(3);
  });

  it('honestly reports when the symbol is not in the supplied documents', () => {
    const answer = answerCodebaseQuestion('where is telemetry defined?', documents);
    expect(answer.kind).toBe('none');
    expect(answer.text).toContain('could not find a definition');
    expect(answer.matches).toEqual([]);
  });

  it('asks a follow-up when no identifier can be extracted', () => {
    const answer = answerCodebaseQuestion('how does this work?', documents);
    expect(answer.kind).toBe('none');
    expect(answer.text).toContain('could not identify a symbol');
  });

  it('never throws on malformed input', () => {
    const answer = answerCodebaseQuestion(undefined as unknown as string, undefined as unknown as typeof documents);
    expect(answer.kind).toBe('none');
    expect(answer.searchedFiles).toBe(0);
    expect(answerCodebaseQuestion('parseConfig', [{ file: '', content: null as unknown as string }]).kind).toBe('none');
  });
});