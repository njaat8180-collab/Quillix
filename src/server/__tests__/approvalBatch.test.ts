import { describe, expect, it } from 'vitest';
import { listPendingApprovals, resolveApprovalBatch } from '../approvalBatch.js';

type Entry = { resolve: (approved: boolean) => void; request: Record<string, unknown> };

const queue = (...ids: string[]) => {
  const decisions: Array<{ id: string; approved: boolean }> = [];
  const pending = new Map<string, Entry>();
  for (const id of ids) {
    pending.set(id, {
      resolve: (approved: boolean) => decisions.push({ id, approved }),
      request: { kind: id.includes('term') ? 'terminal' : 'file', title: `Approve ${id}` },
    });
  }
  return { pending, decisions };
};

describe('listPendingApprovals (M2.3)', () => {
  it('shapes queued approvals for a review list and drops empty ids', () => {
    const views = listPendingApprovals([
      ['', { request: { kind: 'file', title: 'ignored' } }],
      ['ap_1', { request: { kind: 'terminal', title: 'npm install', command: 'npm i', reason: 'dependencies' } }],
      ['ap_2', { request: { kind: 'git', title: '  ' } }],
      ['ap_3', { request: {} }],
    ]);
    expect(views).toEqual([
      { id: 'ap_1', kind: 'terminal', title: 'npm install', command: 'npm i', reason: 'dependencies' },
      { id: 'ap_2', kind: 'git', title: 'Pending approval' },
      { id: 'ap_3', kind: 'terminal', title: 'Pending approval' },
    ]);
  });

  it('never mutates the queue while listing', () => {
    const { pending } = queue('a', 'b');
    const entries = [...pending.entries()];
    listPendingApprovals(entries);
    expect([...pending.keys()]).toEqual(['a', 'b']);
  });
});

describe('resolveApprovalBatch (M2.3)', () => {
  it('approves every queued request in one decision and empties the queue', () => {
    const { pending, decisions } = queue('a', 'b', 'c');
    const result = resolveApprovalBatch(pending, true);
    expect(result).toEqual({ resolved: ['a', 'b', 'c'], unresolved: [] });
    expect(decisions).toEqual([
      { id: 'a', approved: true },
      { id: 'b', approved: true },
      { id: 'c', approved: true },
    ]);
    expect(pending.size).toBe(0);
  });

  it('rejects every queued request when the user says no', () => {
    const { pending, decisions } = queue('x', 'y');
    resolveApprovalBatch(pending, false);
    expect(decisions.map(decision => decision.approved)).toEqual([false, false]);
    expect(pending.size).toBe(0);
  });

  it('limits the batch to the selected ids and reports unknown ones honestly', () => {
    const { pending, decisions } = queue('keep', 'other', 'chosen');
    const result = resolveApprovalBatch(pending, true, ['chosen', 'ghost']);
    expect(result.resolved).toEqual(['chosen']);
    expect(result.unresolved).toEqual(['ghost']);
    expect(decisions).toEqual([{ id: 'chosen', approved: true }]);
    expect([...pending.keys()]).toEqual(['keep', 'other']);
  });

  it('is a no-op for an empty selection and for an empty queue', () => {
    const { pending } = queue('a');
    expect(resolveApprovalBatch(pending, true, [])).toEqual({ resolved: ['a'], unresolved: [] });
    const empty = new Map<string, Entry>();
    expect(resolveApprovalBatch(empty, false, ['nope'])).toEqual({ resolved: [], unresolved: ['nope'] });
  });

  it('never resolves the same request twice', () => {
    const { pending, decisions } = queue('once');
    resolveApprovalBatch(pending, true);
    resolveApprovalBatch(pending, true);
    expect(decisions).toHaveLength(1);
  });
});
