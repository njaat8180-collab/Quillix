import { describe, expect, it } from 'vitest';
import { resultPresentation, latestVerificationResults } from '../../shared/resultPresentation.js';
import type { ChatMessage } from '../../shared/types.js';

const message = (patch: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'preview', role: 'assistant', timestamp: 0, content: 'Done.', ...patch });
describe('truthful UI result presentation', () => {
  it('does not show completed when the model claims success but validation failed', () => {
    const result = resultPresentation(message({ content: 'The file has been created successfully.', phases: [{ id: 'validation', title: 'Validate', status: 'failed' }] }));
    expect(result.needsRepair).toBe(true); expect(result.tone).toBe('danger'); expect(result.label).not.toBe('Task completed');
  });
  it('recognizes legacy failed result text even without verification tool calls', () => {
    expect(resultPresentation(message({ content: 'File saved.\nTask FAILED: validation failed.' })).needsRepair).toBe(true);
  });
  it('marks an applied-and-verified phase workflow completed', () => {
    expect(resultPresentation(message({ phases: [{ id: 'completion', title: 'Report', status: 'completed' }] })).tone).toBe('success');
  });
  it('keeps review and cancelled results distinct from success', () => {
    expect(resultPresentation(message({ content: 'PENDING REVIEW: changes not saved' })).label).toBe('Changes await review');
    expect(resultPresentation(message({ content: 'Task cancelled.' })).tone).toBe('muted');
  });
  it('uses the passing retest instead of a stale failed verification', () => {
    const tools = [ { toolCallId: '1', toolName: 'run_tests', success: false, output: 'failed' }, { toolCallId: '2', toolName: 'run_tests', success: true, output: 'passed' } ];
    expect(latestVerificationResults(tools)).toHaveLength(1);
    expect(resultPresentation(message({ toolResults: tools })).needsRepair).toBe(false);
  });

  it('trusts the backend verified outcome over stale intermediate phase history', () => {
    const result = resultPresentation(message({
      content: 'Task completed. Earlier attempt was repaired.',
      verified: true,
      phases: [{ id: 'write', title: 'Write', status: 'failed' }, { id: 'completion', title: 'Completion', status: 'completed' }],
      toolResults: [{ toolCallId: 'old', toolName: 'run_tests', success: false, output: 'old failure' }],
    }));
    expect(result).toEqual({ label: 'Task completed', tone: 'success', needsRepair: false });
  });
  it('does not invent verification for legacy plain output', () => {
    expect(resultPresentation(message()).tone).toBe('muted');
  });
});
