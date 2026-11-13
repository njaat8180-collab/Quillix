/**
 * Batch approval decisions for multi-file / multi-command changesets (M2.3).
 *
 * The agent loop queues one approval request per dangerous operation and blocks
 * until the user answers. These helpers let a changeset review UI answer many
 * queued requests at once ("Approve all" / "Reject all") while still supporting
 * selecting a subset. Pure and dependency-free so the decision logic is unit
 * tested independently of the HTTP layer.
 */

export type ApprovalKind = 'terminal' | 'git' | 'file';

export interface PendingApprovalView {
  id: string;
  kind: ApprovalKind;
  title: string;
  command?: string;
  reason?: string;
}

const KINDS: ApprovalKind[] = ['terminal', 'git', 'file'];

/** Shape queued approvals for a review list, newest last, without mutating. */
export function listPendingApprovals<T extends { request: { kind?: string; title?: string; command?: string; reason?: string } }>(
  entries: Iterable<[string, T]>
): PendingApprovalView[] {
  const views: PendingApprovalView[] = [];
  for (const [id, entry] of entries) {
    if (!id) continue;
    const request = entry?.request || {};
    const kind = KINDS.includes(request.kind as ApprovalKind) ? (request.kind as ApprovalKind) : 'terminal';
    const command = typeof request.command === 'string' && request.command ? request.command : undefined;
    const reason = typeof request.reason === 'string' && request.reason ? request.reason : undefined;
    views.push({
      id,
      kind,
      title: typeof request.title === 'string' && request.title.trim() ? request.title : 'Pending approval',
      ...(command ? { command } : {}),
      ...(reason ? { reason } : {}),
    });
  }
  return views;
}

export interface BatchDecisionResult {
  resolved: string[];
  unresolved: string[];
}

/**
 * Resolve queued approvals in one decision. `ids` limits the batch to a subset;
 * unknown ids are reported as unresolved instead of silently succeeding.
 * Resolves each queued entry exactly once.
 */
export function resolveApprovalBatch<T extends { resolve: (approved: boolean) => void }>(
  pending: Map<string, T>,
  approved: boolean,
  ids?: string[]
): BatchDecisionResult {
  const selected = ids && ids.length ? new Set(ids.filter(id => typeof id === 'string' && !!id.trim())) : null;
  const resolved: string[] = [];
  const unresolved: string[] = [];
  const known = new Set(pending.keys());

  // Resolve everything the caller selected that is still queued.
  for (const id of [...pending.keys()]) {
    if (selected && !selected.has(id)) continue;
    const entry = pending.get(id);
    pending.delete(id);
    if (entry) {
      try { entry.resolve(approved); } catch { /* a late resolver must not break the batch */ }
    }
    resolved.push(id);
  }
  // Report selections that were never queued (or already answered).
  if (selected) for (const id of selected) if (!known.has(id)) unresolved.push(id);
  return { resolved, unresolved };
}
