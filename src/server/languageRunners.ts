import { spawn, spawnSync, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ProjectProfile, ProjectRunInfo } from '../shared/types.js';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Context passed to adapter detect() functions. */
interface DetectContext {
  root: string;
  rootFiles: string[];
  allFiles: string[];
  packageJson: any;
  pythonRequirements: string[] | undefined;
}

/** Language adapter definition for project detection. */
interface Adapter {
  id: string;
  label: string;
  priority: number;
  detect: (ctx: DetectContext) => (Partial<ProjectProfile> & { detectionNote?: string }) | null;
  runtimeCandidates: () => string[];
}

// ---------------------------------------------------------------------------
// Hardening constants
// ---------------------------------------------------------------------------

const MAX_COMMAND_LENGTH = 4096;
const MAX_OUTPUT_BYTES_PROBE = 1024 * 1024; // 1 MB (for runtime probe output)
const MAX_PROJECT_NAME_LENGTH = 128;

// Runtime probe cache
const runtimeCache = new Map<string, { available: boolean; version?: string }>();
const DANGEROUS_COMMAND_PATTERNS = [
  /[;&|`$]/,                    // shell metacharacters
  /\$\(/,                       // command substitution
  />\s*\//,                     // redirect to root
  /rm\s+-rf\s+\//i,            // recursive root delete
  /mkfs/i,                      // filesystem format
  /dd\s+if=/i,                  // disk dump
  />\s*\/dev\//i,              // write to device
  /chmod\s+777/i,              // world-writable
  /chown\s+root/i,             // ownership change
  /sudo/i,                      // privilege escalation
  /su\s+/i,                     // switch user
  /passwd/i,                    // password change
];

function sanitizeInput(input: string, maxLength: number): string {
  if (typeof input !== 'string') return '';
  const sanitized = input.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return sanitized.length > maxLength ? sanitized.slice(0, maxLength) : sanitized;
}

function validateCommand(command: string): void {
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new Error(`Command exceeds maximum length of ${MAX_COMMAND_LENGTH} characters.`);
  }
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error('Command contains disallowed patterns.');
    }
  }
}

function validateProjectName(name: string): void {
  if (!name || name.length > MAX_PROJECT_NAME_LENGTH) {
    throw new Error(`Project name must be 1-${MAX_PROJECT_NAME_LENGTH} characters.`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new Error('Project name contains invalid characters. Use only alphanumeric, dot, underscore, hyphen.');
  }
}

/** Probes a runtime binary with `--version` (read-only, no side effects). */
export function probeRuntime(binary: string): { available: boolean; version?: string } {
  const cached = runtimeCache.get(binary);
  if (cached) return cached;
  let result = { available: false as boolean, version: undefined as string | undefined };
  try {
    const res = spawnSync(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 8000,
      shell: os.platform() === 'win32',
      windowsHide: true,
    });
    if (!res.error && res.status === 0) {
      result = { available: true, version: (res.stdout || res.stderr || '').trim().split('\n')[0].slice(0, 80) };
    }
  } catch {
    // not installed
  }
  runtimeCache.set(binary, result);
  return result;
}

/** Clears the runtime probe cache (used by tests). */
export function clearRuntimeCache(): void {
  runtimeCache.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple shell-like command parsing into argv (handles basic quoting). */
function parseCommand(command: string): string[] {
  const result: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (const ch of command) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) result.push(current);
  return result.length ? result : [command];
}

function listFiles(root: string, depth: number, maxEntries: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string, d: number) => {
    if (out.length >= maxEntries) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxEntries) return;
      if (e.isSymbolicLink()) continue;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      out.push(relPath);
      if (e.isDirectory() && d > 0) walk(path.join(dir, e.name), relPath, d - 1);
    }
  };
  walk(root, '', depth);
  return out;
}

function readPackageJson(root: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

function readRequirements(root: string): string[] | undefined {
  try {
    const txt = fs.readFileSync(path.join(root, 'requirements.txt'), 'utf8');
    return txt
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return undefined;
  }
}

function pickEntry(files: string[], candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (files.includes(c)) return c;
  }
  // Prefix match (e.g. car_game.py → matches game*.py)
  for (const c of candidates) {
    const base = c.replace(/\.[^.]+$/, '');
    const ext = path.extname(c);
    const hit = files.find((f) => f.startsWith(base) && f.endsWith(ext));
    if (hit) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Language adapters
// ---------------------------------------------------------------------------

const ADAPTERS: Adapter[] = [
  // -------------------------- Rust (Cargo) --------------------------------
  {
    id: 'rust',
    label: 'Rust',
    priority: 10,
    detect(ctx) {
      if (!ctx.allFiles.includes('Cargo.toml')) return null;
      return { projectType: 'cargo-project', entryPoint: 'src/main.rs', runCommand: 'cargo run', testCommand: 'cargo test' };
    },
    runtimeCandidates() {
      return ['cargo'];
    },
  },
  // -------------------------- Go ------------------------------------------
  {
    id: 'go',
    label: 'Go',
    priority: 10,
    detect(ctx) {
      if (!ctx.allFiles.includes('go.mod')) return null;
      return { projectType: 'go-module', entryPoint: 'main.go', runCommand: 'go run .', testCommand: 'go test ./...' };
    },
    runtimeCandidates() {
      return ['go'];
    },
  },
  // -------------------------- Java (Maven / Gradle / single) ---------------
  {
    id: 'java',
    label: 'Java',
    priority: 10,
    detect(ctx) {
      const javaFiles = ctx.allFiles.filter((f) => f.endsWith('.java'));
      if (javaFiles.length === 0) return null;
      if (ctx.allFiles.includes('pom.xml')) {
        return { projectType: 'maven-project', entryPoint: javaFiles[0], runCommand: 'mvn exec:java', testCommand: 'mvn test' };
      }
      if (ctx.rootFiles.some((f) => f.startsWith('build.gradle'))) {
        return { projectType: 'gradle-project', entryPoint: javaFiles[0], runCommand: 'gradle run', testCommand: 'gradle test' };
      }
      const entry = pickEntry(javaFiles, ['Main.java', 'App.java', 'main.java']);
      const single = entry || javaFiles[0];
      // JDK 11+ runs single-file programs directly.
      return { projectType: 'java-single-file', entryPoint: single, runCommand: `java "${single}"` };
    },
    runtimeCandidates() {
      return ['java'];
    },
  },
  // -------------------------- C# (.NET) -----------------------------------
  {
    id: 'csharp',
    label: 'C#',
    priority: 10,
    detect(ctx) {
      const csproj = ctx.rootFiles.find((f) => f.endsWith('.csproj'));
      if (csproj) {
        return { projectType: 'dotnet-project', entryPoint: csproj, runCommand: 'dotnet run', testCommand: 'dotnet test' };
      }
      const cs = ctx.allFiles.filter((f) => f.endsWith('.cs'));
      if (cs.length === 0) return null;
      const single = pickEntry(cs, ['Program.cs', 'Main.cs']) || cs[0];
      return { projectType: 'dotnet-single-file', entryPoint: single, runCommand: `dotnet run "${single}"` };
    },
    runtimeCandidates() {
      return ['dotnet'];
    },
  },
  // -------------------------- C / C++ -------------------------------------
  {
    id: 'cpp',
    label: 'C++',
    priority: 20,
    detect(ctx) {
      const cppFiles = ctx.allFiles.filter((f) => /\.(cpp|cxx|cc)$/i.test(f) && !f.includes('/'));
      const cFiles = ctx.allFiles.filter((f) => /\.c$/i.test(f) && !f.includes('/'));
      if (ctx.allFiles.includes('CMakeLists.txt') && (cppFiles.length > 0 || cFiles.length > 0)) {
        return {
          projectType: 'cmake-project',
          entryPoint: cppFiles[0] || cFiles[0],
          buildCommand: 'cmake -S . -B build && cmake --build build',
          runCommand: 'cmake --build build && ./build/main',
          testCommand: 'ctest --test-dir build',
        };
      }
      if (cppFiles.length > 0) {
        const entry = pickEntry(cppFiles, ['main.cpp', 'app.cpp', 'game.cpp']) || cppFiles[0];
        const out = path.basename(entry).replace(/\.[^.]+$/, '') + '.out';
        return {
          projectType: 'cpp-single-file',
          entryPoint: entry,
          buildCommand: `g++ -std=c++17 -O2 -o ${out} "${entry}"`,
          runCommand: `g++ -std=c++17 -O2 -o ${out} "${entry}" && ./${out}`,
        };
      }
      return null;
    },
    runtimeCandidates() {
      return ['g++'];
    },
  },
  {
    id: 'c',
    label: 'C',
    priority: 21,
    detect(ctx) {
      const cFiles = ctx.allFiles.filter((f) => f.endsWith('.c') && !f.includes('/'));
      if (cFiles.length === 0) return null;
      if (ctx.allFiles.includes('CMakeLists.txt')) {
        return {
          projectType: 'cmake-project',
          entryPoint: cFiles[0],
          buildCommand: 'cmake -S . -B build && cmake --build build',
          runCommand: 'cmake --build build && ./build/main',
        };
      }
      const entry = pickEntry(cFiles, ['main.c', 'app.c', 'game.c']) || cFiles[0];
      const out = path.basename(entry).replace(/\.[^.]+$/, '') + '.out';
      return {
        projectType: 'c-single-file',
        entryPoint: entry,
        buildCommand: `gcc -O2 -o ${out} "${entry}"`,
        runCommand: `gcc -O2 -o ${out} "${entry}" && ./${out}`,
      };
    },
    runtimeCandidates() {
      return ['gcc'];
    },
  },
  // -------------------------- Node / JavaScript / TypeScript ---------------
  {
    id: 'node',
    label: 'Node.js',
    priority: 30,
    detect(ctx) {
      const pkg = ctx.packageJson;
      if (!pkg && ctx.allFiles.some(f => /\.html?$/.test(f))) return null;
      const scripts = pkg?.scripts || {};
      const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
      const isVite = !!(deps['vite'] || scripts.dev?.includes('vite'));
      const entry: string | undefined = pkg?.main || pickEntry(ctx.rootFiles, ['index.js', 'main.js', 'server.js', 'app.js', 'index.cjs', 'main.cjs', 'index.mjs', 'main.mjs', 'index.ts', 'main.ts']) || ctx.allFiles.find(f => /\.(?:cjs|mjs)$/.test(f));
      if (isVite || scripts.dev) {
        return {
          projectType: scripts.dev?.includes('vite') ? 'vite-app' : 'node-dev-server',
          entryPoint: entry,
          runCommand: 'npm run dev',
          testCommand: scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1' ? 'npm test' : undefined,
          installCommand: 'npm install',
        };
      }
      if (scripts.start) {
        return {
          projectType: 'node-app',
          entryPoint: entry,
          runCommand: 'npm start',
          testCommand: scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1' ? 'npm test' : undefined,
          installCommand: 'npm install',
        };
      }
      if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
        return { projectType: 'node-library', entryPoint: entry, runCommand: 'npm test', testCommand: 'npm test', installCommand: Object.keys(deps).length ? 'npm install' : undefined };
      }
      if (entry && entry.endsWith('.ts')) {
        return {
          projectType: 'typescript-script',
          entryPoint: entry,
          runCommand: `npx tsx "${entry}"`,
          installCommand: 'npm install',
        };
      }
      if (entry) {
        return { projectType: 'node-script', entryPoint: entry, runCommand: `node "${entry}"`, installCommand: 'npm install' };
      }
      return null;
    },
    runtimeCandidates() {
      return ['node'];
    },
  },
  // -------------------------- Python --------------------------------------
  {
    id: 'python',
    label: 'Python',
    priority: 40,
    detect(ctx) {
      const pyFiles = ctx.allFiles.filter((f) => f.endsWith('.py') && !f.includes('/'));
      if (pyFiles.length === 0 && !ctx.pythonRequirements) return null;
      const entry = pickEntry(pyFiles, ['main.py', 'app.py', 'game.py', 'run.py', 'server.py', 'calculator.py', 'todo.py', 'notes.py']);
      const deps: Record<string, string> = {};
      for (const r of ctx.pythonRequirements || []) deps[r.split('==')[0].split('>=')[0].trim()] = r;
      return {
        projectType: 'python-script',
        entryPoint: entry,
        dependencies: deps,
        installCommand: ctx.pythonRequirements?.length ? 'pip install -r requirements.txt' : undefined,
        runCommand: entry ? `{{RUNTIME}} "${entry}"` : '',
        testCommand: ctx.allFiles.some((f) => f.startsWith('test_') || f.endsWith('_test.py')) ? '{{RUNTIME}} -m pytest' : undefined,
      };
    },
    runtimeCandidates() {
      return ['python', 'python3'];
    },
  },
  // -------------------------- PHP -----------------------------------------
  {
    id: 'php',
    label: 'PHP',
    priority: 50,
    detect(ctx) {
      const php = ctx.allFiles.filter((f) => f.endsWith('.php') && !f.includes('/'));
      if (php.length === 0) return null;
      const entry = pickEntry(php, ['index.php']) || php[0];
      return { projectType: 'php-script', entryPoint: entry, runCommand: `php "${entry}"` };
    },
    runtimeCandidates() {
      return ['php'];
    },
  },
  // -------------------------- Ruby ----------------------------------------
  {
    id: 'ruby',
    label: 'Ruby',
    priority: 50,
    detect(ctx) {
      const rb = ctx.allFiles.filter((f) => f.endsWith('.rb') && !f.includes('/'));
      if (rb.length === 0) return null;
      const entry = pickEntry(rb, ['main.rb', 'app.rb']) || rb[0];
      return { projectType: 'ruby-script', entryPoint: entry, runCommand: `ruby "${entry}"` };
    },
    runtimeCandidates() {
      return ['ruby'];
    },
  },
  // -------------------------- Kotlin --------------------------------------
  {
    id: 'kotlin',
    label: 'Kotlin',
    priority: 50,
    detect(ctx) {
      const kt = ctx.allFiles.filter((f) => f.endsWith('.kt') && !f.includes('/'));
      if (kt.length === 0) return null;
      const entry = pickEntry(kt, ['Main.kt', 'main.kt']) || kt[0];
      const base = path.basename(entry).replace(/\.[^.]+$/, '');
      return {
        projectType: 'kotlin-script',
        entryPoint: entry,
        buildCommand: `kotlinc "${entry}" -include-runtime -d ${base}.jar`,
        runCommand: `kotlinc "${entry}" -include-runtime -d ${base}.jar && java -jar ${base}.jar`,
      };
    },
    runtimeCandidates() {
      return ['kotlinc'];
    },
  },
  // -------------------------- Swift ---------------------------------------
  {
    id: 'swift',
    label: 'Swift',
    priority: 50,
    detect(ctx) {
      const swift = ctx.allFiles.filter((f) => f.endsWith('.swift') && !f.includes('/'));
      if (swift.length === 0) return null;
      const entry = pickEntry(swift, ['main.swift']) || swift[0];
      return { projectType: 'swift-script', entryPoint: entry, runCommand: `swift "${entry}"` };
    },
    runtimeCandidates() {
      return ['swift'];
    },
  },
  // -------------------------- Dart ----------------------------------------
  {
    id: 'dart',
    label: 'Dart',
    priority: 55,
    detect(ctx) {
      if (ctx.allFiles.includes('pubspec.yaml')) return { projectType: 'dart-project', entryPoint: 'bin/main.dart', runCommand: 'dart run', testCommand: 'dart test' };
      const files = ctx.allFiles.filter((f) => f.endsWith('.dart') && !f.includes('/'));
      if (!files.length) return null;
      const entry = pickEntry(files, ['main.dart']) || files[0];
      return { projectType: 'dart-script', entryPoint: entry, runCommand: `dart run "${entry}"` };
    },
    runtimeCandidates() { return ['dart']; },
  },
  // -------------------------- Lua -----------------------------------------
  {
    id: 'lua',
    label: 'Lua',
    priority: 56,
    detect(ctx) {
      const files = ctx.allFiles.filter((f) => f.endsWith('.lua') && !f.includes('/'));
      if (!files.length) return null;
      const entry = pickEntry(files, ['main.lua', 'init.lua']) || files[0];
      return { projectType: 'lua-script', entryPoint: entry, runCommand: `lua "${entry}"` };
    },
    runtimeCandidates() { return ['lua']; },
  },
  // -------------------------- R -------------------------------------------
  {
    id: 'r',
    label: 'R',
    priority: 57,
    detect(ctx) {
      const files = ctx.allFiles.filter((f) => f.endsWith('.r') && !f.includes('/'));
      if (!files.length) return null;
      const entry = pickEntry(files, ['main.r', 'script.r']) || files[0];
      return { projectType: 'r-script', entryPoint: entry, runCommand: `Rscript "${entry}"` };
    },
    runtimeCandidates() { return ['Rscript']; },
  },
  // -------------------------- SQL -----------------------------------------
  {
    id: 'sql',
    label: 'SQL',
    priority: 80,
    detect(ctx) {
      const files = ctx.allFiles.filter((f) => f.endsWith('.sql'));
      if (!files.length) return null;
      return { projectType: 'sql-files', entryPoint: files[0], detectionNote: 'SQL source detected. A database runtime/connection is required for execution.' };
    },
    runtimeCandidates() { return ['sqlite3', 'psql', 'mysql']; },
  },
  // -------------------------- Shell ---------------------------------------
  {
    id: 'shell',
    label: 'Shell',
    priority: 60,
    detect(ctx) {
      const sh = ctx.rootFiles.filter((f) => f.endsWith('.sh'));
      if (sh.length > 0) {
        const entry = pickEntry(sh, ['main.sh', 'run.sh', 'start.sh']) || sh[0];
        return { projectType: 'shell-script', entryPoint: entry, runCommand: `bash "${entry}"` };
      }
      const ps1 = ctx.rootFiles.filter((f) => f.endsWith('.ps1'));
      if (ps1.length > 0) {
        const entry = pickEntry(ps1, ['main.ps1', 'run.ps1']) || ps1[0];
        return { projectType: 'powershell-script', entryPoint: entry, runCommand: `powershell -File "${entry}"` };
      }
      return null;
    },
    runtimeCandidates() {
      return ['bash'];
    },
  },
  // -------------------------- Static web (HTML/CSS/JS) --------------------
  {
    id: 'static-web',
    label: 'Web',
    priority: 70,
    detect(ctx) {
      const html = ctx.rootFiles.filter((f) => f.endsWith('.html') || f.endsWith('.htm'));
      if (html.length === 0) return null;
      const entry = pickEntry(html, ['index.html']) || html[0];
      return {
        projectType: 'web-static',
        entryPoint: entry,
        runCommand: '',
        previewable: true,
        previewEntry: entry,
        detectionNote: 'Static website — opens in the built-in NUVRO AI preview.',
      };
    },
    runtimeCandidates() {
      return ['node']; // not required to run, only for tooling
    },
  },
];

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class LanguageRunnerRegistry {
  /**
   * Detects the project profile for a folder: language, project type, entry
   * point, package manager, dependencies, build/run/test commands.
   */
  public static detect(root: string): ProjectProfile {
    const rootFiles = listFiles(root, 0, 200).filter((f) => !f.includes('/'));
    const allFiles = listFiles(root, 3, 800);
    const ctx: DetectContext = {
      root,
      rootFiles,
      allFiles,
      packageJson: readPackageJson(root),
      pythonRequirements: readRequirements(root),
    };

    const sorted = [...ADAPTERS].sort((a, b) => a.priority - b.priority);
    for (const adapter of sorted) {
      const draft = adapter.detect(ctx);
      if (!draft) continue;
      const runtimeBinary = this.pickRuntime(adapter);
      const runtime = probeRuntime(runtimeBinary);
      return this.finalize(adapter, draft, runtimeBinary, runtime);
    }

    return {
      language: 'unknown',
      languageLabel: 'Unknown',
      projectType: 'unknown',
      dependencies: {},
      runCommand: '',
      previewable: false,
      detectionNotes: ['No recognizable project structure found in this folder.'],
    };
  }

  private static pickRuntime(adapter: Adapter): string {
    for (const bin of adapter.runtimeCandidates()) {
      if (probeRuntime(bin).available) return bin;
    }
    return adapter.runtimeCandidates()[0];
  }

  private static finalize(
    adapter: Adapter,
    draft: Partial<ProjectProfile> & { detectionNote?: string },
    runtimeBinary: string,
    runtime: { available: boolean; version?: string }
  ): ProjectProfile {
    const notes: string[] = [`Detected ${adapter.label} project`];
    if (draft.detectionNote) notes.push(draft.detectionNote);
    notes.push(runtime.available ? `Runtime '${runtimeBinary}' available${runtime.version ? ` (${runtime.version})` : ''}` : `Runtime '${runtimeBinary}' NOT found on this machine`);
    if (runtime.available && runtime.version) notes.push(runtime.version);

    return {
      language: adapter.id,
      languageLabel: adapter.label,
      projectType: draft.projectType || 'unknown',
      entryPoint: draft.entryPoint,
      packageManager: draft.packageManager,
      dependencies: draft.dependencies || {},
      installCommand: draft.installCommand,
      buildCommand: draft.buildCommand,
      runCommand: (draft.runCommand || '').replace('{{RUNTIME}}', runtimeBinary),
      testCommand: draft.testCommand?.replace('{{RUNTIME}}', runtimeBinary),
      previewable: draft.previewable === true,
      previewEntry: draft.previewEntry,
      detectionNotes: notes,
      runtimeAvailable: runtime.available,
      runtimeBinary,
    };
  }
}

// ---------------------------------------------------------------------------
// Project name derivation (for "create a calculator" → Calculator/)
// ---------------------------------------------------------------------------

const NAME_STOPWORDS = new Set([
  'create', 'build', 'make', 'generate', 'a', 'an', 'the', 'me', 'my', 'please',
  'simple', 'basic', 'new', 'nice', 'good', 'cool', 'using', 'use', 'with', 'and',
  'professional', 'responsive', 'modern', 'advanced', 'clean', 'beautiful',
  'elegant', 'functional', 'fully', 'working', 'complete', 'great', 'high', 'quality',
  'for', 'in', 'of', 'some', 'project', 'app', 'application', 'program', 'code',
  'write', 'design', 'develop', 'give', 'can', 'you', 'i', 'want', 'to', 'it',
  'python', 'javascript', 'typescript', 'html', 'css', 'java', 'golang', 'node', 'js', 'ts',
  'nodejs', 'react', 'nextjs', 'c', 'cpp', 'c++', 'csharp', 'rust', 'php', 'ruby',
  'kotlin', 'swift', 'shell', 'bash', 'powershell', 'web', 'website', 'site',
  'page', 'desktop', 'local', 'full', 'complete', 'file', 'files', 'folder',
  'directory', 'named', 'called', 'containing', 'contains', 'that', 'which',
  'into', 'just', 'only', 'should', 'must', 'then', 'when', 'where', 'here',
  'help', 'helping', 'assist', 'want', 'wanted', 'need', 'needed', 'could',
  'would', 'like', 'let', 'lets', 'us', 'for me', 'something',
]);

/**
 * Derives a PascalCase project folder name from a natural-language prompt.
 * "create a python car game" → "CarGame"
 */
export function deriveProjectName(prompt: string): string | null {
  const sanitized = sanitizeInput(prompt, 4096);
  if (sanitized !== prompt) return null;
  const explicit = sanitized.match(/\b(?:project|app|game|website)\s+(?:named|called)\s+["'`]?([A-Za-z][A-Za-z0-9_-]{0,63})/i);
  if (explicit) return explicit[1];
  const words = sanitized
    .replace(/\bto[\s-]+do\b/gi, 'todo')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .filter((w) => !NAME_STOPWORDS.has(w))
    // Filenames (test.html, app.py) describe a SINGLE file, not a project —
    // "create a file named test.html" must not create a TestHtml project.
    .filter((w) => !w.includes('.'))
    // drop duplicates
    .filter((w, i, arr) => arr.indexOf(w) === i);

  if (words.length === 0) return null;
  const name = words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return /^[A-Za-z]/.test(name) ? name : null;
}

/**
 * Gives language-only project requests a deterministic folder instead of
 * silently writing their files at the workspace root. The richer derivation
 * above intentionally returns null for a generic "create a project" prompt;
 * these fallbacks are only for requests that clearly identify an app/runtime.
 */
export function fallbackProjectName(prompt: string): string | null {
  const sanitized = sanitizeInput(prompt, 4096);
  if (sanitized !== prompt) return null;
  const text = sanitized.toLowerCase();
  if (/\bnode\s*\.?\s*js\b|\bnodejs\b/.test(text)) return 'NodeApp';
  if (/\bpython\b/.test(text)) return 'PythonProject';
  if (/\b(?:website|web\s*app|webapp|site)\b/.test(text)) return 'WebApp';
  if (/\b(?:app|application|program)\b/.test(text)) return 'App';
  return null;
}

/** Returns a non-colliding folder name inside the workspace. */
export function uniqueProjectFolder(workspaceRoot: string, baseName: string): string {
  const sanitizedRoot = sanitizeInput(workspaceRoot, 4096);
  if (sanitizedRoot !== workspaceRoot) return baseName;
  const sanitizedBase = sanitizeInput(baseName, MAX_PROJECT_NAME_LENGTH);
  validateProjectName(sanitizedBase);
  let name = sanitizedBase;
  let i = 2;
  while (fs.existsSync(path.join(sanitizedRoot, name))) {
    name = `${sanitizedBase}${i}`;
    i++;
    if (i > 50) break;
  }
  return name;
}

/** Returns an existing user-named folder when the prompt explicitly names it.
 * This prevents "in my Portfolio folder" from silently becoming Portfolio2. */
export function requestedExistingProjectFolder(workspaceRoot: string, prompt: string): string | null {
  const sanitizedRoot = sanitizeInput(workspaceRoot, 4096);
  if (sanitizedRoot !== workspaceRoot) return null;
  const sanitizedPrompt = sanitizeInput(prompt, 4096);
  if (sanitizedPrompt !== prompt) return null;
  const patterns = [
    /\b(?:inside|within|under|in)\s+(?:the\s+)?(?:my\s+)?["'`]?([A-Za-z][A-Za-z0-9_./\\-]{0,100})["'`]?(?:\s+folder|\s+directory)\b/i,
    /\b(?:inside|within|under|in)\s+(?:the\s+)?(?:folder|directory)\s+["'`]?([^"'`\r\n,.]+?)["'`]?(?=\s+(?:and|with|containing|where|that)\b|[.!?]|$)/i,
    /\b(?:inside|within|under)\s+["'`]?([A-Za-z][A-Za-z0-9_./\\-]{0,100})["'`]?(?=\s|[.!?]|$)/i,
    /\b(?:existing|the)\s+["'`]?([A-Za-z][A-Za-z0-9_./\\-]{0,100})["'`]?(?:\s+project|\s+app|\s+site|\s+workspace)\b/i,
    /\b(?:project|app|site|workspace)\s+(?:named|called)\s+["'`]?([A-Za-z][A-Za-z0-9_./\\-]{0,100})["'`]?\b/i,
  ];
  for (const pattern of patterns) {
    const match = sanitizedPrompt.match(pattern);
    const candidate = match?.[1]?.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!candidate || candidate === '.' || candidate.includes('..') || path.isAbsolute(candidate)) continue;
    // Validate candidate project name
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(candidate)) continue;
    const resolved = path.resolve(sanitizedRoot, candidate);
    const relative = path.relative(sanitizedRoot, resolved).replace(/\\/g, '/');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    try {
      if (fs.statSync(resolved).isDirectory()) return relative;
    } catch {
      // The requested folder does not exist; normal project-name derivation
      // will create a deterministic new folder instead.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ProjectRunService — real process lifecycle for the RUN button
// ---------------------------------------------------------------------------

const MAX_OUTPUT_BYTES = 200_000;

export class ProjectRunService {
  private runs = new Map<string, ProjectRunInfo & { child: ChildProcess }>();
  /** project root → active run id (one live run per project). */
  private byRoot = new Map<string, string>();

  public start(root: string, profile: ProjectProfile): ProjectRunInfo | { error: string } {
    if (!profile.runCommand) {
      return { error: 'This project has no run command — it may be preview-only or not runnable.' };
    }
    if (!profile.runtimeAvailable && profile.language !== 'static-web') {
      return { error: `Runtime '${profile.runtimeBinary}' is not installed on this machine.` };
    }
    // Sanitize and validate root path
    const sanitizedRoot = sanitizeInput(root, 4096);
    if (sanitizedRoot !== root) return { error: 'Project root contains invalid characters.' };
    root = path.resolve(sanitizedRoot);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { error: 'Project root must be an existing directory.' };
    // Validate runCommand before execution
    try { validateCommand(profile.runCommand); } catch { return { error: 'Run command contains disallowed patterns.' }; }
    // Stop a previous run of the same project.
    const existing = this.byRoot.get(root);
    if (existing && !this.stop(existing)) {
      return { error: 'Could not stop the existing project process. Wait for it to exit before starting another run.' };
    }

    const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const info: ProjectRunInfo & { child: ChildProcess } = {
      id,
      root,
      command: profile.runCommand,
      status: 'running',
      output: `$ ${profile.runCommand}\n`,
      startedAt: Date.now(),
      child: null as unknown as ChildProcess,
    };

    try {
      const argv = parseCommand(profile.runCommand);
      const child = spawn(argv[0], argv.slice(1), {
        cwd: root,
        shell: false,
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      info.child = child;
      this.runs.set(id, info);
      this.byRoot.set(root, id);

      const append = (data: Buffer) => {
        info.output += data.toString('utf8');
        if (info.output.length > MAX_OUTPUT_BYTES) {
          info.output = info.output.slice(-Math.floor(MAX_OUTPUT_BYTES / 2)) + '\n… [output truncated]';
        }
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      child.on('error', (err) => {
        info.status = 'failed';
        info.output += `\n[Process error: ${err.message}]`;
        info.endedAt = Date.now();
      });
      child.on('close', (code) => {
        if (info.status === 'running') {
          info.status = code === 0 ? 'exited' : 'failed';
          info.exitCode = code ?? -1;
        }
        info.endedAt = Date.now();
      });
      return this.publicInfo(info);
    } catch (err: any) {
      return { error: `Failed to start project: ${err.message}` };
    }
  }

  public status(id: string): ProjectRunInfo | undefined {
    const run = this.runs.get(id);
    return run ? this.publicInfo(run) : undefined;
  }

  /** Active (or most recent) run for a project root. */
  public findByRoot(root: string): ProjectRunInfo | undefined {
    const id = this.byRoot.get(root);
    return id ? this.status(id) : undefined;
  }

  public stop(id: string): boolean {
    const run = this.runs.get(id);
    if (!run || run.status !== 'running') return false;
    if (!this.requestTermination(run.child)) return false;
    // Clean up byRoot mapping for this project root
    const rootId = this.byRoot.get(run.root);
    if (rootId === id) this.byRoot.delete(run.root);
    run.status = 'stopped';
    run.endedAt = Date.now();
    if (os.platform() !== 'win32') {
      setTimeout(() => {
        try {
          // PID reuse guard: only SIGKILL if process is still alive
          if (run.child.exitCode === null && run.child.kill(0)) {
            run.child.kill('SIGKILL');
          }
        } catch {
          // already gone or PID reused
        }
      }, 3000);
    }
    return true;
  }

  private requestTermination(child: ChildProcess): boolean {
    try {
      if (os.platform() === 'win32') {
        // Kill the whole process tree on Windows (shell → child).
        const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        return !result.error && result.status === 0;
      }
      return child.kill('SIGTERM');
    } catch {
      return false;
    }
  }

  public stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stop(id);
  }

  private publicInfo(run: ProjectRunInfo & { child: ChildProcess }): ProjectRunInfo {
    const { child: _child, ...rest } = run;
    return { ...rest };
  }
}
