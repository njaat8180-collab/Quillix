import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestedEditTargets, targetInstruction, websiteRoleTargets, websiteRoleInstruction } from '../editTargets.js';
import { linkedBrowserSources } from '../browserChecks.js';
import { requestedLinkRepairs } from '../browserLinkRepair.js';
import { classifyRequestKind } from '../phases.js';
import { normalizeVerificationCommands } from '../../shared/verificationCommands.js';
import { AgentEngine } from '../agentEngine.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { SettingsStore } from '../settings.js';
import { ToolRegistry } from '../toolRegistry.js';
import { WorkspaceVerifier } from '../verifier.js';
import { TaskStateStore } from '../taskState.js';
import {ProjectMemory} from '../projectMemory.js';
import {HTML_STAGE_APPROVAL_MESSAGE} from '../projectContract.js';
import type { AIProvider, AICompletionOptions } from '../qwen.js';
import type { ToolDefinition } from '../../shared/types.js';

describe('explicit edit targets', () => {
  it('resolves the requested browser role without treating link references as edit instructions', () => {
    const links = linkedBrowserSources('<link rel="stylesheet" href="assets/theme.css?v=2"><script src="ui/app.js"></script><script src="../other/app.js"></script><script src="https://example.org/lib.js"></script>');
    expect(links).toEqual(['assets/theme.css', 'ui/app.js']);
    const files = ['index.html', ...links];
    expect(websiteRoleTargets('Fix the HTML links to the stylesheet and script. Make the stylesheet responsive. Make the browser JavaScript valid.', files)).toEqual(files);
    expect(websiteRoleTargets('Do not change the HTML. Improve the stylesheet.', files)).toEqual(['assets/theme.css']);
    expect(websiteRoleTargets('Update CSS.', [...files, 'secondary.css'])).toEqual([]);
    expect(websiteRoleInstruction('Fix the HTML links. Make the browser JavaScript use DOMContentLoaded.', 'ui/app.js')).toBe('Make the browser JavaScript use DOMContentLoaded.');
  });
  it('tracks separate edit clauses and conjunctions, not arbitrary filename mentions', () => {
    expect(requestedEditTargets('Fix rounding in src/money.cjs and refactor src/checkout.cjs to use the helper.')).toEqual(['src/money.cjs', 'src/checkout.cjs']);
    expect(requestedEditTargets('Refactor a.ts and b.ts using c.ts as a reference.')).toEqual(['a.ts', 'b.ts']);
    expect(requestedEditTargets('Wire the existing sign-in button to a click handler in a new app.js file and link the script from index.html.')).toEqual(['app.js', 'index.html']);
    expect(requestedEditTargets('Create app.js and link it from index.html.')).toEqual(['app.js', 'index.html']);
    expect(requestedEditTargets('मौजूदा sign-in button के लिए app.js में click handler बनाओ, उसे index.html में link करो और style.css बिल्कुल मत बदलो।')).toEqual(['app.js', 'index.html']);
    expect(requestedEditTargets('Explain a.ts and compare b.ts.')).toEqual([]);
    expect(classifyRequestKind('Fix a.ts')).toBe('fix');
    expect(classifyRequestKind('a.ts ठीक करो')).toBe('fix');
    expect(classifyRequestKind('Create a calculator using Python')).toBe('project');
    expect(classifyRequestKind('create a Node.js application')).toBe('project');
  });
  it('leaves existing, ambiguous, remote and forbidden browser links untouched', async () => {
    const prompt = 'Fix HTML links so index.html loads theme.css.';
    const repair = (html: string, instruction = prompt) => requestedLinkRepairs(html, 'Shop/index.html', instruction, p => p === 'Shop/theme.css' || p === 'Shop/working.css');
    const link = '<link rel="stylesheet" href="old.css">';
    expect(await repair(link)).toEqual([{oldString: link, newString: link.replace('old.css', 'theme.css')}]);
    expect(await repair(link + link)).toEqual([]);
    expect(await repair(link.replace('old.css', 'working.css'))).toEqual([]);
    expect(await repair(link.replace('old.css', 'https://example.com/app.css'))).toEqual([]);
    expect(await repair('<!--' + link + '-->')).toEqual([]);
    expect(await repair(link, 'Do not change the HTML. ' + prompt)).toEqual([]);
  });
  it('links a newly created local script when the user explicitly requests it', async () => {
    const html = '<html><body><button>Sign in</button></body></html>';
    const edits = await requestedLinkRepairs(html, 'index.html', 'Create app.js and link it from index.html.', file => file === 'app.js');
    expect(edits).toEqual([{ oldString: '</body>', newString: '<script src="app.js"></script>\n</body>' }]);
  });
  it('preserves forbidden files and normalizes Windows relative paths', () => {
    expect(requestedEditTargets('Do not modify suite.test.ts; fix src\\a.ts.')).toEqual(['src/a.ts']);
    expect(requestedEditTargets('Refactor app.ts and suite.test.ts.')).toEqual(['app.ts']);
    expect(requestedEditTargets('Update suite.test.ts.')).toEqual(['suite.test.ts']);
  });
  it('keeps a caller refactor distinct from the helper implementation instruction', () => {
    const prompt = 'Fix rounding in src/money.cjs and refactor src/checkout.cjs to call the shared toCents helper instead of duplicating conversion. Use Math.round(Number(amount) * 100).';
    expect(targetInstruction(prompt, 'src/checkout.cjs')).toContain('call the shared toCents helper');
    expect(targetInstruction(prompt, 'src/checkout.cjs')).not.toContain('Math.round');
    expect(targetInstruction(prompt, 'src/money.cjs')).not.toContain('refactor');
  });
});

describe('user verification command validation', () => {
  it('deduplicates explicit single-line commands and defaults to no checks', () => {
    expect(normalizeVerificationCommands(undefined)).toEqual([]);
    expect(normalizeVerificationCommands([' node --test ', 'node --test'])).toEqual(['node --test']);
  });
  it('rejects malformed, oversized or control-character input', () => {
    for (const value of ['npm test', [null], [''], ['a', 'b', 'c', 'd'], ['a\nb'], ['a\0b'], ['x'.repeat(2001)]]) {
      expect(() => normalizeVerificationCommands(value)).toThrow(/verificationCommands/);
    }
  });
});

describe('targeted coding and behavioral verification', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-coding-workflow-')); });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  function setup(provider: AIProvider, autoApplyDiffs = true, tasks?: TaskStateStore, memory?: ProjectMemory) {
    const workspace = new WorkspaceManager(root), terminal = new TerminalService(), git = new GitService(terminal);
    const indexer = new CodebaseIndexer(workspace, git), settings = new SettingsStore(path.join(root, '.quillix/settings.json'));
    settings.update({ autoApplyDiffs, terminalApproval: true });
    const tools = new ToolRegistry(workspace, terminal, git, indexer, settings);
    return { engine: new AgentEngine(provider, tools, indexer, new WorkspaceVerifier(workspace, terminal), memory, undefined, tasks), tools, terminal };
  }

  it('sends only file-edit tools for a concise multi-file follow-up in the open project', async () => {
    write('index.html', '<main><button>Sign In</button></main>');
    write('style.css', '.hero { color: navy; }');
    const memory = new ProjectMemory(root);
    memory.setActive('Northstar', root);
    let exposedTools: ToolDefinition[] = [];
    const provider = {
      async chatWithToolsStream(_messages: Array<{role: string; content: string}>, tools: ToolDefinition[]) {
        exposedTools = tools;
        return { text: 'I will apply the requested project edits.' };
      },
    } as unknown as AIProvider;
    const { engine } = setup(provider, true, undefined, memory);
    await engine.run({
      userPrompt: 'मौजूदा sign-in button के लिए app.js में click handler बनाओ, उसे index.html में link करो और style.css बिल्कुल मत बदलो।',
      mode: 'agent', currentFile: 'index.html', conversationHistory: [],
      settings: { maxAutonomousTurns: 1, temperature: 0, autoApplyDiffs: true },
    });
    const names = exposedTools.map(tool => tool.name);
    expect(names).toContain('read_file');
    expect(names).toContain('create_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('search_code');
    expect(names).not.toContain('run_command');
    expect(names).not.toContain('run_tests');
    expect(names).not.toContain('mcp_list_tools');
  });

  it('requests the next file chunk only after the previous disk write succeeds', async () => {
    const transferId = 'agent-chunk-transfer';
    let calls = 0;
    const provider = {
      async chatWithToolsStream(messages: Array<{role: string; content: string}>) {
        calls += 1;
        if (calls === 1) return { text: '', toolCalls: [
          { id: 'chunk-0', name: 'write_file_chunk', args: { filePath: 'app.cjs', content: 'exports.value = ', transferId, chunkIndex: 0, totalChunks: 2, final: false } },
          { id: 'chunk-1-too-early', name: 'write_file_chunk', args: { filePath: 'app.cjs', content: '42;', transferId, chunkIndex: 1, totalChunks: 2, final: true } },
        ] };
        if (calls === 2) {
          expect(messages.some(message => message.role === 'tool' && /Chunk 1\/2 written/.test(message.content))).toBe(true);
          return { text: '', toolCalls: [{ id: 'chunk-1', name: 'write_file_chunk', args: { filePath: 'app.cjs', content: '42;', transferId, chunkIndex: 1, totalChunks: 2, final: true } }] };
        }
        return { text: 'The file was written and verified.', toolCalls: [] };
      },
    } as unknown as AIProvider;
    const { engine } = setup(provider);
    const result = await engine.run({ userPrompt: 'Create a file named app.cjs with an exported value using ordered chunks.', mode: 'agent', conversationHistory: [] });
    expect(calls, JSON.stringify({ activities: result.activities.map(activity => activity.message), toolResults: result.toolResults.map(tool => ({ name: tool.toolName, success: tool.success, error: tool.error, output: tool.output })) })).toBeGreaterThanOrEqual(2);
    expect(result.verifiedFiles).toContain('app.cjs');
    expect(fs.readFileSync(path.join(root, 'app.cjs'), 'utf8')).toBe('exports.value = 42;');
    expect(result.finalText).not.toContain('exports.value = 42;');
  });

  it('switches repeated Universal full-file truncation to acknowledged checkpointed chunks', async () => {
    let calls = 0;
    let transferId = '';
    const chunks = [
      'module.exports = { ',
      'answer: ',
      '42',
      ' };\n',
    ];
    const provider = {
      async chatWithToolsStream(messages: Array<{role: string; content: string}>, tools: ToolDefinition[], options: AICompletionOptions) {
        calls += 1;
        if (calls <= 2) throw new Error('Universal API output truncated. No incomplete tool call executed.');
        if (calls === 3) {
          expect(options.requiredToolName).toBe('write_file_chunk');
          expect(options.format).toBeUndefined();
          expect(tools.map(tool => tool.name)).toEqual(['write_file_chunk']);
          expect(messages.at(-1)?.content).toMatch(/chunkIndex 0, totalChunks 4, final false/i);
          transferId = messages.at(-1)?.content.match(/transferId "([^"]+)"/)?.[1] || '';
          expect(transferId).toMatch(/^trunc-[\w.:-]+-answer\.cjs$/);
        } else if (calls >= 4 && calls <= 6) {
          expect(messages.some(message => message.role === 'tool' && new RegExp(`Chunk ${calls - 3}\\/4 written`).test(message.content))).toBe(true);
        }
        if (calls >= 3 && calls <= 6) {
          const chunkIndex = calls - 3;
          return {text: '', toolCalls: [{
            id: `chunk-${chunkIndex}`, name: 'write_file_chunk', args: {
              filePath: 'answer.cjs', content: chunks[chunkIndex], transferId,
              chunkIndex, totalChunks: 4, final: chunkIndex === 3,
            },
          }]};
        }
        return {text: 'The file was assembled, written, and verified.', toolCalls: []};
      },
    } as unknown as AIProvider;
    const {engine} = setup(provider);
    const result = await engine.run({
      userPrompt: 'Create a small Node.js project with a file named answer.cjs exporting answer as 42.',
      mode: 'agent', conversationHistory: [],
      settings: {maxAutonomousTurns: 10, temperature: 0, autoApplyDiffs: true},
    });
    expect(calls).toBe(6);
    const savedFile = fs.readdirSync(root, {recursive: true}).map(String).find(file => file.endsWith('answer.cjs'));
    expect(savedFile).toBeDefined();
    expect(fs.readFileSync(path.join(root, savedFile!), 'utf8')).toBe(chunks.join(''));
    expect(result.verifiedFiles.some(file => file.endsWith('answer.cjs'))).toBe(true);
    expect(result.finalText).not.toContain('Universal API output truncated');
  });

  it('finishes after a successful native test command without a duplicate run_tests model turn', async () => {
    write('package.json', JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
    write('src/price.cjs', 'exports.toCents = amount => Math.floor(Number(amount) * 100);\n');
    write('src/cart.cjs', "exports.totalCents = amounts => amounts.reduce((sum, amount) => sum + Math.floor(Number(amount) * 100), 0);\n");
    write('test/price.test.cjs', [
      "const test = require('node:test');",
      "const assert = require('node:assert/strict');",
      "const { toCents } = require('../src/price.cjs');",
      "const { totalCents } = require('../src/cart.cjs');",
      "test('rounds cents', () => { assert.equal(toCents(0.29), 29); assert.equal(toCents(2.345), 235); });",
      "test('totals cents', () => { assert.equal(totalCents([0.29, 0.57]), 86); });",
      '',
    ].join('\n'));
    let calls = 0;
    const provider = {
      async chatWithToolsStream() {
        calls += 1;
        if (calls === 1) return { text: '', toolCalls: [
          { id: 'price-edit', name: 'edit_file', args: {
            filePath: 'src/price.cjs', oldString: 'Math.floor', newString: 'Math.round',
          } },
          { id: 'cart-edit', name: 'edit_file', args: {
            filePath: 'src/cart.cjs',
            oldString: 'exports.totalCents = amounts => amounts.reduce((sum, amount) => sum + Math.floor(Number(amount) * 100), 0);',
            newString: "const { toCents } = require('./price.cjs');\nexports.totalCents = amounts => amounts.reduce((sum, amount) => sum + toCents(amount), 0);",
          } },
          { id: 'native-tests', name: 'run_command', args: { command: 'node --test' } },
        ] };
        return { text: '', toolCalls: [{ id: 'duplicate-tests', name: 'run_tests', args: {} }] };
      },
    } as unknown as AIProvider;
    const { engine } = setup(provider);
    const result = await engine.run({
      userPrompt: 'Fix rounding in src/price.cjs and refactor src/cart.cjs to call the shared helper. Run node --test.',
      mode: 'agent', conversationHistory: [], verificationCommands: ['node --test'],
      settings: { maxAutonomousTurns: 6, temperature: 0, autoApplyDiffs: true },
      requestApproval: async () => true,
    });
    expect(calls).toBe(1);
    expect(result.verified).toBe(true);
    expect(result.toolCalls.map(call => call.name)).toEqual(['edit_file', 'edit_file', 'run_command']);
    expect(result.verifiedFiles).toEqual(expect.arrayContaining(['src/price.cjs', 'src/cart.cjs']));
    expect(fs.readFileSync(path.join(root, 'src/cart.cjs'), 'utf8')).toContain('sum + toCents(amount)');
  });

  it('stops immediately after a chunk checkpoint failure without another model call', async () => {
    let calls = 0;
    const transferId = 'checkpoint-stop';
    const provider = { async chatWithToolsStream() {
      calls += 1;
      return { text: '', toolCalls: [{ id: 'chunk-fails', name: 'write_file_chunk', args: {
        filePath: 'new.cjs', content: 'exports.value = ', transferId, chunkIndex: 0, totalChunks: 2, final: false,
      } }] };
    } } as unknown as AIProvider;
    const { engine } = setup(provider);
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation(((oldPath: fs.PathLike, newPath: fs.PathLike) => {
      if (String(newPath).endsWith('chunk-transfers.json')) throw new Error('simulated checkpoint failure');
      return rename(oldPath, newPath);
    }) as typeof fs.renameSync);
    const result = await engine.run({
      userPrompt: 'Create a file using ordered chunks.', mode: 'agent', conversationHistory: [],
    });
    expect(calls).toBe(1);
    expect(result.checkpointFailure).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.finalText).toMatch(/recovery checkpoint failed/i);
    expect(fs.existsSync(path.join(root, 'new.cjs'))).toBe(false);
  });

  it.each(['.', 'Shop'])('edits all addressed browser files before acceptance in project %s', async folder => {
    const file = (name: string) => path.posix.join(folder, name);
    const html = '<!doctype html><html><head><link rel="stylesheet" href="old.css"></head><body><main>Explore our furniture collection</main><script src="old.js"></script></body></html>';
    const outputs: Record<string, string> = {
      // The model repaired one link. The requested, existing stylesheet is
      // unambiguous and the remaining reference must be fixed before the check.
      'index.html': html.replace('old.js', 'ui.js'),
      'theme.css': '.card { padding: 1rem; } @media(max-width:480px){ .card { padding: .5rem; } }',
      'ui.js': "document.addEventListener('DOMContentLoaded', () => { document.body.classList.add('ready'); });",
    };
    write(file('index.html'), html);
    write(file('theme.css'), '.card { color: red }');
    write(file('ui.js'), 'if (');
    const seen: string[] = [];
    const systemInstructions: string[] = [];
    const provider = { async chatWithToolsStream(messages: Array<{content: string}>, _tools: ToolDefinition[], options: AICompletionOptions) {
      systemInstructions.push(String(options.systemInstruction || ''));
      const target = messages.at(-1)?.content.match(/CURRENT SOURCE ([^:\n]+):/)?.[1];
      if (!target) return { text: 'Finished editing.' };
      seen.push(target);
      const content = outputs[path.posix.basename(target)];
      return { text: JSON.stringify({name: 'write_file', arguments: {filePath: target, content}}) };
    } } as unknown as AIProvider;
    const { engine } = setup(provider);
    write(file('check.cjs'), "const fs=require('node:fs'),assert=require('node:assert/strict'); assert.ok(fs.readFileSync('index.html','utf8').includes('href=\"theme.css\"')); assert.match(fs.readFileSync('theme.css','utf8'), /@media/); require('node:child_process').execFileSync(process.execPath, ['--check', 'ui.js']);");
    const result = await engine.run({
      userPrompt: `Repair this existing website. Fix the HTML links so ${file('index.html')} loads theme.css and ui.js. Make the stylesheet responsive. Make the browser JavaScript valid.`,
      mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [], verificationCommands: ['node check.cjs'],
      requestApproval: async () => true,
    });
    expect(seen, result.finalText).toEqual(Object.keys(outputs).map(file));
    expect(systemInstructions[1].length).toBeLessThan(1500);
    expect(systemInstructions[1]).toContain('opaque secret handles');
    expect(result.toolResults.filter(r => r.toolName === 'run_command').map(r => r.success)).toEqual([true]);
    expect(result.verifiedFiles.sort()).toEqual(Object.keys(outputs).map(file).sort());
    expect(result.phases.filter(p => p.status === 'failed'), result.finalText).toEqual([]);
  });

  it('prioritizes an explicit public acceptance command before package scripts', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      write('package.json', JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
      const provider = { async chatWithToolsStream() {
        return { text: '', toolCalls: [{ id: 'write', name: 'write_file', args: { filePath: 'app.cjs', content: 'exports.ready = true;\n' } }] };
      } } as unknown as AIProvider;
      const { engine } = setup(provider);
      const result = await engine.run({
        userPrompt: 'Repair app.cjs and run the native acceptance check.', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [],
        verificationCommands: ['node -e "process.exit(0)"'], requestApproval: async () => true,
      });
      const checks = result.toolResults.filter(tool => tool.toolName === 'run_command' || tool.toolName === 'run_tests').map(tool => tool.toolName);
      expect(checks.slice(0, 2)).toEqual(['run_command', 'run_command']);
      expect(result.finalText).toContain('User acceptance checks passed');
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('blocks public verification tools until a source edit exists', async () => {
    const previous = process.env.QUILLIX_PUBLIC_BENCHMARK;
    process.env.QUILLIX_PUBLIC_BENCHMARK = '1';
    try {
      let calls = 0;
      const provider = { async chatWithToolsStream() {
        if (calls++ === 0) return { text: '', toolCalls: [{ id: 'premature', name: 'run_command', args: { command: 'node -e "process.exit(0)"' } }] };
        return { text: '', toolCalls: [{ id: 'write', name: 'write_file', args: { filePath: 'app.cjs', content: 'exports.ready = true;\n' } }] };
      } } as unknown as AIProvider;
      const { engine } = setup(provider);
      const result = await engine.run({
        userPrompt: 'Repair app.cjs and run the native acceptance check.', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [],
        verificationCommands: ['node -e "process.exit(0)"'], requestApproval: async () => true,
      });
      const premature = result.toolResults.find(tool => tool.toolCallId === 'premature');
      expect(premature?.success).toBe(false);
      expect(premature?.error).toContain('first focused source edit');
      expect(result.toolResults.some(tool => tool.toolCallId === 'write' && tool.success)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.QUILLIX_PUBLIC_BENCHMARK;
      else process.env.QUILLIX_PUBLIC_BENCHMARK = previous;
    }
  });

  it('recovers a truncated HTML-only stage and resumes the assets after approval', async () => {
    const prompt = 'create a youtube clone using html css js only frantand first write html file and when i approve than work on other langvage';
    const outputs: Record<string,string> = {
      'index.html': '<!doctype html><html><head><title>Videos</title></head><body><main><h1>Video catalogue</h1><button id="menu">Menu</button></main></body></html>',
      'style.css': 'body {color:#222} button:focus-visible {outline:2px solid blue} @media(max-width:600px){main{padding:1rem}}',
      'script.js': "document.querySelector('#menu').addEventListener('click',()=>document.body.classList.toggle('menu-open'));",
    };
    let approved = false;
    let calls = 0;
    let compactRetry = false;
    const reply = async (messages: Array<{content:string}>, _tools: ToolDefinition[], options: AICompletionOptions) => {
      if (++calls === 1) throw new Error('Universal API output truncated. No incomplete tool call executed.');
      const text = messages.map(message=>message.content).join('\n');
      if (text.includes('previous response was truncated')) compactRetry = options.requiredToolName === 'write_file';
      const file = text.match(/(?:project file now with one write_file tool:|Target:)\s*([\w./-]+\.(?:html|css|js))\b/)?.[1] || 'index.html';
      const content = approved && file === 'index.html' ? outputs[file].replace('</head>','<link rel="stylesheet" href="style.css"></head>').replace('</body>','<script src="script.js"></script></body>') : outputs[file];
      return {text:'',toolCalls:[{id:String(calls),name:'write_file',args:{filePath:file,content}}]};
    };
    const provider = {chatWithToolsStream:reply,chatWithTools:reply,getSelectedModel:()=> 'remote/model'} as unknown as AIProvider;
    const {engine} = setup(provider);
    const first = await engine.run({userPrompt:prompt,mode:'agent',provider:'universal',model:'user/model',conversationHistory:[]});
    expect(compactRetry).toBe(true);
    expect(first.verified, first.finalText).toBe(true);
    expect(first.finalText).toContain(HTML_STAGE_APPROVAL_MESSAGE);
    expect(first.verifiedFiles).toEqual(['index.html']);
    expect(first.observability?.model).toBe('remote/model');
    expect(fs.existsSync(path.join(root,'style.css'))).toBe(false);
    approved = true;
    const second = await engine.run({userPrompt:'approved',mode:'agent',provider:'universal',model:'user/model',
      conversationHistory:[{id:'1',role:'user',content:prompt,timestamp:1},{id:'2',role:'assistant',content:first.finalText,timestamp:2}]});
    expect(second.verified, second.finalText).toBe(true);
    expect(second.verifiedFiles.sort()).toEqual(['index.html','script.js','style.css']);
    expect(fs.readFileSync(path.join(root,'index.html'),'utf8')).toContain('href="style.css"');
  });

  it('creates a new frontend project instead of reusing the remembered backend', async () => {
    write('ChatbotApi/package.json','{"name":"chatbot","scripts":{"dev":"node server.js"}}');
    write('ChatbotApi/server.js',"throw new Error('Parent server should not run')");
    const memory = new ProjectMemory(root);
    memory.setActive('ChatbotApi',path.join(root,'ChatbotApi'));
    const sources: Record<string,string> = {
      'index.html':'<!doctype html><html><head><title>Calculator</title><link rel="stylesheet" href="style.css"></head><body><main>Calculator workspace</main><script src="script.js"></script></body></html>',
      'style.css':'body {font-family:system-ui}',
      'script.js':"document.querySelector('main').setAttribute('aria-label','Calculator');",
    };
    const provider = {async chatWithToolsStream(messages: Array<{content:string}>) {
      const file = messages.at(-1)?.content.match(/project file now with one write_file tool:\s*([\w./-]+\.(?:html|css|js))\b/)?.[1];
      return file ? {text:'',toolCalls:[{id:file,name:'write_file',args:{filePath:file,content:sources[path.posix.basename(file)]}}]} : {text:'Done.'};
    }} as unknown as AIProvider;
    const {engine} = setup(provider,true,undefined,memory);
    const result = await engine.run({userPrompt:'create a callculater using html css js',mode:'agent',model:'qwen2.5-coder:3b',currentFile:'ChatbotApi/server.js',conversationHistory:[]});
    expect(result.verified, result.finalText).toBe(true);
    expect(result.verifiedFiles).toHaveLength(3);
    expect(result.verifiedFiles.every(file=>!file.startsWith('ChatbotApi/'))).toBe(true);
    expect(result.projectReport?.commandsExecuted?.some(command=>command.command.includes('npm run dev'))).not.toBe(true);
  });

  it('targets an open nested calculator page without editing or running its parent backend', async () => {
    const packageSource = '{"name":"chatbot","scripts":{"dev":"node server.js"}}';
    write('ChatbotApi/package.json',packageSource);
    write('ChatbotApi/server.js',"throw new Error('Parent backend must not run')");
    const html = '<!doctype html><html><head><title>Calculator</title><style>body{color:#222}</style></head><body><main>Calculator controls</main></body></html>';
    write('ChatbotApi/calculator/index.html',html);
    const memory = new ProjectMemory(root);
    memory.setActive('ChatbotApi',path.join(root,'ChatbotApi'));
    let calls=0;
    const provider = {async chatWithToolsStream() {
      if (++calls === 1) return {text:'',toolCalls:[{id:'wrong',name:'edit_file',args:{filePath:'ChatbotApi/package.json',oldString:'chatbot',newString:'changed'}}]};
      return {text:'',toolCalls:[{id:'correct',name:'write_file',args:{filePath:'index.html',content:html.replace('body{color:#222}','body{color:#222;animation:reveal 1s}@keyframes reveal{from{opacity:0}to{opacity:1}}')}}]};
    }} as unknown as AIProvider;
    const {engine}=setup(provider,true,undefined,memory);
    const result=await engine.run({userPrompt:'improve css and animations',mode:'agent',model:'qwen2.5-coder:3b',currentFile:'ChatbotApi/calculator/index.html',conversationHistory:[]});
    expect(result.verified,result.finalText).toBe(true);
    expect(fs.readFileSync(path.join(root,'ChatbotApi/package.json'),'utf8')).toBe(packageSource);
    expect(result.verifiedFiles).toEqual(['ChatbotApi/calculator/index.html']);
    expect(result.projectReport?.commandsExecuted?.some(command=>command.command.includes('npm run dev'))).not.toBe(true);
  });

  it('guides a small model through both explicit files, then runs real backend tests', async () => {
    write('src/money.cjs', 'exports.toCents = n => Math.floor(Number(n) * 100);');
    write('src/checkout.cjs', 'const {toCents} = require("./money.cjs"); exports.total = values => values.reduce((s,n) => s + Math.floor(Number(n) * 100), 0);');
    write('suite.cjs', 'const a = require("node:assert/strict"); a.equal(require("./src/checkout.cjs").total([0.29,0.57]),86);');
    const seen: string[] = [];
    const provider = { async chatWithToolsStream(messages: Array<{ content: string }>, tools: ToolDefinition[], options: AICompletionOptions) {
      const schema = options.format as any;
      if (!schema) return { text: 'Edits complete.' };
      const file = schema.properties.arguments.properties.filePath.enum[0];
      expect(schema.properties.name.enum).toEqual(['edit_file']);
      expect(tools.some(tool => tool.name === 'edit_file')).toBe(true);
      expect(messages.at(-1)?.content).toContain(`CURRENT SOURCE ${file}`);
      seen.push(file);
      return { text: JSON.stringify({ name: 'edit_file', arguments: { filePath: file,
        oldString: 'Math.floor(Number(n) * 100)', newString: file.endsWith('money.cjs') ? 'Math.round(Number(n) * 100)' : 'toCents(n)' } }) };
    } } as unknown as AIProvider;
    const { engine } = setup(provider);
    const result = await engine.run({ userPrompt: 'Fix src/money.cjs and refactor src/checkout.cjs to use the shared helper, then run tests.', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [], verificationCommands: ['node suite.cjs'] });
    expect(seen).toEqual(['src/money.cjs', 'src/checkout.cjs']);
    expect(result.verifiedFiles.sort()).toEqual(['src/checkout.cjs', 'src/money.cjs']);
    expect(result.toolResults.some(tool => tool.toolName === 'run_command' && tool.success)).toBe(true);
    expect(result.phases.some(phase => phase.status === 'failed')).toBe(false);
  });

  it('finalizes an aborted repair with the edits and rollback still available', async () => {
    const controller = new AbortController();
    const tasks = new TaskStateStore(root);
    write('value.cjs', 'module.exports = 0;');
    write('check.cjs', "require('node:assert/strict').equal(require('./value.cjs'), 2);");
    let calls = 0;
    const provider = { async chatWithToolsStream() {
      if (++calls === 1) return { text: '', toolCalls: [{ id: 'edit', name: 'edit_file', args: {filePath: 'value.cjs', oldString: '= 0', newString: '= 1'} }] };
      controller.abort(new Error('deadline exceeded'));
      throw new Error('Generation cancelled');
    } } as unknown as AIProvider;
    const { engine } = setup(provider, true, tasks);
    const result = await engine.run({ userPrompt: 'Fix value.cjs to export 2.', mode: 'agent', model: 'qwen2.5-coder:3b',
      conversationHistory: [], verificationCommands: ['node check.cjs'], signal: controller.signal, requestApproval: async () => true });
    expect(calls).toBe(2);
    expect(result.cancelled).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.resumable).toBe(true);
    expect(result.verifiedFiles).toEqual(['value.cjs']);
    expect(tasks.getTask(result.taskId!)?.status).toBe('cancelled');
    expect(result.rollback?.available).toBe(true);
  });

  it('reports a provider timeout as a failure when the caller did not cancel', async () => {
    const tasks = new TaskStateStore(root);
    const provider = { async chatWithToolsStream() {
      throw new Error('Universal API request cancelled or timed out.');
    } } as unknown as AIProvider;
    const { engine } = setup(provider, true, tasks);

    await expect(engine.run({ userPrompt: 'Fix the reported issue.', mode: 'agent', model: 'remote/model', conversationHistory: [] }))
      .rejects.toThrow('Universal API request cancelled or timed out.');
    expect(tasks.listTasks()).toHaveLength(1);
    expect(tasks.listTasks()[0].status).toBe('failed');
    expect(tasks.listTasks()[0].finalText).toMatch(/provider failed/i);
  });

  it('does not auto-write a module repair after the agent run is cancelled', async () => {
    const controller = new AbortController();
    const source = 'module.exports = require("./helper");\n';
    write('app.cjs', source);
    write('helper.cjs', 'module.exports = 1;\n');
    const provider = { async chatWithToolsStream() {
      return { text: '', toolCalls: [{ id: 'test', name: 'run_tests', args: { command: 'node --test' } }] };
    } } as unknown as AIProvider;
    const { engine, tools } = setup(provider);
    const execute = tools.executeTool.bind(tools);
    const executeSpy = vi.spyOn(tools, 'executeTool').mockImplementation(async (...args) => {
      const [id, name] = args;
      if (name === 'run_tests') {
        controller.abort(new Error('Chat mode selected'));
        return { toolCallId: id, toolName: name, success: false, output: '', error: "Cannot find module './helper'" };
      }
      return execute(...args);
    });

    const result = await engine.run({
      userPrompt: 'Run tests and repair the import in the selected app.cjs.',
      mode: 'agent', currentFile: 'app.cjs', conversationHistory: [], signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
    expect(executeSpy.mock.calls.some(([, name]) => name === 'write_file')).toBe(false);
    expect(fs.readFileSync(path.join(root, 'app.cjs'), 'utf8')).toBe(source);
  });

  it('reports only the edited stylesheet in a nested site and keeps the linked path intact', async () => {
    const html = '<link rel="stylesheet" href="assets/style.css"><main>Shop online today</main>';
    write('Shop/index.html', html);
    write('Shop/assets/style.css', '.card { color: red; }');
    write('Shop/script.js', "console.log('shop');");
    const calls: string[] = [];
    const provider = { async chatWithToolsStream(messages: Array<{content: string}>) {
      const target = messages.at(-1)?.content.match(/CURRENT SOURCE ([^:\n]+):/)?.[1];
      if (!target) return { text: 'Done.' };
      calls.push(target);
      return {text: '', toolCalls: [{ id: 'color', name: 'edit_file', args: {filePath: target, oldString: 'red', newString: 'blue'} }]};
    } } as unknown as AIProvider;
    const {engine} = setup(provider);
    const result = await engine.run({
      userPrompt: 'Improve the stylesheet. Repair the card color in the existing Shop project. Do not edit the HTML.',
      mode: 'agent', model: 'qwen2.5-coder:3b', currentFile: 'Shop/index.html', conversationHistory: [],
    });
    expect(calls).toEqual(['Shop/assets/style.css']);
    expect(result.verifiedFiles).toEqual(calls);
    expect(fs.readFileSync(path.join(root, 'Shop/index.html'), 'utf8')).toBe(html);
    expect(fs.existsSync(path.join(root, 'Shop/style.css'))).toBe(false);
  });

  it('applies a focused repair to its existing file when the model invents a wrapper directory', async () => {
    write('app.cjs', 'module.exports = 0;');
    write('check.cjs', "const a = require('node:assert/strict'); if(require('./app.cjs') !== 2) throw new Error('app.cjs must export 2');");
    let calls = 0;
    const provider = { async chatWithToolsStream() {
      return {text: '', toolCalls: [{id: String(++calls), name: 'write_file', args: {
        filePath: calls === 1 ? 'app.cjs' : 'unnecessary/app.cjs', content: `module.exports = ${calls === 1 ? 1 : 2};`,
      }}]};
    } } as unknown as AIProvider;
    const {engine} = setup(provider);
    const result = await engine.run({userPrompt: 'Fix app.cjs to export 2.', mode: 'agent', model: 'qwen2.5-coder:3b',
      conversationHistory: [], verificationCommands: ['node check.cjs'], requestApproval: async () => true});
    expect(fs.readFileSync(path.join(root, 'app.cjs'), 'utf8')).toContain('= 2');
    expect(fs.existsSync(path.join(root, 'unnecessary'))).toBe(false);
    expect(result.verified).toBe(true);
    expect(result.verifiedFiles).toEqual(['app.cjs']);
  });

  it('turns a typoed AI-harness request that starts as prose into real file writes', async () => {
    let calls = 0;
    const files: Record<string, string> = {
      'index.html': '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Harness</title></head><body><main><textarea id="prompt"></textarea><button id="send">Send</button><output id="response" aria-live="polite"></output></main><script src="script.js"></script></body></html>',
      'style.css': 'body{font-family:system-ui;background:#07111f;color:#eaf6ff}main{max-width:720px;margin:10vh auto;padding:2rem}button{padding:.7rem}',
      'script.js': "document.querySelector('#send').addEventListener('click',()=>{document.querySelector('#response').textContent='Ready';});",
    };
    const provider = {
      async chatWithToolsStream() {
        calls++;
        if (calls === 1) return { text: 'Here is a complete implementation in three files. Copy these snippets into your project.' };
        const filePath = Object.keys(files)[calls - 2];
        return { text: '', toolCalls: [{ id: `write-${calls}`, name: 'write_file', args: { filePath, content: files[filePath] } }] };
      },
    } as unknown as AIProvider;
    const { engine } = setup(provider);
    const result = await engine.run({ userPrompt: 'creeate a ai harnase using html css js', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [], requestApproval: async () => true });
    expect(result.toolResults.filter(tool => tool.toolName === 'write_file' && tool.success).length).toBe(3);
    const projectFolder = fs.readdirSync(root).find(name => fs.existsSync(path.join(root, name, 'index.html')));
    expect(projectFolder).toBeDefined();
    expect(fs.existsSync(path.join(root, projectFolder!, 'style.css'))).toBe(true);
    expect(fs.existsSync(path.join(root, projectFolder!, 'script.js'))).toBe(true);
    expect(result.finalText).not.toContain('no files were written to disk');
  });

  it('feeds a real failed behavioral assertion back into a targeted repair', async () => {
    write('suite.cjs', 'const a = require("node:assert/strict"); a.equal(require("./greet.cjs").greet(),"Hello, World!");');
    let count = 0;
    const provider = { async chatWithToolsStream(messages: Array<{ content: string }>, _tools: ToolDefinition[], options: AICompletionOptions) {
      if (count++ === 0) return { text: '', toolCalls: [{ id: 'new', name: 'write_file', args: { filePath: 'greet.cjs', content: 'exports.greet = name => `Hello, ${name.trim() || "World"}!`;' } }] };
      expect((options.format as any).properties.name.enum).toEqual(['edit_file']);
      expect(messages.at(-1)?.content).toContain('FAILED CHECK acceptance:node suite.cjs');
      expect(messages.at(-1)?.content).toContain('TypeError');
      return { text: '', toolCalls: [{ id: 'repair', name: 'edit_file', args: { filePath: 'greet.cjs', oldString: 'name =>', newString: '(name = "") =>' } }] };
    } } as unknown as AIProvider;
    const { engine } = setup(provider);
    const result = await engine.run({ userPrompt: 'Create greet.cjs. Export a greeting function via exports.greet, including a missing-name default.', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [], verificationCommands: ['node suite.cjs'] });
    expect(result.toolResults.filter(tool => tool.toolName === 'run_command').map(tool => tool.success), result.finalText).toEqual([false, true]);
    expect(result.phases.some(phase => phase.status === 'failed')).toBe(false);
    expect(result.finalText).toContain('User acceptance checks passed');
  });

  it('reports preserved files when project acceptance fails instead of claiming no files were written', async () => {
    const provider = {
      async chatWithToolsStream() {
        return {
          text: '',
          toolCalls: [{ id: 'new', name: 'write_file', args: { filePath: 'app.cjs', content: 'exports.ready = true;' } }],
        };
      },
    } as unknown as AIProvider;
    const { engine } = setup(provider);
    const result = await engine.run({
      userPrompt: 'Create app.cjs exporting a ready flag, then verify it.',
      mode: 'agent',
      model: 'qwen2.5-coder:3b',
      conversationHistory: [],
      verificationCommands: ['node -e "process.exit(1)"'],
      requestApproval: async () => true,
    });
    expect(result.verifiedFiles).toEqual(['app.cjs']);
    expect(result.finalText).toContain('app.cjs');
    expect(result.finalText).toContain('written');
    expect(result.finalText).not.toContain('no files were written to disk');
    expect(result.activities.some((activity) => activity.message.includes('files were created but required project verification did not pass'))).toBe(true);
  });

  it('recovers a stale malformed edit failure when a later write passes acceptance', async () => {
    let turns = 0;
    const provider = {
      async chatWithToolsStream() {
        turns++;
        if (turns === 1) return { text: '', toolCalls: [{ id: 'bad-edit', name: 'edit_file', args: { filePath: 'retry.cjs', oldString: 'missing source', newString: 'fixed source' } }] };
        return { text: '', toolCalls: [{ id: 'good-write', name: 'write_file', args: { filePath: 'retry.cjs', content: 'exports.retry = async () => 42;' } }] };
      },
    } as unknown as AIProvider;
    const { engine } = setup(provider);
    const command = 'node -e "if (require(\'./retry.cjs\').retry.constructor.name !== \'AsyncFunction\') process.exit(1)"';
    const result = await engine.run({
      userPrompt: 'Create retry.cjs with an async retry export.',
      mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [], verificationCommands: [command],
      requestApproval: async () => true,
    });
    expect(result.finalText).toContain('User acceptance checks passed');
    expect(result.phases.some(phase => phase.status === 'failed')).toBe(false);
    expect(result.toolResults.some(tool => tool.toolName === 'edit_file' && !tool.success)).toBe(true);
    expect(result.toolResults.some(tool => tool.toolName === 'write_file' && tool.success)).toBe(true);
  });

  it('falls back to a complete file write after an ambiguous focused edit', async () => {
    const initial = 'exports.greet = name => { const trimmed = name.trim(); return name.trim() ? trimmed : "Hello, World!"; };';
    const corrected = 'exports.greet = (name = "") => { const trimmed = name.trim(); return trimmed ? `Hello, ${trimmed}!` : "Hello, World!"; };';
    const provider = {
      async chatWithToolsStream() {
        return { text: '', toolCalls: [{ id: 'new', name: 'write_file', args: { filePath: 'greet.cjs', content: initial } }] };
      },
      async chatWithTools(_messages: unknown[], _tools: ToolDefinition[], options: AICompletionOptions) {
        if (options.requiredToolName === 'edit_file') {
          return { text: '', toolCalls: [{ id: 'ambiguous', name: 'edit_file', args: { filePath: 'greet.cjs', oldString: 'name.trim()', newString: '`Hello, ${name.trim()}!`' } }] };
        }
        expect(options.requiredToolName).toBe('write_file');
        return { text: '', toolCalls: [{ id: 'rewrite', name: 'write_file', args: { filePath: 'greet.cjs', content: corrected } }] };
      },
    } as unknown as AIProvider;
    const { engine } = setup(provider);
    const command = 'node -e "const {greet}=require(\'./greet.cjs\'); if (greet(\'Ada\') !== \'Hello, Ada!\') process.exit(1)"';
    const result = await engine.run({
      userPrompt: 'Create greet.cjs exporting a named greet function with a default greeting.',
      mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [], verificationCommands: [command],
      requestApproval: async () => true,
    });
    expect(result.finalText).toContain('User acceptance checks passed');
    expect(result.toolResults.some(tool => tool.toolName === 'edit_file' && !tool.success)).toBe(true);
    expect(result.toolResults.some(tool => tool.toolName === 'write_file' && tool.success && String(tool.data?.newContent || '').includes('Hello, ${trimmed}!'))).toBe(true);
  });

  it('escalates repeated behavioral failures from surgical edits to a complete rewrite', async () => {
    write('retry.cjs', 'exports.retry = async (operation, attempts = 3) => { for (let i = 0; i < attempts; i++) { try { return operation(); } catch (error) { if (i === attempts - 1) throw error; } } };');
    const corrected = 'exports.retry = async (operation, attempts = 3) => { let lastError; for (let i = 0; i < attempts; i++) { try { return await operation(); } catch (error) { lastError = error; } } throw lastError; };';
    let focusedRepairs = 0;
    const provider = {
      async chatWithToolsStream() {
        return { text: '', toolCalls: [{ id: 'initial', name: 'edit_file', args: { filePath: 'retry.cjs', oldString: 'return operation();', newString: 'await operation();' } }] };
      },
      async chatWithTools(_messages: unknown[], _tools: ToolDefinition[], options: AICompletionOptions) {
        if (options.requiredToolName === 'edit_file') {
          focusedRepairs++;
          return { text: '', toolCalls: [{ id: `focused-${focusedRepairs}`, name: 'edit_file', args: { filePath: 'retry.cjs', oldString: focusedRepairs === 1 ? 'await operation();' : 'operation();', newString: 'operation();' } }] };
        }
        expect(options.requiredToolName).toBe('write_file');
        return { text: '', toolCalls: [{ id: 'rewrite', name: 'write_file', args: { filePath: 'retry.cjs', content: corrected } }] };
      },
    } as unknown as AIProvider;
    const { engine } = setup(provider);
    const command = 'node -e "const {retry}=require(\'./retry.cjs\'); retry(async()=>42).then(value=>{if(value!==42) process.exit(1)}).catch(()=>process.exit(1))"';
    const result = await engine.run({
      userPrompt: 'Fix retry.cjs so retry awaits async operations and preserves the retry count.',
      mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [], verificationCommands: [command],
      requestApproval: async () => true,
    });
    expect(focusedRepairs).toBe(1);
    expect(result.finalText).toContain('User acceptance checks passed');
    expect(result.toolResults.some(tool => tool.toolName === 'write_file' && tool.success && String(tool.data?.newContent || '').includes('return await operation()'))).toBe(true);
  });

  it('never runs checks when a patch awaits review', async () => {
    const provider = { async chatWithToolsStream() { return { text: '', toolCalls: [{ id: 'new', name: 'write_file', args: { filePath: 'greet.cjs', content: 'exports.greet = () => "Hello";' } }] }; } } as unknown as AIProvider;
    const { engine } = setup(provider, false);
    const result = await engine.run({ userPrompt: 'Create greet.cjs with a greeting function.', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [], verificationCommands: ['node --test'] });
    expect(result.toolResults.some(tool => tool.toolName === 'run_command')).toBe(false);
    expect(result.finalText).toContain('PENDING REVIEW');
  });

  it('preserves normal approval for user-supplied verification commands', async () => {
    const provider = { async chatWithToolsStream() { return { text: '', toolCalls: [{ id: 'new', name: 'write_file', args: { filePath: 'greet.cjs', content: 'exports.greet = () => "Hello";' } }] }; } } as unknown as AIProvider;
    const { engine, terminal } = setup(provider);
    const execute = vi.spyOn(terminal, 'executeCommand');
    const command = 'node -e "process.exit(0)"', approve = vi.fn(async () => false);
    const result = await engine.run({ userPrompt: 'Create greet.cjs with a greeting function.', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [], verificationCommands: [command], requestApproval: approve });
    expect(approve).toHaveBeenCalledOnce();
    expect(execute.mock.calls.some(call => call[0] === command)).toBe(false);
    expect(result.finalText).toContain('BLOCKED');
  });

  it('reuses a passing package test when the same test script is also requested explicitly', async () => {
    const testCommand = 'node -e "process.exit(0)"';
    write('package.json', JSON.stringify({ name: 'dedup-tests', scripts: { test: testCommand } }));
    const provider = { async chatWithToolsStream() { return { text: '', toolCalls: [
      { id: 'edit', name: 'write_file', args: { filePath: 'src/value.cjs', content: 'module.exports = 42;\n' } },
      { id: 'tests', name: 'run_tests', args: {} },
      { id: 'same-tests', name: 'run_command', args: { command: testCommand } },
    ] }; } } as unknown as AIProvider;
    const { engine, terminal } = setup(provider);
    const execute = vi.spyOn(terminal, 'executeCommand');
    const result = await engine.run({
      userPrompt: 'Fix src/value.cjs and run tests.', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [],
      verificationCommands: [testCommand], requestApproval: async () => true,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.toolResults.filter(tool => tool.toolName === 'run_tests' && tool.success)).toHaveLength(1);
    expect(result.toolResults.some(tool => tool.toolName === 'run_command' && tool.data?.reusedVerification === true)).toBe(true);
    expect(result.finalText).toContain('User acceptance checks passed');
  });

  it('does not execute verification commands in read-only modes', async () => {
    const provider = { async generateStream() { return 'Read-only findings'; } } as unknown as AIProvider;
    const { engine, tools } = setup(provider);
    const execute = vi.spyOn(tools, 'executeTool');
    const result = await engine.run({ userPrompt: 'Explain this workspace', mode: 'ask', conversationHistory: [], verificationCommands: ['node --test'] });
    expect(execute).not.toHaveBeenCalled();
    expect(result.finalText).toBe('Read-only findings');
  });

  it('uses the saved active file for an otherwise implicit fix request', async () => {
    write('active.cjs', 'exports.value = 1;');
    let turns = 0;
    const provider = { async chatWithToolsStream(_messages: unknown, _tools: unknown, options: AICompletionOptions) {
      if (turns++) return { text: 'Done.' };
      expect((options.format as any).properties.arguments.properties.filePath.enum).toEqual(['active.cjs']);
      return { text: '', toolCalls: [{ id: 'active', name: 'edit_file', args: { filePath: 'active.cjs', oldString: '= 1', newString: '= 2' } }] };
    } } as unknown as AIProvider;
    const { engine } = setup(provider);
    const result = await engine.run({ userPrompt: 'Fix this function so its value is 2.', currentFile: 'active.cjs', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [] });
    expect(result.verifiedFiles).toEqual(['active.cjs']);
    expect(result.phases.some(phase => phase.status === 'failed')).toBe(false);
  });

  it('does not confuse a named new-file request with the unrelated open editor file', async () => {
    write('active.cjs', 'exports.value = 1;');
    const provider = { async chatWithToolsStream(_messages: unknown, _tools: unknown, options: AICompletionOptions) {
      expect((options.format as any).properties.name.enum).toEqual(['write_file']);
      expect((options.format as any).properties.arguments.properties.filePath.enum).toEqual(['fresh.cjs']);
      return { text: '', toolCalls: [{ id: 'fresh', name: 'write_file', args: { filePath: 'fresh.cjs', content: 'exports.fresh = true;' } }] };
    } } as unknown as AIProvider;
    const { engine } = setup(provider);
    const result = await engine.run({ userPrompt: 'Create fresh.cjs exporting a fresh flag.', currentFile: 'active.cjs', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [] });
    expect(result.verifiedFiles).toEqual(['fresh.cjs']);
    expect(fs.readFileSync(path.join(root, 'active.cjs'), 'utf8')).toBe('exports.value = 1;');
  });

  it('keeps navigation tools available rather than forcing edits to a truncated large file', async () => {
    write('long.cjs', '// padding\n'.repeat(1000) + 'exports.deepValue = 1;');
    let turns = 0;
    const provider = { async chatWithToolsStream(messages: Array<{ content: string }>, tools: ToolDefinition[], options: AICompletionOptions) {
      expect(options.format).toBeUndefined();
      expect(tools.some(tool => tool.name === 'search_code')).toBe(true);
      if (turns++ === 0) return { text: '', toolCalls: [{ id: 'search', name: 'search_code', args: { query: 'deepValue' } }] };
      if (turns === 2) {
        expect(messages.map(message => message.content).join('\n')).toContain('exports.deepValue = 1');
        return { text: '', toolCalls: [{ id: 'deep', name: 'edit_file', args: { filePath: 'long.cjs', oldString: 'exports.deepValue = 1;', newString: 'exports.deepValue = 2;' } }] };
      }
      return { text: 'Done.' };
    } } as unknown as AIProvider;
    const { engine } = setup(provider);
    const result = await engine.run({ userPrompt: 'Refactor long.cjs: change deepValue to 2.', mode: 'agent', model: 'qwen2.5-coder:3b', conversationHistory: [] });
    expect(result.verifiedFiles).toEqual(['long.cjs']);
    expect(fs.readFileSync(path.join(root, 'long.cjs'), 'utf8')).toContain('exports.deepValue = 2;');
  });
});
