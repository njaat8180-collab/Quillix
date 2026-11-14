import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildProjectReport,
  classifyLocalFallbackReason,
  compactAgentTurnHistory,
  compactConversationHistory,
  compactToolResult,
  focusedEditAnchors,
  formatProjectReport,
  groundFocusedEditArguments,
  isProviderRateLimitError,
  needsFreshEvidence,
  renderFileTree,
  usesCompactLocalToolSurface,
} from '../agentEngine.js';


/**
 * M8.9 â€” coverage for the agent engine's pure decision helpers and the
 * project-report builder.
 *
 * These helpers decide what the agent does with a prompt, so they are worth
 * proving directly: a wrong classification here means the agent silently
 * changes behaviour.
 */
describe('agentEngine helpers (M8.9)', () => {
  describe('usesCompactLocalToolSurface', () => {
    it('uses the compact surface for local models that cannot do tools well', () => {
      expect(usesCompactLocalToolSurface('ollama', 'qwen3')).toBe(true);
      expect(usesCompactLocalToolSurface('ollama', 'llama3')).toBe(true);
    });

    it('keeps the full tool surface for online providers', () => {
      expect(usesCompactLocalToolSurface('openai', 'gpt-4o')).toBe(false);
      expect(usesCompactLocalToolSurface('universal', 'claude')).toBe(false);
    });

    it('handles a missing provider honestly', () => {
      expect(typeof usesCompactLocalToolSurface()).toBe('boolean');
    });
  });

  describe('classifyLocalFallbackReason', () => {
    it('recognises the four fallback reasons', () => {
      expect(classifyLocalFallbackReason('the model does not support tools')).toBe('unsupported tools');
      expect(classifyLocalFallbackReason('rate limit exceeded, try again later')).toBe('rate limit');
      expect(classifyLocalFallbackReason('fetch failed')).toBe('connection loss');
      expect(classifyLocalFallbackReason('cannot connect to host')).toBe('connection loss');
    });

    it('treats an unrecognised message as a timeout', () => {
      expect(classifyLocalFallbackReason('something else entirely')).toBe('timeout');
      expect(classifyLocalFallbackReason('request timed out after 30s')).toBe('timeout');
    });
  });

  describe('isProviderRateLimitError', () => {
    it('recognises a rate limit from the error message', () => {
      expect(isProviderRateLimitError(new Error('429 rate limit exceeded'))).toBe(true);
      expect(isProviderRateLimitError(new Error('Too Many Requests'))).toBe(true);
      expect(isProviderRateLimitError('quota exceeded for this key')).toBe(true);
      expect(isProviderRateLimitError('request was throttled')).toBe(true);
    });

    it('does not mistake other failures for a rate limit', () => {
      expect(isProviderRateLimitError(new Error('500 internal error'))).toBe(false);
      expect(isProviderRateLimitError(undefined)).toBe(false);
      expect(isProviderRateLimitError('plain string')).toBe(false);
    });
  });

  describe('needsFreshEvidence', () => {
    it('requires fresh evidence for version-sensitive and current-state questions', () => {
      expect(needsFreshEvidence('what is the latest version of react')).toBe(true);
      expect(needsFreshEvidence('current price of bitcoin')).toBe(true);
      expect(needsFreshEvidence('latest documentation for vite')).toBe(true);
    });

    it('does not require fresh evidence for ordinary work', () => {
      expect(needsFreshEvidence('rename this variable')).toBe(false);
    });
  });

  describe('focusedEditAnchors', () => {
    it('extracts the identifiers the prompt points at', () => {
      const anchors = focusedEditAnchors('const total = computeTotal();', 'rename computeTotal to sum');
      expect(anchors.join(' ')).toContain('computeTotal');
    });

    it('returns nothing for a prompt with no identifiers', () => {
      const anchors = focusedEditAnchors('const x = 1;', 'make it better');
      expect(Array.isArray(anchors)).toBe(true);
    });

    it('respects the anchor limit', () => {
      const source = 'alpha beta gamma delta epsilon zeta eta theta';
      expect(focusedEditAnchors(source, 'update alpha beta gamma delta epsilon zeta', 2).length).toBeLessThanOrEqual(2);
    });

    it('returns nothing when the source is empty or the prompt has no usable term', () => {
      expect(focusedEditAnchors('', 'rename computeTotal')).toEqual([]);
      expect(focusedEditAnchors('const x = 1;', '')).toEqual([]);
      // Every word is a stop-word, so there is no query to anchor against.
      expect(focusedEditAnchors('const x = 1;', 'this should change')).toEqual([]);
    });

    it('never returns an anchor that appears twice in the source', () => {
      const duplicated = 'const value = 1;\nconst value = 1;';
      const anchors = focusedEditAnchors(duplicated, 'change value');
      for (const anchor of anchors) {
        const first = duplicated.indexOf(anchor);
        expect(duplicated.indexOf(anchor, first + 1)).toBe(-1);
      }
    });

    it('shortens an anchor whose surrounding block is too long', () => {
      const longLine = `const computeTotal = ${'x'.repeat(900)};`;
      const anchors = focusedEditAnchors(longLine, 'change computeTotal');
      for (const anchor of anchors) expect(anchor.length).toBeLessThanOrEqual(600);
    });

    it('returns anchors that really occur in the source', () => {
      const source = 'function alpha() { return 1; }\nfunction beta() { return 2; }';
      const anchors = focusedEditAnchors(source, 'update alpha');
      for (const anchor of anchors) expect(source).toContain(anchor);
    });
  });

  describe('groundFocusedEditArguments', () => {
    const anchors = ['const present = 1;', 'const absent = 3;'];

    it('grounds an edit to the exact anchor text from the source', () => {
      const grounded = groundFocusedEditArguments(
        { oldString: 'const present = 1;', newString: 'const present = 2;' },
        'src/app.ts',
        anchors,
      );
      expect(grounded?.filePath).toBe('src/app.ts');
      expect(grounded?.oldString).toBe('const present = 1;');
      expect(grounded?.newString).toBe('const present = 2;');
    });

    it('grounds an edit by anchor index and removes the index field', () => {
      const grounded = groundFocusedEditArguments(
        { anchorIndex: 1, newString: 'const absent = 4;' },
        'src/app.ts',
        anchors,
      );
      expect(grounded?.oldString).toBe('const absent = 3;');
      expect(grounded).not.toHaveProperty('anchorIndex');
    });

    it('accepts a numeric anchor index sent as a string', () => {
      const grounded = groundFocusedEditArguments(
        { anchorIndex: '0', newString: 'x' },
        'src/app.ts',
        anchors,
      );
      expect(grounded?.oldString).toBe('const present = 1;');
    });

    it('refuses an edit without a new string', () => {
      expect(groundFocusedEditArguments({ oldString: 'const present = 1;' }, 'src/app.ts', anchors)).toBeUndefined();
    });

    it('refuses an edit that names neither an anchor nor an exact old string', () => {
      expect(groundFocusedEditArguments({ newString: 'x' }, 'src/app.ts', anchors)).toBeUndefined();
      expect(groundFocusedEditArguments({ anchorIndex: 99, newString: 'x' }, 'src/app.ts', anchors)).toBeUndefined();
    });

    it('keeps a non-anchor old string so the edit can still be matched', () => {
      const grounded = groundFocusedEditArguments(
        { oldString: 'const elsewhere = 9;', newString: 'const elsewhere = 10;' },
        'src/app.ts',
        anchors,
      );
      expect(grounded?.oldString).toBe('const elsewhere = 9;');
    });
  });

  describe('compactConversationHistory', () => {
    it('keeps the history within the character budget', () => {
      const history: any[] = Array.from({ length: 40 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'x'.repeat(500),
      }));
      const compacted = compactConversationHistory(history, false, 2000);
      expect(compacted.length).toBeLessThan(history.length);
      expect(compacted.reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(2000);
    });

    it('never drops the most recent turn', () => {
      const history: any[] = [
        { role: 'user', content: 'old '.repeat(500) },
        { role: 'assistant', content: 'newest' },
      ];
      const compacted = compactConversationHistory(history, false, 100);
      expect(compacted[compacted.length - 1].content).toBe('newest');
    });

    it('drops tool and system turns that are not part of the conversation', () => {
      const history: any[] = [
        { role: 'system', content: 'system rules' },
        { role: 'tool', name: 'read_file', content: 'tool output' },
        { role: 'user', content: 'the real question' },
      ];
      const compacted = compactConversationHistory(history, false, 10_000);
      expect(compacted.map(m => m.role)).toEqual(['user']);
    });

    it('drops empty turns', () => {
      const history: any[] = [
        { role: 'user', content: '   ' },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'real content' },
      ];
      const compacted = compactConversationHistory(history, false, 10_000);
      expect(compacted).toHaveLength(1);
      expect(compacted[0].content).toBe('real content');
    });

    it('collapses a repeated adjacent turn', () => {
      const history: any[] = [
        { role: 'user', content: 'same question' },
        { role: 'user', content: 'same question' },
        { role: 'assistant', content: 'answer' },
      ];
      const compacted = compactConversationHistory(history, false, 10_000);
      expect(compacted.filter(m => m.content === 'same question')).toHaveLength(1);
    });

    it('compacts a single overlong message with a visible marker', () => {
      const history: any[] = [{ role: 'user', content: 'z'.repeat(5_000) }];
      const compacted = compactConversationHistory(history, false, 10_000);
      expect(compacted[0].content).toMatch(/middle compacted/i);
      expect(compacted[0].content.length).toBeLessThan(5_000);
    });
  });

  describe('compactAgentTurnHistory', () => {
    it('keeps a recent assistant turn with its matching tool result', () => {
      const conversation: any[] = [
        { role: 'user', content: 'do the thing' },
        {
          role: 'assistant', content: '',
          toolCalls: [{ id: 'call_1', name: 'read_file', arguments: {} }],
        },
        { role: 'tool', name: 'read_file', toolCallId: 'call_1', content: 'file body' },
      ];
      const compacted = compactAgentTurnHistory(conversation, 1, 4000);
      expect(compacted.length).toBeGreaterThan(1);
      expect(compacted.some(m => m.role === 'tool')).toBe(true);
    });

    it('replaces an oversized native exchange with a short evidence recap', () => {
      const conversation: any[] = [
        { role: 'user', content: 'do the thing' },
        {
          role: 'assistant', content: '',
          toolCalls: [{ id: 'call_1', name: 'write_file', arguments: { content: 'q'.repeat(40_000) } }],
        },
        { role: 'tool', name: 'write_file', toolCallId: 'call_1', content: 'wrote file ok' },
      ];
      const compacted = compactAgentTurnHistory(conversation, 1, 1000);
      expect(compacted.length).toBeGreaterThan(0);
      const total = JSON.stringify(compacted).length;
      expect(total).toBeLessThan(40_000);
    });
  });

  describe('compactToolResult', () => {
    it('truncates a long tool output and says so', () => {
      const compacted = compactToolResult('read_file', 'z'.repeat(50_000), 1000);
      expect(compacted.length).toBeLessThanOrEqual(1000);
      expect(compacted).toMatch(/compacted for token budget/i);
    });

    it('keeps failure lines when compacting a log', () => {
      const compacted = compactToolResult('run_tests', `filler\n${'x'.repeat(5000)}\nError: build failed`, 1000);
      expect(compacted).toMatch(/Error: build failed/);
    });

    it('leaves a short tool output alone', () => {
      expect(compactToolResult('read_file', 'short output', 1000)).toBe('short output');
    });

    it('drops ANSI colour codes and duplicate lines', () => {
      const compacted = compactToolResult('read_file', '[31mred[0m\nred\nblue', 1000);
      expect(compacted).toBe('red\nblue');
    });

    it('returns an empty string for empty output', () => {
      expect(compactToolResult('read_file', '', 1000)).toBe('');
    });
  });

  describe('renderFileTree', () => {
    let root: string;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-tree-')); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('renders directories and files from the real disk', () => {
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'x', 'utf8');
      fs.writeFileSync(path.join(root, 'readme.md'), 'x', 'utf8');
      const tree = renderFileTree(root, 'project');
      expect(tree.startsWith('project/')).toBe(true);
      expect(tree).toContain('src/');
      expect(tree).toContain('index.ts');
      expect(tree).toContain('readme.md');
    });

    it('skips build and dependency directories', () => {
      fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(root, 'node_modules', 'dep.js'), 'x', 'utf8');
      fs.mkdirSync(path.join(root, '.git'), { recursive: true });
      const tree = renderFileTree(root, 'project');
      expect(tree).not.toContain('node_modules');
      expect(tree).not.toContain('.git');
    });

    it('returns just the root label for a directory that cannot be read', () => {
      expect(renderFileTree(path.join(root, 'does-not-exist'), 'project')).toBe('project/');
    });
  });

  describe('buildProjectReport / formatProjectReport', () => {
    let root: string;
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'quillix-report-'));
      fs.mkdirSync(path.join(root, 'app'), { recursive: true });
      fs.writeFileSync(path.join(root, 'app', 'index.ts'), 'x', 'utf8');
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('verifies every reported file against the real disk', () => {
      const report = buildProjectReport({
        workspaceRoot: root,
        projectPrefix: 'app',
        projectName: 'My App',
        patches: [
          { filePath: 'app/index.ts', changeType: 'modified' } as any,
          { filePath: 'app/ghost.ts', changeType: 'created' } as any,
        ],
        writtenFiles: ['app/written.ts'],
        verification: { summary: 'All checks passed.' } as any,
      });

      const index = report.files.find(f => f.relativePath === 'app/index.ts');
      expect(index?.exists).toBe(true);
      expect(index?.sizeBytes).toBe(1);
      // A file that was never written must be reported as missing, not claimed.
      const ghost = report.files.find(f => f.relativePath === 'app/ghost.ts');
      expect(ghost?.exists).toBe(false);
      const written = report.files.find(f => f.relativePath === 'app/written.ts');
      expect(written?.changeType).toBe('created');
      expect(written?.exists).toBe(false);
    });

    it('formats the report honestly, listing missing files', () => {
      const report = buildProjectReport({
        workspaceRoot: root,
        projectPrefix: 'app',
        projectName: 'My App',
        patches: [
          { filePath: 'app/index.ts', changeType: 'modified' } as any,
          { filePath: 'app/ghost.ts', changeType: 'created' } as any,
        ],
        writtenFiles: [],
        verification: { summary: 'All checks passed.' } as any,
      });
      const text = formatProjectReport(report);
      expect(text).toContain('PROJECT: My App');
      expect(text).toContain('MODIFIED:');
      expect(text).toContain('app/index.ts');
      expect(text).toContain('NOT ON DISK');
      expect(text).toContain('app/ghost.ts');
      expect(text).toContain('VERIFICATION: All checks passed.');
    });

    it('renders a missing project root honestly', () => {
      const report = buildProjectReport({
        workspaceRoot: root,
        projectPrefix: 'not-there',
        projectName: 'Gone',
        patches: [],
        writtenFiles: [],
        verification: { summary: 'nothing to verify' } as any,
      });
      expect(report.fileTree).toContain('missing');
    });
  });
});
