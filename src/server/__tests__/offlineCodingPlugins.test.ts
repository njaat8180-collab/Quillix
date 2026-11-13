import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { OfflineCodingPlugins, relevantCodingTools } from '../offlineCodingPlugins.js';
import { ToolRegistry } from '../toolRegistry.js';
import { WorkspaceManager } from '../workspace.js';
import { SettingsStore } from '../settings.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { AgentEngine } from '../agentEngine.js';
import { WorkspaceVerifier } from '../verifier.js';
import { classifyIntent } from '../intentRouter.js';
import { NodeDebugger } from '../nodeDebugger.js';
import type { AIProvider, AICompletionOptions } from '../qwen.js';

async function canConnectLoopback(): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      server.close(() => resolve(available));
    };
    server.once('error', () => finish(false));
    timer = setTimeout(() => finish(false), 1000);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return finish(false);
      const client = net.connect(address.port, '127.0.0.1');
      client.once('connect', () => { client.destroy(); finish(true); });
      client.once('error', () => { client.destroy(); finish(false); });
    });
  });
}

/** True only when the tree-sitter native binding actually loads AND parses on
 * this host. Application Control policies can block the .node file, in which
 * case the tree-sitter plugin degrades to its documented AST fallback and the
 * positive path cannot be verified here. */
async function treeSitterBindingLoads(): Promise<boolean> {
  try {
    const [Parser, JavaScriptGrammar, PythonGrammar] = await Promise.all([
      import('tree-sitter'),
      import('tree-sitter-javascript'),
      import('tree-sitter-python'),
    ]);
    const ParserClass = (Parser as any).default ?? Parser;
    const parser = new ParserClass();
    parser.setLanguage((JavaScriptGrammar as any).default ?? JavaScriptGrammar);
    const tree = parser.parse('function probe() { return 1; }');
    if (!tree?.rootNode || tree.rootNode.hasError) return false;
    const pythonParser = new ParserClass();
    pythonParser.setLanguage((PythonGrammar as any).default ?? PythonGrammar);
    const pythonTree = pythonParser.parse('def probe():\n  return 1\n');
    return Boolean(pythonTree?.rootNode) && !pythonTree.rootNode.hasError;
  } catch {
    return false;
  }
}

describe('bundled offline coding plugins', () => {
  let root: string, workspace: WorkspaceManager, settings: SettingsStore, registry: ToolRegistry;
  const write = (file: string, content: string) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
  const run = (name: string, args: any = {}) => registry.executeTool('test', `plugin_${name}`, args);
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-offline-plugins-'));
    workspace = new WorkspaceManager(root);
    settings = new SettingsStore(path.join(root, '.quillix/settings.json'));
    settings.update({ autoApplyDiffs: true });
    const terminal = new TerminalService(), git = new GitService(terminal);
    registry = new ToolRegistry(workspace, terminal, git, new CodebaseIndexer(workspace, git), settings);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in offline plugin tests.'); }));
  });
  afterEach(async () => { await registry.codingPlugins.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

  it('exposes sixteen real offline packs, with unique registered schemas', () => {
    const catalog = registry.codingPlugins.catalog();
    expect(catalog).toHaveLength(16);
    expect(catalog.every(p => p.enabled && p.offline)).toBe(true);
    const definitions = registry.codingPlugins.definitions();
    expect(definitions).toHaveLength(29);
    expect(new Set(definitions.map(t => t.name)).size).toBe(29);
    expect(catalog.flatMap(p => p.tools).sort()).toEqual(definitions.map(d => d.name).sort());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('formats with local Prettier without reading executable workspace config', async () => {
    write('app.ts', 'const n:number=1');
    write('.prettierrc.cjs', 'throw new Error("Must not execute workspace configuration")');
    expect((await run('format_check', { filePath: 'app.ts' })).success).toBe(false);
    expect((await run('format_file', { filePath: 'app.ts' })).success).toBe(true);
    expect(fs.readFileSync(path.join(root, 'app.ts'), 'utf8')).toBe('const n: number = 1;\n');
    expect((await run('format_check', { filePath: 'app.ts' })).success).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stages formatter changes when Auto Apply Diffs is off', async () => {
    write('app.js', 'const n=1'); settings.update({ autoApplyDiffs: false });
    const result = await run('format_file', { filePath: 'app.js' });
    expect(result.success).toBe(true); expect(result.staged).toBe(true);
    expect(result.data.filePath).toBe('app.js');
    expect(result.data.newContent).toBe('const n = 1;\n');
    expect(fs.readFileSync(path.join(root, 'app.js'), 'utf8')).toBe('const n=1');
  });

  it('formats multiple bundled languages without any network access', async () => {
    for (const [filePath, content] of Object.entries({ 'page.html': '<div><p>Hello</p></div>', 'style.css': 'a{color:red}', 'data.json': '{"enabled":true}', 'data.yaml': 'items: [one,two]', 'README.md': '#   Hello\n\n\nText' })) {
      write(filePath, content);
      expect((await run('format_file', { filePath })).success, filePath).toBe(true);
      expect((await run('format_check', { filePath })).success, filePath).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses stale async formatter output after the file changes', async () => {
    write('race.js', 'const n=1');
    const pending = run('format_file', { filePath: 'race.js' });
    write('race.js', 'const n=2;');
    expect((await pending).success).toBe(false);
    expect(fs.readFileSync(path.join(root, 'race.js'), 'utf8')).toBe('const n=2;');
  });

  it('refuses async formatter output after switching workspaces', async () => {
    write('race.js', 'const n=1'); write('other/race.js', 'const n=1');
    const pending = run('format_file', { filePath: 'race.js' });
    workspace.setRoot(path.join(root, 'other'));
    expect((await pending).success).toBe(false);
    expect(fs.readFileSync(path.join(root, 'other/race.js'), 'utf8')).toBe('const n=1');
  });

  it('rebinds the stateful debugger after switching workspaces', async ({ skip }) => {
    if (!await canConnectLoopback()) return skip('Loopback TCP connections are restricted by this environment.');
    const other = path.join(root, 'other');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'debug-target.js'), 'const answer = 41; console.log(answer);');
    workspace.setRoot(other);
    await registry.setWorkspaceRoot(other);
    const launch = await registry.executeTool('rebind', 'plugin_debug_launch', { filePath: 'debug-target.js' }, { preApproved: true });
    expect(launch.success).toBe(true);
    const sessionId = launch.data.sessionId;
    const evaluated = await registry.executeTool('rebind-eval', 'plugin_debug_evaluate', { sessionId, expression: '1 + 1' }, { preApproved: true });
    expect(evaluated.success).toBe(true);
    expect(evaluated.data.result.value).toBe(2);
    await registry.executeTool('rebind-stop', 'plugin_debug_stop', { sessionId }, { preApproved: true });
  });

  it('refuses to write redacted secret values back into a source file', async () => {
    const original = 'const api_key="not-a-real-test-secret";'; write('app.js', original);
    const result = await run('format_file', { filePath: 'app.js' });
    expect(result.success).toBe(false); expect(result.error).toMatch(/masked secret/);
    expect(fs.readFileSync(path.join(root, 'app.js'), 'utf8')).toBe(original);
  });

  it('parses TypeScript and reports syntax locations without executing code', async () => {
    write('app.ts', 'throw new Error("Never execute");\nexport const n: number = 1;');
    expect((await run('syntax_diagnostics', { filePath: 'app.ts' })).data.valid).toBe(true);
    write('bad.ts', 'export function nope( {');
    const result = await run('syntax_diagnostics', { filePath: 'bad.ts' });
    expect(result.success).toBe(false); expect(result.data.diagnostics[0].line).toBe(1);
    write('app.py', 'print(1)'); expect((await run('syntax_diagnostics', { filePath: 'app.py' })).success).toBe(false);
  });

  it('uses AST declarations rather than matching symbols in strings/comments', async () => {
    write('code.ts', '// function fake() {}\nconst text = "class Imaginary {}";\nexport interface User { name: string }\nexport function greet(user: User) { return user.name; }');
    const result = await run('symbols_outline', { filePath: 'code.ts' });
    expect(result.data.items.map((s: any) => s.name)).toEqual(['text', 'User', 'greet']);
    expect(result.data.items[2].line).toBe(4);
  });

  it('inspects imports, re-exports and literal require/import expressions', async () => {
    write('code.ts', 'import x from "./x"; export { y } from "./y"; const z = require("node:path"); const later = import("./later");');
    const result = await run('imports_inspect', { filePath: 'code.ts' });
    expect(result.success).toBe(true);
    expect(result.data.items.map((s: any) => s.source)).toEqual(['./x', './y', 'node:path', './later']);
  });

  it('validates JSON strictly, JSONC comments, and YAML duplicate keys', async () => {
    write('config.jsonc', '{ // comment\n "name": "demo",\n}');
    expect((await run('config_validate', { filePath: 'config.jsonc' })).success).toBe(true);
    write('config.json', '{ // comment\n "name": "demo",\n}');
    const json = await run('config_validate', { filePath: 'config.json' });
    expect(json.success).toBe(false); expect(json.data.errors[0].line).toBe(1);
    write('config.yaml', 'name: one\nname: two\n');
    const yaml = await run('config_validate', { filePath: 'config.yaml' });
    expect(yaml.success).toBe(false); expect(yaml.data.errors[0].code).toBe('DUPLICATE_KEY');
    write('good.yaml', 'name: one\n'); expect((await run('config_validate', { filePath: 'good.yaml' })).success).toBe(true);
  });

  it('scans TODOs but excludes secrets, node_modules and generated outputs', async () => {
    write('src/app.py', '# TODO: add test\n# FIXME: edge case');
    write('.env', 'TODO=secret'); write('node_modules/pkg/index.js', '// TODO hidden'); write('dist/index.js', '// TODO generated');
    const result = await run('todos_scan');
    expect(result.data.matches).toHaveLength(2);
    expect(result.data.matches[0].filePath).toBe('src/app.py');
    expect(JSON.stringify(result.data)).not.toContain('TODO=secret');
  });

  it('bounds scan results and makes truncation explicit', async () => {
    write('huge.txt', '// TODO fix\n'.repeat(220));
    const result = await run('todos_scan');
    expect(result.data.matches).toHaveLength(200); expect(result.data.truncated).toBe(true);
  });

  it('inspects dependency declarations without executing package scripts or downloads', async () => {
    write('package.json', JSON.stringify({ name: 'demo', dependencies: { react: '^19' }, scripts: { postinstall: 'do-not-run' } }));
    write('requirements.txt', 'pytest==8.0\n'); write('Cargo.toml', '[package]\nname="demo"\n'); write('go.mod', 'module example.test/demo\n');
    const result = await run('dependencies_inspect');
    expect(result.data.manifests).toHaveLength(4); expect(result.data.manifests[0].dependencies.react).toBe('^19');
    expect(result.output).not.toContain('do-not-run'); expect(fetch).not.toHaveBeenCalled();
  });

  it('reads agent/Cursor rules as explicitly untrusted context', async () => {
    write('AGENTS.md', 'Use tests.'); write('.cursorrules', 'TypeScript.'); write('.cursor/rules/tests.mdc', 'Run checks.');
    const result = await run('rules_read');
    expect(result.data.rules).toHaveLength(3); expect(result.data.trust).toMatch(/Untrusted/);
  });

  it('finds whitespace problems without modifying the file', async () => {
    write('file.py', ' \tprint(1)  ');
    const result = await run('whitespace_check', { filePath: 'file.py' });
    expect(result.success).toBe(false); expect(result.data.issues.map((i: any) => i.code)).toEqual(['trailing-whitespace', 'mixed-indentation', 'missing-final-newline']);
    expect(fs.readFileSync(path.join(root, 'file.py'), 'utf8')).toBe(' \tprint(1)  ');
  });

  it('extracts Markdown headings and links but skips fenced examples', async () => {
    write('README.md', '# Main\n```js\n# Not a heading\n[fake](https://invalid.test)\n```\n## Usage\n[Guide](./guide.md)\n');
    const result = await run('markdown_outline', { filePath: 'README.md' });
    expect(result.data.headings.map((h: any) => h.text)).toEqual(['Main', 'Usage']);
    expect(result.data.links).toHaveLength(1); expect(fetch).not.toHaveBeenCalled();
  });

  it('audits a static website locally and catches missing behavior references', async () => {
    write('index.html', '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Store</title><link rel="stylesheet" href="style.css"><script src="script.js"></script></head><body><main><button type="button">Buy</button></main></body></html>');
    write('style.css', ':focus-visible{outline:2px solid blue}@media (max-width:600px){main{padding:1rem}}@keyframes enter{from{opacity:0}to{opacity:1}}@media (prefers-reduced-motion: reduce){*{animation:none}}');
    write('script.js', 'document.querySelector("button").addEventListener("click", () => {});');
    const result = await run('web_quality_check', { dirPath: '.' });
    expect(result.success).toBe(true);
    expect(result.data.valid).toBe(true);
    expect(result.data.score).toBeGreaterThanOrEqual(90);
    expect(result.data.files.javascript).toContain('script.js');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('builds bounded Tree-sitter outlines without executing source', async ({ skip }) => {
    // The bundled tree-sitter native binding is blocked by an Application
    // Control policy on this host (ERR_DLOPEN_FAILED on the .node file), the
    // exact case the lazy loader in offlineCodingPlugins.ts documents. On such
    // hosts the plugin cannot be verified positively, so this test steps aside
    // exactly like the loopback-gated debugger test below and records why.
    // The designed degradation is asserted in the next test instead.
    if (!await treeSitterBindingLoads()) return skip('tree-sitter native binding is blocked by this host Application Control policy; positive outline verification requires a host where tree_sitter_javascript_binding.node can load.');
    write('app.js', 'import x from "x";\nexport function greet(name) { return `Hi ${name}`; }\nclass Store {}');
    const result = await run('tree_sitter_outline', { filePath: 'app.js', maxNodes: 10 });
    expect(result.success).toBe(true);
    expect(result.data.language).toBe('javascript');
    expect(result.data.nodes.some((node: any) => node.type === 'function_declaration')).toBe(true);
    write('app.py', 'class Store:\n  pass\n\ndef greet(name):\n  return name\n');
    const python = await run('tree_sitter_outline', { filePath: 'app.py' });
    expect(python.success).toBe(true);
    expect(python.data.language).toBe('python');
    expect(python.data.nodes.some((node: any) => node.type === 'function_definition')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('degrades to an actionable AST fallback message when the native binding cannot load', async () => {
    // On hosts where the binding IS available there is nothing to degrade, so
    // this test is a no-op there. Where it is blocked (this host), the tool
    // must fail honestly with a pointer to plugin_symbols_outline and must not
    // invent nodes, crash the registry, or touch the network.
    if (await treeSitterBindingLoads()) return;
    write('app.js', 'export function greet(name) { return name; }');
    const result = await run('tree_sitter_outline', { filePath: 'app.js' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/plugin_symbols_outline/);
    expect(result.data).toBeUndefined();
    const retry = await run('tree_sitter_outline', { filePath: 'app.js' });
    expect(retry.success).toBe(false);
    expect(retry.error).toMatch(/plugin_symbols_outline/);
    expect(fetch).not.toHaveBeenCalled();
    // The pure-JS AST alternative still works without any native binding.
    const ast = await run('symbols_outline', { filePath: 'app.js' });
    expect(ast.success).toBe(true);
    expect(ast.data.items.some((item: any) => item.name === 'greet' && item.kind === 'FunctionDeclaration')).toBe(true);
  });

  it('reports Composio readiness without exposing credentials or calling the network', async () => {
    const result = await run('composio_health');
    expect(result.success).toBe(true);
    expect(result.data.networkCalled).toBe(false);
    expect(result.data.secretExposed).toBe(false);
    expect(result.output).not.toContain('COMPOSIO_API_KEY');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports the MCP bridge contract without connecting to a server', async () => {
    const result = await run('mcp_health');
    expect(result.success).toBe(true);
    expect(result.data.supportedTransports).toContain('local-stdio');
    expect(result.data.schemaValidation).toBe(true);
    expect(result.data.networkCalled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates SWE-bench manifests and detects SWE-agent setup without launching it', async () => {
    write('task.json', JSON.stringify({ instance_id: 'demo__repo-1', problem_statement: 'Fix bug', FAIL_TO_PASS: ['test_a'], PASS_TO_PASS: ['test_b'], patch: 'diff' }));
    const contract = await run('swebench_contract', { filePath: 'task.json' });
    expect(contract.success).toBe(true);
    expect(contract.data.valid).toBe(true);
    expect(contract.data.hasPatch).toBe(true);
    write('pyproject.toml', '[project]\ndependencies=["swe-agent"]\n');
    const detected = await run('sweagent_detect', { dirPath: '.' });
    expect(detected.success).toBe(true);
    expect(detected.data.detected).toBe(true);
    expect(detected.data.launched).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('selects web quality for website prompts but not unrelated CLI prompts', () => {
    expect(relevantCodingTools('Build an animated responsive e-commerce website')).toContain('plugin_web_quality_check');
    expect(relevantCodingTools('build a CLI')).not.toContain('plugin_web_quality_check');
  });

  it('persists disabled packs and rejects direct invocation of their tools', async () => {
    settings.update({ disabledCodingPlugins: ['quillix-formatter'] });
    expect(registry.getToolDefinitions().some(t => t.name === 'plugin_format_file')).toBe(false);
    expect((await run('format_file', { filePath: 'missing.js' })).error).toMatch(/disabled/);
    const reloaded = new SettingsStore(path.join(root, '.quillix/settings.json'));
    expect(new OfflineCodingPlugins(workspace, reloaded).catalog().find(p => p.id === 'quillix-formatter')?.enabled).toBe(false);
    expect(settings.update({ disabledCodingPlugins: [123] } as any).success).toBe(false);
  });

  it('rejects malformed arguments, traversal, protected files, binary and oversized files', async () => {
    expect((await run('todos_scan', { dirPath: '../' })).success).toBe(false);
    expect((await run('format_file', { filePath: '../../outside.js' })).success).toBe(false);
    write('.env', 'TEST_TOKEN=not-real'); expect((await run('config_validate', { filePath: '.env' })).success).toBe(false);
    write('binary.js', 'a\0b'); expect((await run('format_file', { filePath: 'binary.js' })).success).toBe(false);
    write('big.js', 'a'.repeat(512 * 1024 + 1)); expect((await run('format_file', { filePath: 'big.js' })).success).toBe(false);
    expect((await run('format_file', null)).success).toBe(false);
    expect((await run('format_file', {})).success).toBe(false);
    expect((await run('todos_scan', { dirPath: 12 })).success).toBe(false);
  });

  it('blocks symlink escapes for file reads and directory scans', async ({ skip }) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-plugin-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'private.js'), 'const privateData = 1;');
      try {
        fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error: any) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return skip('Symlink creation is restricted by this environment.');
        throw error;
      }
      expect((await run('symbols_outline', { filePath: 'escape/private.js' })).success).toBe(false);
      expect((await run('todos_scan', { dirPath: 'escape' })).success).toBe(false);
    } finally { fs.rmSync(path.join(root, 'escape'), { force: true, recursive: true }); fs.rmSync(outside, { recursive: true, force: true }); }
  });

  it('blocks debugger launches through file and cwd symlinks outside the workspace', async ({ skip }) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-debugger-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'private.js'), 'console.log("outside");');
      write('debug-target.js', 'console.log("inside");');
      const escape = path.join(root, 'debug-escape');
      try {
        fs.symlinkSync(outside, escape, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error: any) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return skip('Symlink creation is restricted by this environment.');
        throw error;
      }

      const fileEscape = await registry.executeTool('debug-symlink-file', 'plugin_debug_launch', { filePath: 'debug-escape/private.js' }, { preApproved: true });
      expect(fileEscape.success).toBe(false);
      expect(fileEscape.error).toMatch(/symlink|resolve inside the workspace/i);

      const cwdEscape = await registry.executeTool('debug-symlink-cwd', 'plugin_debug_launch', { filePath: 'debug-target.js', cwd: 'debug-escape' }, { preApproved: true });
      expect(cwdEscape.success).toBe(false);
      expect(cwdEscape.error).toMatch(/symlink|resolve inside the workspace/i);
    } finally {
      fs.rmSync(path.join(root, 'debug-escape'), { force: true, recursive: true });
      fs.rmSync(outside, { force: true, recursive: true });
    }
  });

  it('rejects debugger file and cwd paths whose resolved targets escape the workspace', async () => {
    write('debug-target.js', 'console.log("inside");');
    write('sub/debug-target.js', 'console.log("inside subdir");');
    const outside = path.join(os.tmpdir(), 'quillix-debugger-realpath-escape.js');
    const targetFile = path.join(root, 'debug-target.js');
    const targetCwd = path.join(root, 'sub');
    const realpath = fs.realpathSync.bind(fs);
    let escapedPath = targetFile;
    vi.spyOn(fs, 'realpathSync').mockImplementation(((target: any, ...args: any[]) =>
      path.resolve(String(target)) === escapedPath ? outside : realpath(target, ...args)) as any);
    const debuggerAdapter = new NodeDebugger(root);

    await expect(debuggerAdapter.launch('debug-target.js')).rejects.toThrow(/symlink escapes are blocked/i);
    escapedPath = targetCwd;
    await expect(debuggerAdapter.launch('sub/debug-target.js', [], 'sub')).rejects.toThrow(/symlink escapes are blocked/i);
  });

  it('routes file and directory tools into the active project prefix exactly once', async () => {
    write('sub/app.js', 'const n=1');
    const args = { filePath: 'app.js' };
    const result = await registry.executeTool('format', 'plugin_format_file', args, { projectPrefix: 'sub' });
    expect(result.success).toBe(true); expect(result.data.filePath).toBe('sub/app.js');
    const scanArgs = { dirPath: 'sub' };
    expect((await registry.executeTool('scan', 'plugin_todos_scan', scanArgs, { projectPrefix: 'sub' })).success).toBe(true);
    expect(scanArgs.dirPath).toBe('sub');
  });

  it('does not allow network extensions to execute in offline mode', async () => {
    const invoke = vi.fn(async () => 'unexpected');
    registry.extensions.register({ definition: { name: 'plugin_network_demo', category: 'project', permission: 'network', description: 'network', parameters: { type: 'object', properties: {} } }, invoke });
    const result = await registry.executeTool('network', 'plugin_network_demo', {}, { preApproved: true });
    expect(result.success).toBe(false); expect(invoke).not.toHaveBeenCalled();
  });

  it('runs a workspace-local Node debugger with pause, stack and evaluation', async ({ skip }) => {
    if (!await canConnectLoopback()) return skip('Loopback TCP connections are restricted by this environment.');
    write('debug-target.js', 'const answer = 41;\ndebugger;\nconsole.log(answer + 1);\n');
    const launch = await registry.executeTool('debug', 'plugin_debug_launch', { filePath: 'debug-target.js' }, { preApproved: true });
    expect(launch.success, launch.error || launch.output).toBe(true);
    const sessionId = launch.data.sessionId;
    expect(launch.data.status).toBe('paused');
    const resumed = await registry.executeTool('debug', 'plugin_debug_continue', { sessionId }, { preApproved: true });
    expect(['paused', 'running']).toContain(resumed.data.status);
    if (resumed.data.status === 'running') await registry.executeTool('debug', 'plugin_debug_pause', { sessionId }, { preApproved: true });
    const stack = await registry.executeTool('debug', 'plugin_debug_stack', { sessionId });
    expect(stack.success).toBe(true);
    expect(stack.data.frames.some((frame: any) => frame.filePath === 'debug-target.js'), JSON.stringify({ resumed: resumed.data, stack: stack.data })).toBe(true);
    const evaluated = await registry.executeTool('debug', 'plugin_debug_evaluate', { sessionId, expression: 'answer + 1' }, { preApproved: true });
    expect(evaluated.success).toBe(true);
    expect(evaluated.data.result.value).toBe(42);
    const stopped = await registry.executeTool('debug', 'plugin_debug_stop', { sessionId }, { preApproved: true });
    expect(stopped.success).toBe(true);
  }, 15000);

  it('supports workspace breakpoints and stepping in a Node debugger session', async ({ skip }) => {
    if (!await canConnectLoopback()) return skip('Loopback TCP connections are restricted by this environment.');
    write('step-target.js', 'function add() { return 1 + 1; }\nconst result = add();\ndebugger;\nconsole.log(result);\n');
    const launch = await registry.executeTool('debug-breakpoint', 'plugin_debug_launch', { filePath: 'step-target.js' }, { preApproved: true });
    expect(launch.success, launch.error || launch.output).toBe(true);
    const sessionId = launch.data.sessionId;
    const breakpoint = await registry.executeTool('debug-set-breakpoint', 'plugin_debug_set_breakpoint', { sessionId, filePath: 'step-target.js', line: 4 }, { preApproved: true });
    expect(breakpoint.success, breakpoint.error || breakpoint.output).toBe(true);
    expect(breakpoint.data.breakpointId).toBeTruthy();
    const listed = await registry.executeTool('debug-list-breakpoints', 'plugin_debug_breakpoints', { sessionId });
    expect(listed.data.breakpoints).toHaveLength(1);
    const stepped = await registry.executeTool('debug-step-over', 'plugin_debug_step_over', { sessionId }, { preApproved: true });
    expect(stepped.success).toBe(true);
    const cleared = await registry.executeTool('debug-clear-breakpoint', 'plugin_debug_clear_breakpoint', { sessionId, breakpointId: breakpoint.data.breakpointId }, { preApproved: true });
    expect(cleared.success).toBe(true);
    const stopped = await registry.executeTool('debug-breakpoint-stop', 'plugin_debug_stop', { sessionId }, { preApproved: true });
    expect(stopped.success).toBe(true);
  }, 15000);

  it('selects only relevant packs for the small local model', () => {
    expect([...relevantCodingTools('format app.ts with prettier')]).toEqual(['plugin_format_check', 'plugin_format_file']);
    expect(relevantCodingTools('build a CLI').size).toBe(0);
    expect(relevantCodingTools('debug this Node script and inspect the stack')).toContain('plugin_debug_launch');
    expect(relevantCodingTools('रिफैक्टर करो').has('plugin_symbols_outline')).toBe(true);
    expect(classifyIntent('Format app.js with Prettier').kind).toBe('agent');
    expect(classifyIntent('Scan TODOs in this project').kind).toBe('agent');
    expect(classifyIntent('app.ts फॉर्मेट कर दो').kind).toBe('agent');
    expect(classifyIntent('What is formatting?').kind).toBe('chat');
  });

  it('exposes formatter to small Qwen and tracks its real patch and verified file', async () => {
    write('app.js', 'const n=1');
    let turn = 0; const toolNames: string[] = [];
    const provider = { async chatWithToolsStream(_messages: any, tools: any[], _options: AICompletionOptions) {
      toolNames.push(...tools.map(t => t.name));
      return turn++ === 0 ? { text: '', toolCalls: [{ id: 'format', name: 'plugin_format_file', args: { filePath: 'app.js' } }] } : { text: 'Formatting done.' };
    } } as unknown as AIProvider;
    const terminal = new TerminalService(), git = new GitService(terminal), indexer = new CodebaseIndexer(workspace, git);
    const engine = new AgentEngine(provider, registry, indexer, new WorkspaceVerifier(workspace, terminal));
    const result = await engine.run({ userPrompt: 'Format app.js with Prettier', model: 'qwen2.5-coder:3b', mode: 'agent', conversationHistory: [] });
    expect(toolNames).toContain('plugin_format_file'); expect(toolNames).not.toContain('plugin_dependencies_inspect');
    expect(result.verifiedFiles).toContain('app.js'); expect(result.patches.some(p => p.filePath === 'app.js')).toBe(true);
    expect(fs.readFileSync(path.join(root, 'app.js'), 'utf8')).toBe('const n = 1;\n');
  });
});
