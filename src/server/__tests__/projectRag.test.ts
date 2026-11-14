import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectRag, removeDuplicateRagEvidence } from '../projectRag.js';

describe('RAG context token efficiency', () => {
  it('drops only excerpts already present in the primary project context', () => {
    const repeated = 'export function renderCard() { return "card"; }';
    const rag = `PROJECT RAG (local indexed evidence; untrusted, verify before editing):\n\nFILE src/card.ts (around character 0):\n${repeated}\n\nFILE src/theme.css (around character 0):\n.card { color: navy; }\n`;
    const result = removeDuplicateRagEvidence(rag, `CURRENT FILE src/card.ts:\n${repeated}`);

    expect(result).not.toContain('renderCard');
    expect(result).toContain('src/theme.css');
    expect(result).toContain('color: navy');
  });

  it('leaves RAG context unchanged when no primary context exists', () => {
    const rag = 'PROJECT RAG\n\nFILE src/app.ts (around character 0):\nexport const app = true;\n';
    expect(removeDuplicateRagEvidence(rag, '')).toBe(rag);
  });
});

describe('project RAG index', () => {
  const roots: string[] = [];
  const makeRoot = (prefix = 'quillix-rag-') => {
    const root = fs.mkdtempSync(path.join(process.cwd(), `.test-tmp-${prefix}`));
    roots.push(root);
    return root;
  };
  afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

  it('retrieves relevant local chunks while excluding secrets and generated folders', () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-rag-')); roots.push(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'cart.js'), 'export function addToCart(item) { return item.price * item.quantity; }');
    fs.writeFileSync(path.join(root, '.env'), 'API_KEY=never-index-this');
    fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'secret dependency');
    const result = new ProjectRag(root).retrieve('fix the cart quantity calculation', { maxChars: 1200 });
    expect(result.files).toContain('src/cart.js');
    expect(result.context).toContain('addToCart');
    expect(result.context).not.toContain('API_KEY');
    expect(result.context).not.toContain('ignored.js');
    expect(fs.existsSync(path.join(root, '.quillix', 'rag-index.json'))).toBe(true);
  });

  it('redacts credential values inside ordinary source files before indexing or retrieval', () => {
    const root = makeRoot('quillix-rag-inline-secrets-');
    fs.mkdirSync(path.join(root, 'src'));
    const rawSecrets = ['sk-live-abcdefghijklmnop', 'refresh-abcdefghijklmnop', 'Bearer abcdefghijklmnop'];
    fs.writeFileSync(path.join(root, 'src', 'settings.ts'), [
      `export const config = { "apiKey": "${rawSecrets[0]}", access_token: "${rawSecrets[1]}" };`,
      `// Authorization: Bearer ${rawSecrets[2].slice('Bearer '.length)}`,
      'export const tokenCount = 12; // Keep ordinary token-budget code intact.',
    ].join('\n'));

    const result = new ProjectRag(root).retrieve('inspect settings api key token configuration', { maxChars: 1_800 });
    const persisted = fs.readFileSync(path.join(root, '.quillix', 'rag-index.json'), 'utf8');

    for (const secret of rawSecrets) {
      expect(result.context).not.toContain(secret);
      expect(persisted).not.toContain(secret);
    }
    expect(result.context).toContain('[REDACTED]');
    expect(result.context).toContain('tokenCount = 12');
    expect(JSON.parse(persisted).version).toBe(7);
  });

  it('excludes common dependency and build folders from RAG regardless of directory casing', () => {
    const root = makeRoot('quillix-rag-generated-folders-');
    const ignoredDirs = ['.venv', 'Vendor', 'bin', 'obj', 'out', '.idea', '.tox', '.gradle', '.mypy_cache', '.ruff_cache', '.bundle', 'Pods'];
    for (const dir of ignoredDirs) {
      fs.mkdirSync(path.join(root, dir), {recursive: true});
      fs.writeFileSync(path.join(root, dir, 'implementation.ts'), `export const OnlyDependencyMarker${dir.replace(/\W/g, '')} = true;`);
    }
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const realApplicationSource = true;');

    const result = new ProjectRag(root).retrieve('OnlyDependencyMarker Vendor', {maxChars: 1800, maxChunks: 4});
    const persisted = JSON.parse(fs.readFileSync(path.join(root, '.quillix', 'rag-index.json'), 'utf8'));

    expect(Object.keys(persisted.files)).toEqual(['src/app.ts']);
    expect(result.context).not.toContain('OnlyDependencyMarker');
    expect(result.files).toEqual([]);
  });

  it('retrieves an explicitly selected generated-folder file without indexing that folder', () => {
    const root = makeRoot('quillix-rag-selected-dist-');
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<main class="release-shell">Production preview</main>');
    fs.writeFileSync(path.join(root, 'src.ts'), 'export const applicationSource = true;');

    const rag = new ProjectRag(root);
    const ordinary = rag.retrieve('release shell production preview', { maxChars: 1200, maxChunks: 3 });
    const selected = rag.retrieve('improve the selected page layout', {
      currentFile: 'dist/index.html', maxChars: 1200, maxChunks: 3,
    });
    const persisted = JSON.parse(fs.readFileSync(path.join(root, '.quillix', 'rag-index.json'), 'utf8'));

    expect(Object.keys(persisted.files)).not.toContain('dist/index.html');
    expect(ordinary.files).not.toContain('dist/index.html');
    expect(selected.files[0]).toBe('dist/index.html');
    expect(selected.context).toContain('release-shell');
  });

  it('ignores TypeScript integration output so generated copies cannot outrank source', () => {
    const root = makeRoot('quillix-rag-qa-dist-');
    fs.mkdirSync(path.join(root, 'src', 'server'), { recursive: true });
    fs.mkdirSync(path.join(root, '.qa-dist', 'src', 'server'), { recursive: true });
    fs.mkdirSync(path.join(root, '.quillix-smoke', 'run-1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'server', 'providerRouter.ts'), 'export function scheduleProviderRequest(rateLimitCooldown: number) { return rateLimitCooldown; }');
    fs.writeFileSync(path.join(root, '.qa-dist', 'src', 'server', 'providerRouter.js'), 'export function scheduleProviderRequest(rateLimitCooldown: number) { return rateLimitCooldown; }');
    fs.writeFileSync(path.join(root, '.quillix-smoke', 'run-1', 'summary.json'), '{"scheduleProviderRequest":"rateLimitCooldown"}');

    const result = new ProjectRag(root).retrieve('schedule provider request rate limit cooldown', { maxChunks: 3 });

    expect(result.files).toContain('src/server/providerRouter.ts');
    expect(result.files.some(file => file.startsWith('.qa-dist/'))).toBe(false);
    expect(result.files.some(file => file.startsWith('.quillix-smoke/'))).toBe(false);
    expect(result.files[0]).toBe('src/server/providerRouter.ts');
  });

  it('does not index temporary QUILLIX benchmark workspaces inside the repository', () => {
    const root = makeRoot('quillix-rag-scratch-');
    fs.mkdirSync(path.join(root, 'qx-Ab12Cd'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src.ts'), 'export const stableSource = true;');
    fs.writeFileSync(path.join(root, 'qx-Ab12Cd', 'settings.json'), '{"universalModel":"scratch-only"}');

    const result = new ProjectRag(root).retrieve('settings universal model scratch', { maxChunks: 4 });
    const persisted = JSON.parse(fs.readFileSync(path.join(root, '.quillix', 'rag-index.json'), 'utf8'));

    expect(Object.keys(persisted.files)).not.toContain('qx-Ab12Cd/settings.json');
    expect(result.context).not.toContain('scratch-only');
  });

  it('refreshes only when source metadata changes and keeps output bounded', () => {
    const root = makeRoot('quillix-rag-');
    fs.writeFileSync(path.join(root, 'README.md'), ' '.repeat(4000) + ' deployment instructions');
    const rag = new ProjectRag(root);
    const first = rag.retrieve('deployment instructions', { maxChars: 900, maxChunks: 2 });
    const second = rag.retrieve('deployment instructions', { maxChars: 900, maxChunks: 2 });
    expect(first.context.length).toBeLessThanOrEqual(900);
    expect(second.context).toBe(first.context);
    expect(second.indexedChunks).toBeGreaterThan(0);
  });

  it('reuses the persisted index after restart without rereading unchanged source files', () => {
    const root = makeRoot('quillix-rag-cache-restart-');
    const source = path.join(root, 'src.ts');
    fs.writeFileSync(source, 'export function cachedWorkspaceAnswer() { return "cached"; }');
    const initial = new ProjectRag(root).retrieve('cachedWorkspaceAnswer', { maxChars: 1200, maxChunks: 2 });
    expect(initial.context).toContain('cachedWorkspaceAnswer');

    const readFileSync = fs.readFileSync;
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((file: any, ...args: any[]) => {
      if (path.resolve(String(file)) === source) throw new Error('unchanged source should not be reread');
      return (readFileSync as any).call(fs, file, ...args);
    }) as any);
    try {
      const resumed = new ProjectRag(root).retrieve('cachedWorkspaceAnswer', { maxChars: 1200, maxChunks: 2 });
      expect(resumed.context).toContain('cachedWorkspaceAnswer');
      expect(resumed.context).toBe(initial.context);
    } finally {
      readSpy.mockRestore();
    }
  });

  it('uses a dirty active editor buffer instead of stale indexed disk chunks', () => {
    const root = makeRoot('quillix-rag-unsaved-buffer-');
    const source = path.join(root, 'src.ts');
    fs.writeFileSync(source, 'export const diskVersion = "old";');
    const rag = new ProjectRag(root);
    expect(rag.retrieve('inspect diskVersion', { currentFile: 'src.ts' }).context).toContain('diskVersion');

    const unsaved = 'export const editorVersion = "new-unsaved-value";';
    const result = rag.retrieve('inspect editorVersion', { currentFile: 'src.ts', currentFileContent: unsaved, maxChars: 1400, maxChunks: 3 });
    expect(result.files).toContain('src.ts');
    expect(result.context).toContain('new-unsaved-value');
    expect(result.context).not.toContain('diskVersion');
    expect(fs.readFileSync(source, 'utf8')).toContain('diskVersion');
  });

  it('reads only changed and new source files after restarting with a populated index', () => {
    const root = makeRoot('quillix-rag-incremental-');
    for (let index = 0; index < 100; index++) {
      fs.writeFileSync(path.join(root, `module-${index}.ts`), 'export const ordinary = true;');
    }
    const edited = path.join(root, 'checkout.ts');
    const added = path.join(root, 'shipping.ts');
    const removed = path.join(root, 'legacy.ts');
    fs.writeFileSync(edited, 'export const oldCheckout = true;');
    fs.writeFileSync(removed, 'export const updatedCheckoutTotal = -1;');
    new ProjectRag(root).retrieve('checkout');

    fs.writeFileSync(edited, 'export const updatedCheckoutTotal = 42;');
    fs.writeFileSync(added, 'export const updatedCheckoutShipping = 5;');
    fs.unlinkSync(removed);
    const readSpy = vi.spyOn(fs, 'readFileSync');
    try {
      const rag = new ProjectRag(root);
      const prompt = 'change updatedCheckoutTotal and updatedCheckoutShipping';
      const result = rag.retrieve(prompt);
      const sourceReads = () => readSpy.mock.calls.map(([file]) => String(file))
        .filter(file => path.dirname(file) === root);
      expect(result.files).toEqual(['checkout.ts', 'shipping.ts']);
      expect(result.context).toContain('updatedCheckoutTotal = 42');
      expect(result.context).not.toContain('oldCheckout');
      expect(sourceReads()).toHaveLength(2);
      expect(sourceReads().sort()).toEqual([edited, added].sort());

      readSpy.mockClear();
      expect(rag.retrieve(prompt)).toEqual(result);
      expect(sourceReads()).toEqual([]);
    } finally {
      readSpy.mockRestore();
    }
  });

  it('invalidates a persisted index when same-size content changes but mtime is restored', async () => {
    const root = makeRoot('quillix-rag-same-size-edit-');
    const source = path.join(root, 'src.ts');
    fs.writeFileSync(source, 'export const oldTargetName = "alpha";');
    const justWritten = fs.statSync(source);
    fs.utimesSync(source, justWritten.atime, Math.floor(justWritten.mtimeMs) / 1000);
    const before = fs.statSync(source);
    const initial = new ProjectRag(root).retrieve('oldTargetName', { maxChars: 1200, maxChunks: 2 });
    expect(initial.context).toContain('oldTargetName');

    await new Promise(resolve => setTimeout(resolve, 25));
    fs.writeFileSync(source, 'export const newTargetName = "bravo";');
    fs.utimesSync(source, before.atime, before.mtime);
    const after = fs.statSync(source);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ctimeMs).not.toBe(before.ctimeMs);

    const refreshed = new ProjectRag(root).retrieve('newTargetName', { maxChars: 1200, maxChunks: 2 });
    expect(refreshed.context).toContain('newTargetName');
    expect(refreshed.context).not.toContain('oldTargetName');
  });

  it('keeps declarations intact when a chunk boundary lands near a source line', () => {
    const root = makeRoot('quillix-rag-lines-');
    fs.mkdirSync(path.join(root, 'src'));
    const declaration = 'export function calculateInventory(stock: number) { return stock + 1; }';
    fs.writeFileSync(path.join(root, 'src', 'inventory.ts'), `${'x'.repeat(1300)}\n${declaration}\n`);

    const result = new ProjectRag(root).retrieve('find calculateInventory implementation', { maxChars: 1800, maxChunks: 2 });
    const persisted = JSON.parse(fs.readFileSync(path.join(root, '.quillix', 'rag-index.json'), 'utf8'));

    expect(persisted.version).toBe(7);
    expect(persisted.chunks.some((chunk: { file: string; content: string }) =>
      chunk.file === 'src/inventory.ts' && chunk.content.includes(declaration))).toBe(true);
    expect(result.files).toContain('src/inventory.ts');
    expect(result.context).toContain('calculateInventory');
  });

  it('ranks symbol and import relationships above generic keyword matches', () => {
    const root = makeRoot('quillix-rag-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'cart.js'), "import { formatMoney } from './money.js';\nexport function addToCart(item) { return formatMoney(item.price); }\n");
    fs.writeFileSync(path.join(root, 'src', 'money.js'), 'export function formatMoney(value) { return `$${value}`; }\n');
    fs.writeFileSync(path.join(root, 'src', 'unrelated.js'), 'export function render(value) { return value; }\n');
    const result = new ProjectRag(root).retrieve('change addToCart to use formatMoney', { maxChars: 1800, maxChunks: 2 });
    expect(result.files[0]).toBe('src/cart.js');
    expect(result.context).toContain('addToCart');
    expect(result.context).toContain('symbols/references');
  });

  it('prioritizes rare feature terms over a filename-sorted generic keyword tie', () => {
    const root = makeRoot('quillix-rag-idf-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    for (let index = 0; index < 20; index++) {
      fs.writeFileSync(path.join(root, 'src', `module-${String(index).padStart(2, '0')}.ts`),
        `export const state${index} = 'account session state';`);
    }
    fs.writeFileSync(path.join(root, 'src', 'a-generic-account.ts'),
      "export const accountSession = 'account session';");
    fs.writeFileSync(path.join(root, 'src', 'z-renewal-rotation.ts'),
      "export const renewalRotation = 'renewal rotation';");

    const result = new ProjectRag(root).retrieve('update account session renewal rotation workflow', {
      maxChars: 1800, maxChunks: 1,
    });

    expect(result.files[0]).toBe('src/z-renewal-rotation.ts');
    expect(result.context).toContain('renewalRotation');
  });

  it('reserves the first chunk for later files before indexing extra chunks from large files', () => {
    const root = makeRoot('quillix-rag-fair-');
    const content = `${'shared implementation details and general project logic\n'.repeat(260)}\nexport const uniqueTarget = true;`;
    for (let index = 0; index < 110; index++) {
      fs.writeFileSync(path.join(root, `module-${String(index).padStart(3, '0')}.ts`), `${content}\n// module ${index}`);
    }

    new ProjectRag(root).retrieve('uniqueTarget', { maxChunks: 2 });
    const index = JSON.parse(fs.readFileSync(path.join(root, '.quillix', 'rag-index.json'), 'utf8'));
    const indexedFiles = new Set(index.chunks.map((chunk: { file: string }) => chunk.file));

    expect(index.chunks.length).toBe(900);
    expect(indexedFiles.size).toBe(110);
    expect(indexedFiles.has('module-109.ts')).toBe(true);
  });

  it('finds a requested symbol beyond the persisted chunk budget', () => {
    const root = makeRoot('quillix-rag-tail-');
    const body = 'const ordinary = 1; // shared project implementation\n'.repeat(260);
    for (let index = 0; index < 110; index++) {
      fs.writeFileSync(path.join(root, `module-${String(index).padStart(3, '0')}.ts`),
        body + (index === 109 ? '\nexport function resolveRareBoundary() { return ordinary; }\n' : ''));
    }

    const rag = new ProjectRag(root);
    const prompt = 'change resolveRareBoundary behavior';
    const result = rag.retrieve(prompt, { maxChars: 2200 });
    const indexPath = path.join(root, '.quillix', 'rag-index.json');
    const persisted = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

    expect(persisted.chunks.some((chunk: { content: string }) => chunk.content.includes('resolveRareBoundary'))).toBe(false);
    expect(result.files[0]).toBe('module-109.ts');
    expect(result.context).toContain('resolveRareBoundary');

    const edited = path.join(root, 'module-000.ts');
    fs.appendFileSync(edited, '// edited');
    const readSpy = vi.spyOn(fs, 'readFileSync');
    try {
      rag.retrieve('ordinary implementation');
      const sourceReads = readSpy.mock.calls.map(([file]) => String(file)).filter(file => path.dirname(file) === root);
      expect(sourceReads).toEqual([edited]);
    } finally {
      readSpy.mockRestore();
    }

    for (let index = 0; index < 50; index++) {
      fs.unlinkSync(path.join(root, `module-${String(index).padStart(3, '0')}.ts`));
    }
    expect(rag.retrieve(prompt, { maxChars: 2200 }).files[0]).toBe('module-109.ts');
    const expanded = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    expect(expanded.chunks.some((chunk: { content: string }) => chunk.content.includes('resolveRareBoundary'))).toBe(true);
  });

  it('retrieves an open stylesheet even when the file limit excludes it', () => {
    const root = makeRoot('quillix-rag-open-');
    for (let index = 0; index < 420; index++) {
      fs.writeFileSync(path.join(root, `a-${String(index).padStart(3, '0')}.ts`), 'export const ordinary = true;');
    }
    fs.writeFileSync(path.join(root, 'z-selected.css'), '.mobile-menu { display: grid; }');
    const outside = path.join(os.tmpdir(), `quillix-rag-secret-${path.basename(root)}.css`);
    fs.writeFileSync(outside, '.private-key { color: red; }');
    try {
      const rag = new ProjectRag(root);
      const selected = rag.retrieve('upgrade CSS for mobile', { currentFile: 'z-selected.css', maxChars: 1500 });
      const escaped = rag.retrieve('show private key', { currentFile: outside, maxChars: 1500 });
      const persisted = JSON.parse(fs.readFileSync(path.join(root, '.quillix', 'rag-index.json'), 'utf8'));

      expect(persisted.files['z-selected.css']).toBeUndefined();
      expect(selected.files[0]).toBe('z-selected.css');
      expect(selected.context).toContain('.mobile-menu');
      expect(escaped.context).not.toContain('.private-key');
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('retrieves a late symbol from a selected file larger than the normal index limit', () => {
    const root = makeRoot('quillix-rag-large-open-');
    fs.writeFileSync(path.join(root, 'large.ts'),
      `${'const ordinaryLine = true;\n'.repeat(6000)}\nexport function resolveLargeTarget() { return 42; }\n`);

    const result = new ProjectRag(root).retrieve('change resolveLargeTarget', {
      currentFile: 'large.ts', maxChars: 2000, maxChunks: 2,
    });
    expect(fs.existsSync(path.join(root, '.quillix', 'rag-index.json'))).toBe(false);
    expect(result.indexedChunks).toBe(0);
    expect(result.files[0]).toBe('large.ts');
    expect(result.context).toContain('resolveLargeTarget');
  });

  it('resolves workspace-relative editor paths inside a nested project only', () => {
    const workspace = makeRoot('quillix-rag-nested-');
    const root = path.join(workspace, 'Store');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const selectedStore = true;');
    fs.writeFileSync(path.join(root, 'other.ts'), 'export const ordinary = true;');
    fs.writeFileSync(path.join(workspace, 'app.ts'), 'export const parentWorkspace = true;');
    const rag = new ProjectRag(root);
    const result = rag.retrieve('improve it', { currentFile: path.join('Store', 'app.ts'), currentFileBase: workspace });
    expect(result.files[0]).toBe('app.ts');
    expect(result.context).toContain('selectedStore');
    const outside = rag.retrieve('inspect ordinary', { currentFile: 'app.ts', currentFileBase: workspace });
    expect(outside.files).toEqual(rag.retrieve('inspect ordinary').files);
    expect(outside.files[0]).toBe('other.ts');
    expect(outside.context).not.toContain('parentWorkspace');
  });

  it('does not retrieve a selected path aliased into an ignored directory', ({ skip }) => {
    const root = makeRoot('quillix-rag-alias-');
    const ignored = path.join(root, '.quillix');
    fs.mkdirSync(ignored);
    fs.writeFileSync(path.join(ignored, 'internal.ts'), 'export const protectedEvidence = true;');
    try {
      fs.symlinkSync(ignored, path.join(root, 'alias'), 'junction');
    } catch (error: any) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return skip('Directory junction creation is restricted by this environment.');
      throw error;
    }
    const result = new ProjectRag(root).retrieve('inspect protectedEvidence', { currentFile: 'alias/internal.ts' });
    expect(result.context).not.toContain('protectedEvidence');
    expect(result.files).toEqual([]);
  });

  it('pulls a direct local import when a cross-file change names only the implementation file', () => {
    const root = makeRoot('quillix-rag-');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'cart.js'), "import { formatMoney } from './money.js';\nexport function addToCart(item) { return formatMoney(item.price); }\n");
    fs.writeFileSync(path.join(root, 'src', 'money.js'), 'export function formatMoney(value) { return `$${value}`; }\n');
    fs.writeFileSync(path.join(root, 'src', 'unrelated.js'), 'export function render(value) { return value; }\n');
    const result = new ProjectRag(root).retrieve('change addToCart behavior', { maxChars: 2200, maxChunks: 2 });
    expect(result.files[0]).toBe('src/cart.js');
    expect(result.files).toContain('src/money.js');
    expect(result.context).toContain('formatMoney');
  });

  it('retrieves bounded two-hop imports for a multi-file feature continuation', () => {
    const root = makeRoot('quillix-rag-two-hop-');
    fs.mkdirSync(path.join(root, 'src', 'features'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'shared'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'app.js'),
      "import { attachCheckout } from './features/checkout.js';\nexport function mountCheckout() { return attachCheckout(); }\n");
    fs.writeFileSync(path.join(root, 'src', 'features', 'checkout.js'),
      "import { calculateLevy } from '../shared/levy.js';\nexport function attachCheckout() { return calculateLevy(); }\n");
    fs.writeFileSync(path.join(root, 'src', 'shared', 'levy.js'),
      'export function calculateLevy() { return 0; }\n');
    fs.writeFileSync(path.join(root, 'src', 'unrelated.js'),
      'export function renderSidebar() { return null; }\n');

    const result = new ProjectRag(root).retrieve('change mountCheckout behavior', {
      maxChars: 2_600, maxChunks: 3,
    });

    expect(result.files.slice(0, 3)).toEqual([
      'src/app.js',
      'src/features/checkout.js',
      'src/shared/levy.js',
    ]);
    expect(result.context).toContain('calculateLevy');
    expect(result.files).not.toContain('src/unrelated.js');
  });

  it('retrieves linked CSS and JavaScript from an HTML entry file', () => {
    const root = makeRoot('quillix-rag-html-links-');
    fs.writeFileSync(path.join(root, 'index.html'), '<link rel="stylesheet" href="/styles/site.css"><script defer src="./scripts/app.js"></script>');
    fs.mkdirSync(path.join(root, 'styles'));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'styles', 'site.css'), '@import "./tokens.css";\n.hero { background: var(--hero-bg); }');
    fs.writeFileSync(path.join(root, 'styles', 'tokens.css'), ':root { --hero-bg: navy; }');
    fs.writeFileSync(path.join(root, 'scripts', 'app.js'), 'document.querySelector(".hero").classList.add("ready");');

    const result = new ProjectRag(root).retrieve('change the hero background and interaction', {
      currentFile: 'index.html', maxChars: 2_800, maxChunks: 4,
    });

    expect(result.files).toContain('index.html');
    expect(result.files).toContain('styles/site.css');
    expect(result.files).toContain('scripts/app.js');
    expect(result.context).toContain('--hero-bg');
  });

  it('retrieves CSS @import companions but ignores remote asset URLs', () => {
    const root = makeRoot('quillix-rag-css-links-');
    fs.mkdirSync(path.join(root, 'styles'));
    fs.writeFileSync(path.join(root, 'styles', 'theme.css'), '@import url("./tokens.css");\nbody { background: url("https://cdn.example/image.png"); }');
    fs.writeFileSync(path.join(root, 'styles', 'tokens.css'), ':root { --accent: teal; }');

    const result = new ProjectRag(root).retrieve('change the theme accent', {
      currentFile: 'styles/theme.css', maxChars: 1_800, maxChunks: 3,
    });

    expect(result.files).toContain('styles/tokens.css');
    expect(result.context).toContain('--accent');
    expect(result.files.some(file => file.includes('cdn.example'))).toBe(false);
  });

  it('indexes design-token source while excluding credential token files', () => {
    const root = makeRoot('quillix-rag-token-names-');
    fs.writeFileSync(path.join(root, 'tokens.css'), ':root { --surface: ivory; }');
    fs.writeFileSync(path.join(root, 'access_token.txt'), 'sensitive-access-token-value');

    const result = new ProjectRag(root).retrieve('change the surface color', { maxChars: 1_600, maxChunks: 2 });
    const persisted = JSON.parse(fs.readFileSync(path.join(root, '.quillix', 'rag-index.json'), 'utf8'));

    expect(result.files).toContain('tokens.css');
    expect(result.context).toContain('--surface');
    expect(Object.keys(persisted.files)).not.toContain('access_token.txt');
    expect(result.context).not.toContain('sensitive-access-token-value');
  });

  it('includes implementation and tests instead of filling context with changelog repetitions', () => {
    const root = makeRoot('quillix-rag-');
    fs.mkdirSync(path.join(root, 'lib'));
    fs.mkdirSync(path.join(root, 'test'));
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), 'fix default body length request payload limit redirect consistency documentation\n'.repeat(100));
    fs.writeFileSync(path.join(root, 'lib/http.js'), 'function sendRequest(config) { options.maxBodyLength = config.maxBodyLength; }');
    fs.writeFileSync(path.join(root, 'test/http.js'), 'function testBodyLimit() { assert.equal(client.maxBodyLength, -1); }');
    const result = new ProjectRag(root).retrieve('Fix inconsistent default maxBodyLength request payload limit when following redirects. Update documentation.', {maxChars: 2600, maxChunks: 3});
    expect(result.files.slice(0, 2)).toEqual(['lib/http.js', 'test/http.js']);
    expect(result.context.length).toBeLessThanOrEqual(2600);
  });

  it('retrieves Hindi project evidence from a Hindi follow-up prompt', () => {
    const root = makeRoot('quillix-rag-hi-');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'cart-total.js'), '// कार्ट का कुल गलत निकलता है\nexport function calculateCartTotal(items) { return items.length; }\n');
    fs.writeFileSync(path.join(root, 'src', 'profile.js'), '// प्रोफाइल का नाम दिखाओ\nexport function renderProfile(name) { return name; }\n');

    const result = new ProjectRag(root).retrieve('कार्ट का कुल ठीक करो', { maxChars: 1800, maxChunks: 2 });

    expect(result.files[0]).toBe('src/cart-total.js');
    expect(result.context).toContain('कार्ट का कुल गलत निकलता है');
  });
});
