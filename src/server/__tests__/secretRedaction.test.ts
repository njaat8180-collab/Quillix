import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactSensitiveText, redactSensitiveTextForRoundTrip, restoreSensitiveValues } from '../../shared/secretRedaction.js';
import { WorkspaceManager } from '../workspace.js';
import { ToolRegistry } from '../toolRegistry.js';
import { TerminalService } from '../terminal.js';
import { GitService } from '../git.js';
import { CodebaseIndexer } from '../indexer.js';
import { DEFAULT_SETTINGS, SettingsStore } from '../settings.js';
import type { ToolExecutionContext } from '../toolRegistry.js';

let tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

function makeToolHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-secret-tools-'));
  tempDirs.push(root);
  const workspace = new WorkspaceManager(root);
  const terminal = new TerminalService();
  const git = new GitService(terminal);
  const settings = new SettingsStore(path.join(root, '.settings.json'));
  settings.update({ ...DEFAULT_SETTINGS, autoApplyDiffs: true, terminalApproval: false });
  const registry = new ToolRegistry(workspace, terminal, git, new CodebaseIndexer(workspace, git), settings);
  const context: ToolExecutionContext = { secretRedactions: new Map() };
  return { root, workspace, registry, context };
}

describe('shared source-secret redaction', () => {
  it('masks common provider, cloud, and package credentials in every source context', () => {
    const credentials = [
      'AKIA1234567890ABCDEF',
      'sk_live_abcdefghijklmnop123456',
      'gsk_abcdefghijklmnop123456',
      'hf_abcdefghijklmnopqrstuvwx',
      'glpat-abcdefghijklmnopqrstuvwx',
      'npm_abcdefghijklmnopqrstuvwxyz123456',
    ];
    const input = [
      `const accessKey = "${credentials[0]}";`,
      `const apiKey = "${credentials[1]}";`,
      `const groqKey = "${credentials[2]}";`,
      `const modelKey = "${credentials[3]}";`,
      `const GITLAB_TOKEN = "${credentials[4]}";`,
      `const npmToken = "${credentials[5]}";`,
      'const tokenCount = 12; // the token budget is 1200 tokens',
    ].join('\n');

    const redacted = redactSensitiveText(input);
    const workspaceRedacted = new WorkspaceManager(process.cwd()).redactSecrets(input);

    for (const secret of credentials) {
      expect(redacted).not.toContain(secret);
      expect(workspaceRedacted).not.toContain(secret);
    }
    expect(redacted).toContain('[REDACTED_AWS_ACCESS_KEY]');
    expect(redacted).toContain('[REDACTED_PROVIDER_KEY]');
    expect(redacted).toContain('[REDACTED_GITLAB_TOKEN]');
    expect(redacted).toContain('[REDACTED_NPM_TOKEN]');
    expect(redacted).toContain('tokenCount = 12');
    expect(redacted).toContain('token budget is 1200 tokens');
  });

  it('round-trips opaque handles without exposing the original credential', () => {
    const secret = 'sk_live_abcdefghijklmnop123456';
    const result = redactSensitiveTextForRoundTrip(`const apiKey = "${secret}";`);
    expect(result.content).not.toContain(secret);
    expect(result.content).toMatch(/__QUILLIX_SECRET_PROVIDER_KEY_[a-f0-9]+__/);
    const restored = restoreSensitiveValues(result.content, result.values);
    expect(restored.missing).toEqual([]);
    expect(restored.content).toContain(secret);
  });

  it('keeps a secret handle stable when the same file is read again', () => {
    const secret = 'sk_live_abcdefghijklmnop123456';
    const first = redactSensitiveTextForRoundTrip(`const apiKey = "${secret}";`);
    const second = redactSensitiveTextForRoundTrip(`const apiKey = "${secret}";`, first.values);
    expect(second.content).toBe(first.content);
    expect(restoreSensitiveValues(first.content, second.values).content).toContain(secret);
  });

  it('redacts read_file output and restores handles on a complete write', async () => {
    const { workspace, registry, context } = makeToolHarness();
    const secret = 'sk_live_abcdefghijklmnop123456';
    fs.writeFileSync(path.join(workspace.getRoot(), 'config.ts'), `export const apiKey = "${secret}";\nexport const label = "before";\n`);

    const read = await registry.executeTool('read-1', 'read_file', { filePath: 'config.ts' }, context);
    expect(read.success).toBe(true);
    expect(read.output).not.toContain(secret);
    expect(read.output).toContain('__QUILLIX_SECRET_');

    const write = await registry.executeTool('write-1', 'write_file', {
      filePath: 'config.ts',
      content: read.output.replace('before', 'after'),
    }, context);
    expect(write.success).toBe(true);
    expect(fs.readFileSync(path.join(workspace.getRoot(), 'config.ts'), 'utf8')).toContain(secret);
    expect(fs.readFileSync(path.join(workspace.getRoot(), 'config.ts'), 'utf8')).toContain('after');
  });

  it('blocks a whole-file write that drops an opaque handle without changing disk', async () => {
    const { workspace, registry, context } = makeToolHarness();
    const secret = 'sk_live_abcdefghijklmnop123456';
    const original = `export const apiKey = "${secret}";\nexport const label = "before";\n`;
    fs.writeFileSync(path.join(workspace.getRoot(), 'config.ts'), original);
    const read = await registry.executeTool('read-2', 'read_file', { filePath: 'config.ts' }, context);
    const output = await registry.executeTool('write-2', 'write_file', {
      filePath: 'config.ts', content: read.output.replace(/export const apiKey = .*;\n/, ''),
    }, context);
    expect(output.success).toBe(false);
    expect(output.error).toMatch(/preserve every opaque secret handle/i);
    expect(fs.readFileSync(path.join(workspace.getRoot(), 'config.ts'), 'utf8')).toBe(original);
  });

  it('preserves an untouched inline credential during a focused edit', async () => {
    const { workspace, registry, context } = makeToolHarness();
    const secret = 'sk_live_abcdefghijklmnop123456';
    fs.writeFileSync(path.join(workspace.getRoot(), 'config.ts'), `export const apiKey = "${secret}";\nexport const label = "before";\n`);
    const read = await registry.executeTool('read-3', 'read_file', { filePath: 'config.ts' }, context);
    const oldString = 'export const label = "before";';
    const edit = await registry.executeTool('edit-1', 'edit_file', {
      filePath: 'config.ts', oldString, newString: 'export const label = "after";',
    }, context);
    expect(read.output).not.toContain(secret);
    expect(edit.success).toBe(true);
    const saved = fs.readFileSync(path.join(workspace.getRoot(), 'config.ts'), 'utf8');
    expect(saved).toContain(secret);
    expect(saved).toContain('label = "after"');
  });
});
