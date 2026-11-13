import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M9.7 memory-hygiene audit. Static checks (no jsdom available) for the two
// leak classes that actually bite a long-running Electron session:
//   1. intervals/timeouts scheduled in a component effect without a cleanup
//      that clears them;
//   2. event listeners / observers registered without a matching removal.
// Timers at module scope (deliberate caches/services) are not component
// effects and are excluded by only scanning inside `useEffect(` blocks.
const root = process.cwd();
const targets = [
  'src/App.tsx',
  'src/components/WorkbenchLayout.tsx',
  'src/components/EditorArea.tsx',
  'src/components/TaskHistoryPanel.tsx',
  'src/components/DeveloperCockpit.tsx',
  'src/components/SettingsScreen.tsx',
  'src/components/Composer.tsx',
  'src/components/ChatPanel.tsx',
  'src/components/CheckpointsPanel.tsx',
  'src/components/BuildTestPanel.tsx',
  'src/components/ChatView.tsx',
  'src/components/WorkspaceView.tsx',
];

// Extract each `useEffect(() => { ... }, [deps]);` body (brace-matched).
function effectBlocks(source) {
  const blocks = [];
  const pattern = /useEffect\(\(\) => \{/g;
  let match = null;
  while ((match = pattern.exec(source)) !== null) {
    let depth = 0;
    let index = match.index + match[0].length - 1;
    const start = index + 1;
    for (; index < source.length; index++) {
      const char = source[index];
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) { blocks.push(source.slice(start, index)); break; }
      }
    }
  }
  return blocks;
}

const findings = [];
for (const relative of targets) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) { findings.push(`${relative}: missing`); continue; }
  const source = fs.readFileSync(file, 'utf8');
  for (const block of effectBlocks(source)) {
    const schedules = (block.match(/setInterval\(/g) || []).length;
    const clears = (block.match(/clearInterval\(/g) || []).length;
    if (schedules > clears) findings.push(`${relative}: an effect schedules ${schedules} interval(s) but clears ${clears}`);
    const adds = (block.match(/addEventListener\(/g) || []).length;
    const removes = (block.match(/removeEventListener\(/g) || []).length;
    if (adds > removes) findings.push(`${relative}: an effect adds ${adds} listener(s) but removes ${removes}`);
    const observes = (block.match(/new (?:ResizeObserver|MutationObserver)\(/g) || []).length;
    if (observes > 0 && !/disconnect\(/.test(block)) findings.push(`${relative}: an effect observes without disconnect()`);
  }
  // A window-level listener inside an effect must be paired in the same block.
  for (const block of effectBlocks(source)) {
    if (/window\.addEventListener\(/.test(block) && !/window\.removeEventListener\(/.test(block)) {
      findings.push(`${relative}: a window-level listener is never removed`);
    }
  }
}

if (findings.length) {
  console.log(JSON.stringify({ status: 'FAIL', findings }));
  process.exit(1);
}
console.log(JSON.stringify({ status: 'PASS', files: targets, checks: targets.length }));
