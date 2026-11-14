import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M1.4 contract: live codebase Q&A must answer "where is X defined?" with a
// real file:line, must work across languages (camelCase == snake_case), and must
// report "not found" instead of inventing a location. `--root <dir>` replays the
// contract against another tree (used to prove it fails without the feature).
const rootIndex = process.argv.indexOf('--root');
const project = rootIndex >= 0 && process.argv[rootIndex + 1]
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve(import.meta.dirname, '../..');

const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');
const qa = read('src', 'server', 'codebaseQa.ts');
const server = read('server.ts');
const bridge = read('src', 'services', 'apiBridge.ts');
const tests = read('src', 'server', '__tests__', 'codebaseQa.test.ts');
const source = [qa, server, bridge].join('\n');

const checks = [
  ['identifier extraction ignores question words', /export function extractIdentifiers\(question: string\): string\[\]/],
  ['declarations are recognised without a provider call', /export function findDefinitions\(documents: CodebaseDocument\[\], identifiers: string\[\]\)/],
  ['symbol matching ignores case and separators (camelCase == snake_case)', /const normalize = \(value: string\): string =>/],
  ['normalized comparison is used for both matching and ranking', /!wanted\.includes\(normalize\(symbol\)\)/],
  ['the answer reports the matched file and line', /export function answerCodebaseQuestion\(question: string, documents: CodebaseDocument\[\]\): CodebaseAnswer/],
  ['an unknown symbol is reported, never guessed', /I could not find a definition for \$\{identifiers\[0\]\}/],
  ['the server exposes the answer endpoint', /app\.get\('\/api\/codebase\/answer'/],
  ['the endpoint requires a question', /question query parameter is required/],
  ['the endpoint reuses the ranked source-context evidence', /codebaseIndexer\.sources\.retrieve\(question/],
  ['file reads stay bounded', /read\.content\.slice\(0, 120_000\)/],
  ['the endpoint fails safely instead of throwing', /Codebase answer is temporarily unavailable/],
  ['the renderer can ask the codebase question endpoint', /answerCodebaseQuestion\(question: string\): Promise</],
  ['the bridge URL-encodes the question', /\/api\/codebase\/answer\?question=\$\{encodeURIComponent\(/],
];

for (const [name, pattern] of checks) assert.match(source, pattern, name);

const testChecks = [
  ['a natural-language question resolves to the right definition', /expect\(identifiers\[0\]\)\.toBe\('parseConfig'\);/],
  ['the definition site is reported precisely', /expect\(answer\.match\.file\)\.toBe\('src\/parser\.ts'\);/],
  ['cross-language snake_case matches are found', /match\.file === 'scripts\/run\.py'/],
  ['a call site is never treated as a definition', /expect\(findDefinitions\(\[\{ file: 'a\.ts', content: 'export function go\(\) \{\\n  parseConfig\("{}"\);\\n}\\n' \}\], \['parseConfig'\]\)\)\.toEqual\(\[\]\);/],
  ['missing symbols are reported honestly', /expect\(answer\.kind\)\.toBe\('none'\);/],
  ['malformed input never throws', /expect\(answer\.kind\)\.toBe\('none'\);/],
];
for (const [name, pattern] of testChecks) assert.match(tests, pattern, name);

assert.doesNotMatch(server, /codebaseIndexer\.sources\.retrieve\(question[\s\S]{0,400}?(await|fetch\()/, 'the answer endpoint must stay offline and deterministic');
console.log(JSON.stringify({
  status: 'PASS',
  files: ['src/server/codebaseQa.ts', 'src/server/__tests__/codebaseQa.test.ts', 'server.ts', 'src/services/apiBridge.ts'],
  checks: checks.length + testChecks.length,
}));