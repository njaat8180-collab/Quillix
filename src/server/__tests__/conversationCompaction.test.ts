import { describe, expect, it } from 'vitest';
import { compactAgentTurnHistory, compactConversationHistory, compactToolResult } from '../agentEngine.js';

describe('token-efficient conversation history', () => {
  it('deduplicates repeated turns, keeps recent context and respects the character budget', () => {
    const history = [
      { id: '1', timestamp: 1, role: 'user' as const, content: 'Create the app.' },
      { id: '2', timestamp: 2, role: 'assistant' as const, content: 'I will create the app.' },
      { id: '3', timestamp: 3, role: 'assistant' as const, content: 'I will create the app.' },
      { id: '4', timestamp: 4, role: 'user' as const, content: 'Create the app.' },
      { id: '5', timestamp: 5, role: 'assistant' as const, content: 'x'.repeat(3000) },
      { id: '6', timestamp: 6, role: 'user' as const, content: 'Now fix the cart bug.' },
    ];
    const compact = compactConversationHistory(history, true, 1200);
    expect(compact.at(-1)?.content).toBe('Now fix the cart bug.');
    expect(compact.filter(item => item.content === 'I will create the app.')).toHaveLength(1);
    expect(compact.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(1200);
  });

  it('preserves both the beginning and end of an oversized message', () => {
    const history = [{ id: '1', timestamp: 1, role: 'user' as const, content: `IMPORTANT REQUIREMENT ${'x'.repeat(1200)} FINAL ACCEPTANCE CHECK` }];
    const compact = compactConversationHistory(history, true, 900);
    expect(compact[0].content).toContain('IMPORTANT REQUIREMENT');
    expect(compact[0].content).toContain('FINAL ACCEPTANCE CHECK');
    expect(compact[0].content).toContain('middle compacted');
  });

  it('keeps a contiguous newest history suffix instead of reintroducing stale turns around an omitted large turn', () => {
    const history = [
      { id: 'old', timestamp: 1, role: 'user' as const, content: 'Old project instruction'.padEnd(80, '.') },
      { id: 'large-middle', timestamp: 2, role: 'assistant' as const, content: 'Middle response'.padEnd(350, '.') },
      { id: 'latest', timestamp: 3, role: 'user' as const, content: 'Current edit request'.padEnd(300, '.') },
    ];
    const compact = compactConversationHistory(history, true, 400);
    expect(compact.map(message => message.id)).toEqual(['latest']);
    expect(compact.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(400);
  });

  it('compacts noisy tool output while preserving failure evidence', () => {
    const output = [
      '\u001b[32mPASS\u001b[0m suite',
      ...Array.from({ length: 120 }, (_, i) => `  repeated directory entry ${i % 4}`),
      'Error: expected button to exist',
      'at verify_file (workspace/index.html:42:7)',
      'FINAL STATUS: failed',
    ].join('\n');
    const compact = compactToolResult('run_tests', output, 900);
    expect(compact.length).toBeLessThanOrEqual(900);
    expect(compact).toContain('Error: expected button to exist');
    expect(compact).toContain('FINAL STATUS: failed');
    expect(compact).not.toContain('\\u001b');
  });

  it('uses a smaller deterministic budget for repeated listing output', () => {
    const output = Array.from({ length: 300 }, (_, i) => `file-${i}.js`).join('\n');
    const compact = compactToolResult('get_project_structure', output);
    expect(compact.length).toBeLessThanOrEqual(1400);
    expect(compact).toContain('tool output compacted');
  });

  it('keeps a complete native tool exchange without leaving orphan tool results', () => {
    const task = { role: 'user' as const, content: 'Fix the project.' };
    const toolCall = { role: 'assistant' as const, content: '', toolCalls: [{ id: 'read', name: 'read_file', args: { filePath: 'app.js' } }] };
    const result = { role: 'tool' as const, toolCallId: 'read', name: 'read_file', content: 'const value = 1;' };
    const orphan = { ...result, toolCallId: 'unknown' };
    expect(compactAgentTurnHistory([task, orphan, toolCall, result], 1, 500)).toEqual([task, toolCall, result]);
    expect(compactAgentTurnHistory([task, toolCall, orphan], 1, 500)).toEqual([task]);
  });

  it('replaces a large write exchange with bounded evidence while keeping the task and latest instruction', () => {
    const task = { role: 'user' as const, content: 'Build a calculator with keyboard shortcuts.' };
    const old = { role: 'user' as const, content: 'Old implementation notes.' };
    const toolCall = { role: 'assistant' as const, content: '', toolCalls: [{ id: 'write', name: 'write_file', args: { content: 'x'.repeat(50_000) } }] };
    const result = { role: 'tool' as const, toolCallId: 'write', name: 'write_file', content: 'Write failed: app.js was changed on disk.' };
    const next = { role: 'user' as const, content: 'Read the latest file before retrying.' };
    const messages = compactAgentTurnHistory([task, old, toolCall, result, next], 1, 1100);
    expect(messages[0]).toBe(task);
    expect(messages.at(-1)).toBe(next);
    expect(messages[1].content).toContain(result.content);
    expect(messages).toHaveLength(3);
    expect(JSON.stringify(messages.slice(1)).length).toBeLessThanOrEqual(1100);
  });
});
