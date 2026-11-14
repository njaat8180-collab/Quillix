import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '../..');

// A UTF-8 character that was decoded as latin-1 and re-encoded as UTF-8 shows
// up in source as a three-character sequence. The ellipsis case reached
// src/App.tsx and rendered as mojibake in user-visible agent banners, so keep a
// regression guard over the shipped source tree.
//
// NOTE: every sequence below is written with escape sequences on purpose.
// Literal mojibake in this file would make the guard report itself.
const MOJIBAKE_SEQUENCES = [
  { label: 'ellipsis', text: '\u00e2\u20ac\u00a6' },
  { label: 'em dash', text: '\u00e2\u20ac\u201d' },
  { label: 'right quote', text: '\u00e2\u20ac\u2122' },
  { label: 'left quote', text: '\u00e2\u20ac\u0153' },
  { label: 'bullet', text: '\u00e2\u20ac\u00a2' },
];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'release', '_checkpoints',
  'coverage', '.quillix-smoke', '.vite',
]);
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|css|html|json|md|txt)$/i;

function collectSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectSourceFiles(path.join(dir, entry.name), out);
    } else if (TEXT_EXT.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

test('shipped source contains no UTF-8/Latin-1 mojibake sequences', () => {
  const files = collectSourceFiles(projectRoot);
  const offenders = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const { label, text: sequence } of MOJIBAKE_SEQUENCES) {
      if (text.includes(sequence)) {
        const line = text.slice(0, text.indexOf(sequence)).split('\n').length;
        offenders.push(`${path.relative(projectRoot, file)}:${line} ${label}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `mojibake found in source:\n${offenders.join('\n')}`);
});
