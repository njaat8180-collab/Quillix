import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentEngine } from '../agentEngine.js';
import { CodebaseIndexer } from '../indexer.js';
import { ToolRegistry } from '../toolRegistry.js';
import { WorkspaceManager } from '../workspace.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { SettingsStore } from '../settings.js';
import { WorkspaceVerifier } from '../verifier.js';
import { ProjectMemory } from '../projectMemory.js';
import type { AIProvider } from '../qwen.js';
import { classifyIntent } from '../intentRouter.js';

describe('existing project coding beyond websites', () => {
  it('refactors a backend across files, retrieves source and runs its configured tests', async () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-backend-'));
    try {
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test backend.test.cjs' } }));
      fs.writeFileSync(path.join(root, 'util.cjs'), 'exports.increment = n => n + 1;');
      fs.writeFileSync(path.join(root, 'app.cjs'), 'exports.run = require("./util.cjs").increment;');
      fs.writeFileSync(path.join(root, 'backend.test.cjs'), 'const assert = require("node:assert/strict"); require("node:test")("double", () => assert.equal(require("./app.cjs").run(3), 6));');
      const ws = new WorkspaceManager(root);
      const terminal = new TerminalService();
      const git = new GitService(terminal);
      const indexer = new CodebaseIndexer(ws, git);
      expect(indexer.getTaskContext('Refactor util.cjs and app.cjs')).toContain('exports.increment');
      const settings = new SettingsStore(path.join(root, '.quillix', 'settings.json'));
      const settingsUpdate = settings.update({ autoApplyDiffs: true });
      expect(settingsUpdate.success, settingsUpdate.error).toBe(true);
      let turn = 0;
      const ai = {
        async chatWithToolsStream() {
          if (turn++ > 0) return { text: 'Backend refactor complete.' };
          return { text: '', toolCalls: [
            { id: 'util', name: 'write_file', args: { filePath: 'util.cjs', content: 'exports.double = n => n * 2;' } },
            { id: 'app', name: 'write_file', args: { filePath: 'app.cjs', content: 'exports.run = require("./util.cjs").double;' } },
          ] };
        },
      } as unknown as AIProvider;
      const engine = new AgentEngine(ai, new ToolRegistry(ws, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(ws, terminal));
      const result = await engine.run({ userPrompt: 'Refactor util.cjs and app.cjs to double inputs and run tests', mode: 'agent', conversationHistory: [] });
      expect(result.verifiedFiles.sort()).toEqual(['app.cjs', 'util.cjs']);
      const test = result.toolResults.find(tool => tool.toolName === 'run_tests');
      expect(test?.success).toBe(true);
      expect(test?.output).toContain('node --test');
      expect(result.phases.find(p => p.id === 'testing')?.status).toBe('completed');
      expect(result.phases.find(p => p.id === 'apply')?.status).toBe('completed');
      expect(result.finalText).not.toContain('FAILED');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('routes Hindi backend and script requests to the workspace tools', () => {
    expect(classifyIntent('मेरे सर्वर में नया API जोड़ दो').kind).toBe('agent');
    expect(classifyIntent('Python स्क्रिप्ट बना दो').kind).toBe('agent');
    expect(classifyIntent(
      'मौजूदा sign-in button के लिए app.js में click handler बनाओ, उसे index.html में link करो और style.css बिल्कुल मत बदलो।',
      { currentFile: 'index.html', hasProjectContext: true },
    ).kind).toBe('agent');
  });

  it('continues a terse edit in the selected file using the same conversation context', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-short-followup-'));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      fs.writeFileSync(path.join(root, 'index.html'), '<main class="hero"><h1>Northstar</h1></main>\n');
      fs.writeFileSync(path.join(root, 'src', 'styles.css'), '.hero{width:900px;margin:80px auto;padding:72px}\n');
      fs.writeFileSync(path.join(root, 'src', 'app.js'), 'document.body.dataset.ready = "true";\n');
      const ws = new WorkspaceManager(root);
      const terminal = new TerminalService();
      const git = new GitService(terminal);
      const indexer = new CodebaseIndexer(ws, git);
      const settings = new SettingsStore(path.join(root, '.quillix', 'settings.json'));
      settings.update({autoApplyDiffs: true, terminalApproval: false});
      const seenMessages: Array<Array<{role: string; content: string}>> = [];
      let turn = 0;
      const ai = {
        async chatWithToolsStream(messages: Array<{role: string; content: string}>) {
          seenMessages.push(messages);
          if (turn++ > 0) return {text: 'Updated the selected stylesheet for mobile.'};
          return {text: '', toolCalls: [{
            id: 'polish-css', name: 'write_file', args: {
              filePath: 'src/styles.css',
              content: '.hero{width:min(100% - 2rem, 56rem);margin:clamp(2rem,8vh,5rem) auto;padding:clamp(1.5rem,6vw,4.5rem)}\n@media (max-width:600px){.hero{margin:1rem auto}}\n',
            },
          }]};
        },
      } as unknown as AIProvider;
      const engine = new AgentEngine(ai, new ToolRegistry(ws, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(ws, terminal));
      const result = await engine.run({
        userPrompt: 'Make this page responsive on mobile. Preserve the desktop design and update the open stylesheet.',
        mode: 'agent',
        currentFile: 'src/styles.css',
        conversationHistory: [
          {id: 'previous-user', role: 'user', content: 'Create a simple Northstar product landing page.', timestamp: 1},
          {id: 'previous-assistant', role: 'assistant', content: 'The page is built. Its styles are in src/styles.css.', timestamp: 2},
        ],
      });

      expect(fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8')).toContain('@media');
      expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toBe('<main class="hero"><h1>Northstar</h1></main>\n');
      expect(fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8')).toBe('document.body.dataset.ready = "true";\n');
      expect(result.verifiedFiles).toContain('src/styles.css');
      const firstTurnContext = seenMessages[0].map(message => message.content).join('\n');
      expect(firstTurnContext).toContain('Create a simple Northstar product landing page.');
      expect(firstTurnContext).toContain('Make this page responsive on mobile. Preserve the desktop design and update the open stylesheet.');
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('keeps a selected-file follow-up incomplete until the requested file is actually written', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-selected-file-write-gate-'));
    try {
      const stylePath = path.join(root, 'style.css');
      fs.writeFileSync(stylePath, '.card{padding:1rem;transition:transform .2s}\n');
      const ws = new WorkspaceManager(root);
      const terminal = new TerminalService();
      const git = new GitService(terminal);
      const indexer = new CodebaseIndexer(ws, git);
      const settings = new SettingsStore(path.join(root, '.quillix', 'settings.json'));
      settings.update({autoApplyDiffs: true, terminalApproval: false});
      let turn = 0;
      const ai = {
        async chatWithToolsStream() {
          turn++;
          if (turn === 1) return {text: 'I will improve the selected stylesheet.'};
          if (turn === 2) return {text: '', toolCalls: [{
            id: 'read-selected-css', name: 'read_file', args: {filePath: 'style.css'},
          }]};
          if (turn === 3) return {text: 'The file is ready.', toolCalls: [{
            id: 'append-selected-css', name: 'append_file', args: {
              filePath: 'style.css',
              content: '\n@keyframes card-enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}\n.card{animation:card-enter .45s ease-out both}\n.card:hover{transform:translateY(-4px);box-shadow:0 1rem 2rem #18234a22}\n',
            },
          }]};
          return {text: 'The selected CSS update is complete.'};
        },
      } as unknown as AIProvider;
      const engine = new AgentEngine(ai, new ToolRegistry(ws, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(ws, terminal));
      const result = await engine.run({
        userPrompt: 'add more css and animations', mode: 'agent', currentFile: 'style.css', conversationHistory: [],
      });

      expect(turn).toBeGreaterThanOrEqual(3);
      expect(fs.readFileSync(stylePath, 'utf8')).toContain('.card:hover');
      expect(result.toolCalls.some(call => call.name === 'append_file' && call.args.filePath === 'style.css')).toBe(true);
      expect(result.verifiedFiles).toContain('style.css');
      expect(result.finalText).not.toContain('requested fix was not applied');
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('routes a provider code block from an existing-project fix into the open file, not Chat', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-fix-code-routing-'));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      const stylePath = path.join(root, 'src', 'styles.css');
      fs.writeFileSync(stylePath, '.hero{width:900px;margin:80px auto}\n');
      const ws = new WorkspaceManager(root);
      const terminal = new TerminalService();
      const git = new GitService(terminal);
      const indexer = new CodebaseIndexer(ws, git);
      const settings = new SettingsStore(path.join(root, '.quillix', 'settings.json'));
      settings.update({autoApplyDiffs: true, terminalApproval: false});
      let turn = 0;
      const ai = {
        async chatWithToolsStream(_messages: any[], _tools: any[], _options: any, onToken: (token: string) => void) {
          const text = turn++ === 0
            ? 'Updated stylesheet:\n.hero{width:min(100% - 2rem,56rem);margin:clamp(2rem,8vh,5rem) auto}\n@media(max-width:600px){.hero{margin:1rem auto}}\nThe CSS is ready for verification.'
            : 'The open stylesheet was updated and checked.';
          for (const character of text) onToken(character);
          return {text, toolCalls: []};
        },
      } as unknown as AIProvider;
      const visibleTokens: string[] = [];
      const result = await new AgentEngine(ai, new ToolRegistry(ws, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(ws, terminal)).run({
        userPrompt: 'Upgrade CSS.', mode: 'agent', currentFile: 'src/styles.css', conversationHistory: [],
        settings: {maxAutonomousTurns: 4, temperature: 0, autoApplyDiffs: true},
        onToken: token => visibleTokens.push(token),
      });

      const written = fs.readFileSync(stylePath, 'utf8');
      expect(written).toContain('clamp(');
      expect(written).toContain('@media');
      expect(result.toolCalls.some(call => call.name === 'write_file' && call.args.filePath === 'src/styles.css')).toBe(true);
      expect(visibleTokens.join('')).not.toContain('.hero{width:min');
      expect(result.finalText).not.toContain('.hero{width:min');
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
  });

  it('hands multi-file changes to a read-only reviewer and routes major findings back to the coder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-review-handoff-'));
    try {
      fs.writeFileSync(path.join(root, 'inventory.cjs'), 'exports.available = stock => stock;\n');
      fs.writeFileSync(path.join(root, 'checkout.cjs'), 'exports.canBuy = (stock, count) => stock >= count;\n');
      const ws = new WorkspaceManager(root);
      const terminal = new TerminalService();
      const git = new GitService(terminal);
      const indexer = new CodebaseIndexer(ws, git);
      const settings = new SettingsStore(path.join(root, '.quillix', 'settings.json'));
      settings.update({ autoApplyDiffs: true, terminalApproval: false, maxAutonomousTurns: 8 });

      const reviewCalls: Array<{ tools: unknown[]; messages: Array<{role: string; content: string}> }> = [];
      const coderMessages: Array<Array<{role: string; content: string}>> = [];
      let coderTurn = 0;
      const ai = {
        capabilities: { tools: true, streaming: true, reasoning: false },
        async chatWithToolsStream(messages: Array<{role: string; content: string}>) {
          coderMessages.push(messages);
          const turn = coderTurn++;
          if (turn === 0) return { text: '', toolCalls: [
            { id: 'inventory', name: 'write_file', args: { filePath: 'inventory.cjs', content: 'exports.available = stock => Math.max(0, Number(stock) || 0);\n' } },
            { id: 'checkout', name: 'write_file', args: { filePath: 'checkout.cjs', content: 'exports.canBuy = (stock, count) => Number.isFinite(count) && count > 0 && stock >= count;\n' } },
          ] };
          if (turn === 1) return { text: 'The inventory and checkout changes are ready.' };
          if (turn === 2) return { text: '', toolCalls: [{
            id: 'repair-review-finding', name: 'write_file', args: {
              filePath: 'checkout.cjs',
              content: 'exports.canBuy = (stock, count) => Number.isFinite(stock) && Number.isFinite(count) && count > 0 && stock >= count;\n',
            },
          }] };
          return { text: 'The multi-file change and reviewer finding have been handled.' };
        },
        async chatWithTools(messages: Array<{role: string; content: string}>, tools: unknown[]) {
          reviewCalls.push({ messages, tools });
          return {
            text: JSON.stringify({ findings: [{
              severity: 'major', file: 'checkout.cjs', line: 1,
              issue: 'Validate stock as finite before comparing quantities.',
            }] }),
            usage: { inputTokens: 120, outputTokens: 24 },
          };
        },
      } as unknown as AIProvider;

      // Exercise the general-task review gate without adding a separate
      // verification command to this handoff-focused integration test.
      const request = 'Fix inventory.cjs and checkout.cjs for production-ready multi-file reliability. ' +
        'Preserve the existing public API and return types while making quantity handling robust. '.repeat(15);
      const result = await new AgentEngine(
        ai,
        new ToolRegistry(ws, terminal, git, indexer, settings),
        indexer,
        new WorkspaceVerifier(ws, terminal),
      ).run({ userPrompt: request, mode: 'agent', conversationHistory: [] });

      expect(reviewCalls).toHaveLength(1);
      expect(reviewCalls[0].tools).toEqual([]);
      expect(reviewCalls[0].messages[0].content).toContain('read-only code-review agent');
      expect(coderMessages.some(messages => messages.some(message =>
        message.content.includes('Validate stock as finite before comparing quantities.')))).toBe(true);
      expect(fs.readFileSync(path.join(root, 'checkout.cjs'), 'utf8')).toContain('Number.isFinite(stock)');
      expect(result.toolCalls.some(call => call.name === 'write_file' && call.args.filePath === 'checkout.cjs')).toBe(true);
      expect(result.finalText).not.toContain('unresolved issues');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('prefers an explicit existing file path over stale active project memory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-explicit-path-'));
    try {
      fs.mkdirSync(path.join(root, 'BrokenApp'));
      fs.mkdirSync(path.join(root, 'Calculator2'));
      fs.writeFileSync(path.join(root, 'BrokenApp', 'main.py'), 'print("broken")\n');
      const ws = new WorkspaceManager(root);
      const terminal = new TerminalService();
      const git = new GitService(terminal);
      const indexer = new CodebaseIndexer(ws, git);
      const settings = new SettingsStore(path.join(root, '.quillix', 'settings.json'));
      settings.update({ autoApplyDiffs: true, terminalApproval: false });
      const memory = new ProjectMemory(root);
      memory.setActive('Calculator2', path.join(root, 'Calculator2'));
      let turn = 0;
      const ai = {
        async chatWithToolsStream() {
          if (turn++ > 0) return { text: 'BrokenApp/main.py is fixed.' };
          return { text: '', toolCalls: [{ id: 'fix', name: 'write_file', args: { filePath: 'main.py', content: 'print("fixed")\n' } }] };
        },
      } as unknown as AIProvider;
      const engine = new AgentEngine(ai, new ToolRegistry(ws, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(ws, terminal), memory);
      const result = await engine.run({ userPrompt: 'Fix the syntax errors in BrokenApp/main.py.', mode: 'agent', conversationHistory: [] });
      expect(fs.readFileSync(path.join(root, 'BrokenApp', 'main.py'), 'utf8')).toBe('print("fixed")\n');
      expect(fs.existsSync(path.join(root, 'Calculator2', 'main.py'))).toBe(false);
      expect(result.projectReport?.projectRoot).toBe(path.join(root, 'BrokenApp'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('keeps source paths scoped to the workspace instead of treating src as a project root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-source-path-'));
    try {
      fs.mkdirSync(path.join(root, 'src', 'shared'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'shared', 'money.cjs'), 'exports.formatMoney = value => `$${value}`;\n');
      const ws = new WorkspaceManager(root);
      const terminal = new TerminalService();
      const git = new GitService(terminal);
      const indexer = new CodebaseIndexer(ws, git);
      const settings = new SettingsStore(path.join(root, '.quillix', 'settings.json'));
      settings.update({ autoApplyDiffs: true, terminalApproval: false });
      let turn = 0;
      const ai = {
        async chatWithToolsStream() {
          if (turn++ > 0) return { text: 'Updated workspace source.' };
          return { text: '', toolCalls: [{ id: 'write', name: 'write_file', args: { filePath: 'src/shared/money.cjs', content: 'exports.formatMoney = value => `$${Number(value).toFixed(2)}`;\n' } }] };
        },
      } as unknown as AIProvider;
      const engine = new AgentEngine(ai, new ToolRegistry(ws, terminal, git, indexer, settings), indexer, new WorkspaceVerifier(ws, terminal));
      const result = await engine.run({ userPrompt: 'Update src/shared/money.cjs to format amounts with two decimals.', mode: 'agent', conversationHistory: [] });
      expect(fs.readFileSync(path.join(root, 'src', 'shared', 'money.cjs'), 'utf8')).toContain('toFixed(2)');
      expect(fs.existsSync(path.join(root, 'src', 'shared', 'src', 'shared', 'money.cjs'))).toBe(false);
      expect(result.verifiedFiles).toContain('src/shared/money.cjs');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
