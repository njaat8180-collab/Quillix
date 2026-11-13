/**
 * Quillix dependency audit.
 *
 * Verifies that every declared dependency in package.json is actually
 * imported somewhere in the shipped source (`src/**`, `server.ts`,
 * `electron/**`, `scripts/**`, `benchmarks/**`). The exit code is non-zero
 * only for VERIFIED unused top-level packages — transitive/peer packages that
 * are declared but never imported are reported separately and never fail the
 * audit, because removing them silently breaks transitive resolution.
 *
 * Run: npm run test:dependency-audit
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const SOURCE_DIRS = ['src', 'electron', 'scripts', 'benchmarks'];
const SOURCE_FILES = ['server.ts', 'vite.config.ts', 'vitest.config.ts', 'tsconfig.json'];

const IMPORT_RE = /(?:^|[\s;{(])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]/g;
/** Bare side-effect imports: `import 'dotenv/config';` (no `from` clause). */
const SIDE_EFFECT_IMPORT_RE = /(?:^|[\s;{(])import\s*['"]([^'"]+)['"]/g;
const REQUIRE_RE = /(?:^|[\s;{(=])require\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Recursively collect source files that may contain imports. */
function collectSourceFiles(dirs) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    if (!fs.statSync(dir).isDirectory()) {
      // Root-level entry/config files are sources too.
      if (/\.(?:[cm]?[jt]sx?)$/.test(dir) || dir.endsWith('.json')) out.push(dir);
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(?:[cm]?[jt]sx?|json|md)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const dir of dirs) walk(path.join(ROOT, dir));
  // Root-level config/entry files are first-class sources too (server.ts,
  // vite.config.ts declares @vitejs/plugin-react and @tailwindcss/vite).
  for (const file of SOURCE_FILES) {
    const full = path.join(ROOT, file);
    if (fs.existsSync(full) && !out.includes(full)) out.push(full);
  }
  return out;
}

/** Extract every module specifier used anywhere in one file. */
function specifiersOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const found = new Set();
  for (const re of [IMPORT_RE, SIDE_EFFECT_IMPORT_RE, REQUIRE_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
  }
  return [...found];
}

/** True when any bundled source imports the named package. */
function isImported(pkgName) {
  const files = collectSourceFiles([...SOURCE_DIRS]);
  for (const file of files) {
    for (const spec of specifiersOf(file)) {
      if (spec === pkgName || spec.startsWith(`${pkgName}/`)) return true;
    }
  }
  return false;
}

/** Toolchain/bundler packages are declared but never imported from app code. */
const TOOLCHAIN = new Set([
  'typescript',
  'vite',
  'esbuild',
  'vitest',
  'electron',
  'electron-builder',
  'tsx',
  'cross-env',
  'autoprefixer',
  'tailwindcss',
]);

function classify(name) {
  if (TOOLCHAIN.has(name) || name.startsWith('@types/') || name.startsWith('@vitest/')) return 'toolchain';
  return 'runtime';
}

const declared = Object.keys(pkg.dependencies || {});
const unused = [];
const unusedTransitive = [];

for (const name of declared) {
  if (!isImported(name)) {
    if (classify(name) === 'toolchain') unusedTransitive.push(name);
    else unused.push(name);
  }
}

const scanned = collectSourceFiles([...SOURCE_DIRS, ...SOURCE_FILES]).length;
console.log(`Dependency audit: ${declared.length} declared dependencies scanned across ${scanned} source files.`);

if (unusedTransitive.length > 0) {
  console.log(`\nUNREFERENCED (kept — toolchain package, verified not imported by app code):`);
  for (const name of unusedTransitive) console.log(`  - ${name}`);
}

if (unused.length === 0) {
  console.log('\nPASS: every declared shipped dependency is imported by project source.');
  process.exit(0);
}

console.log(`\nFAIL: ${unused.length} declared dependency(ies) are never imported by project source:`);
for (const name of unused) console.log(`  - ${name}`);
console.log('\nRemove the package from package.json AND update package-lock.json, then re-run.');
process.exit(1);