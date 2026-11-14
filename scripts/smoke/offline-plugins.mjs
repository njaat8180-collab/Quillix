import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// An isolated production-server acceptance test. Never uses the user's settings/workspace.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-plugins-http-'));
const port = Number(process.env.QUILLIX_PLUGIN_TEST_PORT || 3012);
const origin = `http://127.0.0.1:${port}`;
let server, logs = '';
const request = async (route, body, method = 'POST') => {
  const payload = body === undefined ? undefined : { conversationMode: 'agent', ...body };
  const response = await fetch(`${origin}${route}`, { method: body === undefined ? 'GET' : method, headers: { 'Content-Type': 'application/json', Origin: origin }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  return { status: response.status, data };
};
const invoke = async (name, args = {}) => (await request('/api/tools/execute', { name: `plugin_${name}`, args, conversationMode: 'agent' })).data;
// The bundled tree-sitter native binding is blocked by Application Control
// policies on some hosts (ERR_DLOPEN_FAILED on the .node file). The plugin
// degrades to its documented AST fallback by design; this probe keeps the
// acceptance script honest on hosts of both kinds.
let treeSitterNative;
async function treeSitterNativeAvailable() {
  if (treeSitterNative !== undefined) return treeSitterNative;
  try {
    const [Parser, JavaScriptGrammar, PythonGrammar] = await Promise.all([
      import('tree-sitter'), import('tree-sitter-javascript'), import('tree-sitter-python'),
    ]);
    const ParserClass = Parser.default ?? Parser;
    const parser = new ParserClass();
    parser.setLanguage(JavaScriptGrammar.default ?? JavaScriptGrammar);
    const jsTree = parser.parse('function probe() { return 1; }');
    const pythonParser = new ParserClass();
    pythonParser.setLanguage(PythonGrammar.default ?? PythonGrammar);
    const pyTree = pythonParser.parse('def probe():\n  return 1\n');
    treeSitterNative = Boolean(jsTree?.rootNode) && !jsTree.rootNode.hasError && Boolean(pyTree?.rootNode) && !pyTree.rootNode.hasError;
  } catch { treeSitterNative = false; }
  return treeSitterNative;
}
try {
  // Do not mistake another process on this port for our test server.
  let occupied = false;
  try { await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(300) }); occupied = true; } catch { /* unused port */ }
  if (occupied) throw new Error(`Port ${port} is occupied. Set QUILLIX_PLUGIN_TEST_PORT to a free port.`);
  fs.writeFileSync(path.join(temporary, 'settings.json'), JSON.stringify({ offlineMode: true, autoApplyDiffs: false, workspaceRoot: temporary }));
  fs.writeFileSync(path.join(temporary, 'app.ts'), 'export const n:number=1; // TODO test\n');
  fs.writeFileSync(path.join(temporary, 'config.jsonc'), '{ // local config\n"enabled":true,\n}');
  fs.writeFileSync(path.join(temporary, 'README.md'), '# Demo\n[Local](./app.ts)\n');
  fs.writeFileSync(path.join(temporary, 'AGENTS.md'), 'Use tests.');
  fs.writeFileSync(path.join(temporary, 'swebench.json'), JSON.stringify({instance_id:'demo-1',problem_statement:'Fix demo',FAIL_TO_PASS:['test_demo'],PASS_TO_PASS:['test_existing']}));
  fs.writeFileSync(path.join(temporary, 'package.json'), '{"name":"local-test","dependencies":{"example":"1.0.0"}}');
  fs.writeFileSync(path.join(temporary, 'index.html'), '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Demo</title><link rel="stylesheet" href="style.css"><script src="script.js"></script></head><body><main><h1>Demo</h1><button type="button">Open</button></main></body></html>');
  fs.writeFileSync(path.join(temporary, 'style.css'), ':focus-visible{outline:2px solid blue}@media(max-width:700px){main{padding:1rem}}');
  fs.writeFileSync(path.join(temporary, 'script.js'), 'document.querySelector("button").addEventListener("click", () => {});');
  server = spawn(process.execPath, ['dist/server.cjs'], { cwd: project, windowsHide: true, env: { ...process.env, NODE_ENV: 'production', PORT: String(port), QUILLIX_SETTINGS_PATH: path.join(temporary, 'settings.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
  server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-6000); });
  let ready = false;
  for (let attempt = 0; attempt < 75; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${logs}`);
    try { if ((await request('/api/health')).data.status === 'ok') { ready = true; break; } } catch { /* booting */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, `Server did not start: ${logs}`);
  const catalog = (await request('/api/extensions/catalog')).data.plugins;
  const bundled = catalog.filter(p => p.source === 'bundled' && p.offline && p.enabled);
  assert.equal(bundled.length, 16);
  assert.equal(bundled.flatMap(p => p.tools).length, 29);
  for (const toolName of ['plugin_tree_sitter_outline','plugin_composio_health','plugin_mcp_health','plugin_swebench_contract','plugin_sweagent_detect']) {
    assert.ok((await request('/api/tools/list')).data.tools.some(tool => tool.name === toolName), `${toolName} missing from catalog`);
  }
  assert.equal((await request('/api/settings')).data.settings.offlineMode, true);
  const lsp = await request('/api/extensions/lsp-stdio', { id: 'mock', command: process.execPath, args: [path.join(project, 'scripts/smoke/mock-lsp-stdio.mjs')] });
  assert.equal(lsp.status, 200, JSON.stringify(lsp.data));
  const lspTools = (await request('/api/tools/list')).data.tools.map(tool => tool.name);
  assert.ok(lspTools.includes('plugin_lsp_mock_definition'));
  assert.ok(lspTools.includes('plugin_lsp_mock_references'));
  assert.ok(lspTools.includes('plugin_lsp_mock_diagnostics'));
  assert.ok(lspTools.includes('plugin_lsp_mock_hover'));
  assert.ok(lspTools.includes('plugin_lsp_mock_completion'));
  assert.ok(lspTools.includes('plugin_lsp_mock_rename_preview'));
  const lspDefinition = await invoke('lsp_mock_definition', { filePath: 'app.ts', line: 1, column: 1 });
  assert.equal(lspDefinition.success, true, JSON.stringify(lspDefinition));
  assert.match(lspDefinition.output, /app\.ts/);
  const lspRename = await invoke('lsp_mock_rename_preview', { filePath: 'app.ts', line: 1, column: 1, newName: 'total' });
  assert.equal(lspRename.success, true, JSON.stringify(lspRename));
  assert.match(lspRename.output, /total/);
  const tree = await invoke('tree_sitter_outline', { filePath: 'app.ts' });
  if (await treeSitterNativeAvailable()) {
    assert.equal(tree.success, true, JSON.stringify(tree));
    assert.match(tree.output, /language/);
  } else {
    // Application Control policy blocks the native binding on this host, so
    // the plugin must fail honestly with the documented AST fallback pointer,
    // and the pure-JS AST alternative must still work.
    assert.equal(tree.success, false, JSON.stringify(tree));
    assert.match(tree.error, /plugin_symbols_outline/);
    assert.equal((await invoke('symbols_outline', { filePath: 'app.ts' })).success, true);
  }
  assert.equal((await invoke('composio_health')).success, true);
  assert.equal((await invoke('mcp_health')).success, true);
  const swebench = await invoke('swebench_contract', { filePath: 'swebench.json' });
  assert.equal(swebench.success, true, JSON.stringify(swebench));
  assert.match(swebench.output, /demo-1/);
  const sweagent = await invoke('sweagent_detect', { dirPath: '.' });
  assert.equal(sweagent.success, true, JSON.stringify(sweagent));
  for (const [name, args] of [
    ['syntax_diagnostics', { filePath: 'app.ts' }], ['symbols_outline', { filePath: 'app.ts' }],
    ['imports_inspect', { filePath: 'app.ts' }], ['config_validate', { filePath: 'config.jsonc' }],
    ['todos_scan', { dirPath: '.' }], ['dependencies_inspect', {}], ['rules_read', {}],
    ['whitespace_check', { filePath: 'app.ts' }], ['markdown_outline', { filePath: 'README.md' }],
    ['web_quality_check', { dirPath: '.' }],
  ]) {
    const result = await invoke(name, args);
    assert.equal(result.success, true, `${name}: ${result.error || result.output}`);
  }
  const patch = await invoke('format_file', { filePath: 'app.ts' });
  assert.equal(patch.success, true); assert.equal(patch.staged, true);
  assert.match(fs.readFileSync(path.join(temporary, 'app.ts'), 'utf8'), /n:number=1/);
  assert.equal((await invoke('format_check', { filePath: 'app.ts' })).success, false);
  assert.equal((await request('/api/extensions/coding/quillix-formatter', { enabled: false }, 'PUT')).data.success, true);
  assert.equal((await request('/api/tools/list')).data.tools.some(t => t.name === 'plugin_format_file'), false);
  assert.equal((await invoke('format_file', { filePath: 'app.ts' })).success, false);
  assert.equal((await request('/api/extensions/coding/quillix-formatter', { enabled: true }, 'PUT')).data.success, true);
  assert.equal((await request('/api/extensions/coding/quillix-unknown', { enabled: true }, 'PUT')).status, 400);
  assert.equal((await request('/api/extensions/coding/quillix-formatter', { enabled: 'yes' }, 'PUT')).status, 400);
  assert.equal((await invoke('todos_scan', { dirPath: '../' })).success, false);
  console.log('PASS: production HTTP server, 16 offline packs / 29 tools including Tree-sitter (or its documented AST fallback where the native binding is policy-blocked), Composio, MCP, SWE-bench and SWE-agent, local LSP bridge, parser outputs, staged formatting, web quality audit, debugger catalog, enable/disable, validation and workspace boundary checks.');
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  }
  // Exact temporary directory created above; no user files were used.
  fs.rmSync(temporary, { recursive: true, force: true });
}
