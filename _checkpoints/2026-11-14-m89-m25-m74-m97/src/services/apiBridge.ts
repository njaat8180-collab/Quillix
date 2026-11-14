import {
  FileNode,
  ProjectMetadata,
  CommandExecutionResult,
  SystemHealthItem,
  ToolDefinition,
  ToolResult,
  SearchMatch,
  QuillixSettings,
  TerminalHistoryEntry,
  SelfHealEntry,
  ProjectProfile,
  ProjectRunInfo,
  ProjectMemorySnapshot,
  ProviderHealthSummary,
  TaskHistoryRecord,
} from '../shared/types.js';
import { parseMissionState, type MissionState } from '../shared/missionState.js';

interface QuillixDesktopBridge {
  isDesktop: boolean;
  selectFolder: () => Promise<string | null>;
  minimize: () => Promise<boolean>;
  toggleMaximize: () => Promise<boolean>;
  isMaximized: () => Promise<boolean>;
}

export interface BrainCatalogEntry {
  id: string;
  label: string;
  mode: 'offline' | 'online';
  capabilities: {
    tools: boolean;
    streaming: boolean;
    reasoning: boolean;
  };
}

export interface BrainCatalogResponse {
  success: boolean;
  active?: string;
  brains: BrainCatalogEntry[];
  error?: string;
}

declare global {
  interface Window {
    electronAPI?: any;
    quillixDesktop?: QuillixDesktopBridge;
  }
}

export class ApiBridge {
  private activeWorkspaceRoot = '';
  private conversationMode: 'chat' | 'agent' = 'chat';

  /** Keep all manual Studio actions under the same persisted Chat/Agent lock. */
  public setConversationModeContext(workspaceRoot: string, mode: 'chat' | 'agent'): void {
    this.activeWorkspaceRoot = String(workspaceRoot || '');
    this.conversationMode = mode;
  }

  private mutationBlockedReason(): string | null {
    return this.activeWorkspaceRoot && this.conversationMode === 'agent'
      ? null
      : 'Workspace actions are disabled in Chat mode. Switch to Agent mode to make changes.';
  }

  public async getEditorProject(signal?: AbortSignal): Promise<import('../shared/editorProject.js').EditorProjectSnapshot> {
    const response = await fetch('/api/workspace/editor-project', { signal, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Source context unavailable');
    return result;
  }

  /** M3.4: status of the opt-in automatic check that runs after saves. */
  public async getAutoTestStatus(): Promise<{
    success: boolean;
    available: boolean;
    enabled: boolean;
    commandLabel: string | null;
    reason: string | null;
    running: boolean;
    lastRun: { ok: boolean; exitCode: number | null; durationMs: number; triggeredBy: 'save' | 'manual'; filePath?: string; stdoutTail: string; stderrTail: string; timedOut: boolean } | null;
    history: Array<{ ok: boolean; exitCode: number | null; durationMs: number; triggeredBy: 'save' | 'manual'; filePath?: string; stdoutTail: string; stderrTail: string; timedOut: boolean }>;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/editor/auto-test', { cache: 'no-store' });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) return { success: false, available: false, enabled: false, commandLabel: null, reason: null, running: false, lastRun: null, history: [], error: result.error || 'Auto-test status unavailable.' };
      return result;
    } catch {
      return { success: false, available: false, enabled: false, commandLabel: null, reason: null, running: false, lastRun: null, history: [], error: 'Auto-test status unavailable.' };
    }
  }

  /** M2.4: undo the most recent agent changeset (conflict-safe restore). */
  public async undoLastChangeset(): Promise<{ success: boolean; restored?: string[]; conflicts?: string[]; taskId?: string; userRequest?: string; error?: string }> {
    try {
      const res = await fetch('/api/tasks/undo-last-changeset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationMode: 'agent' }),
      });
      return await res.json().catch(() => ({ success: false, error: 'Undo failed.' }));
    } catch {
      return { success: false, error: 'Undo request failed.' };
    }
  }

  // --- M7.4: contextual chat (ask about one specific line) ---
  public async askAboutLine(input: {
    filePath: string;
    line: number;
    content: string;
    question: string;
  }): Promise<{ success: boolean; answer?: string; filePath?: string; line?: number; error?: string }> {
    try {
      const res = await fetch('/api/editor/ask-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return await res.json().catch(() => ({ success: false, error: 'The question could not be answered.' }));
    } catch {
      return { success: false, error: 'The question request failed.' };
    }
  }

  // --- M9.6: workspace lock (concurrent workspace safety) ---
  public async getWorkspaceLockStatus(): Promise<{
    success: boolean;
    lock?: {
      workspace: string;
      lockPath: string;
      held: boolean;
      stale: boolean;
      ageMs: number;
      reason: string;
      fallbackLocation: boolean;
      owner?: { sessionId: string; instanceId: string; pid: number; hostname: string; username: string; appVersion: string; acquiredAt: string; heartbeatAt: string };
    };
    ownedByThisInstance?: boolean;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/workspace/lock', { cache: 'no-store' });
      return await res.json();
    } catch {
      return { success: false, error: 'Workspace lock status unavailable.' };
    }
  }

  public async acquireWorkspaceLock(): Promise<{ success: boolean; lock?: any; error?: string }> {
    try {
      const res = await fetch('/api/workspace/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationMode: 'agent' }),
      });
      return await res.json().catch(() => ({ success: false, error: 'Could not claim the workspace.' }));
    } catch {
      return { success: false, error: 'Could not claim the workspace.' };
    }
  }

  public async releaseWorkspaceLock(): Promise<{ success: boolean; lock?: any; error?: string }> {
    try {
      const res = await fetch('/api/workspace/lock/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationMode: 'agent' }),
      });
      return await res.json().catch(() => ({ success: false, error: 'Could not release the workspace lock.' }));
    } catch {
      return { success: false, error: 'Could not release the workspace lock.' };
    }
  }

  // --- M9.3: provider key health (no key material is ever returned) ---
  public async getProviderKeyHealth(): Promise<{
    success: boolean;
    providers?: Array<{
      provider: string;
      total: number;
      healthy: number;
      coolingDown: number;
      disabled: number;
      activeKeyId?: string;
      keys: Array<{
        keyId: string;
        status: 'healthy' | 'cooldown' | 'disabled';
        failureKind?: string;
        cooldownUntil?: number;
        consecutiveFailures: number;
        lastFailureAt?: number;
        lastSuccessAt?: number;
        requests: number;
        failures: number;
      }>;
    }>;
    error?: string;
  }> {
    try {
      const res = await fetch('/api/providers/key-health', { cache: 'no-store' });
      return await res.json();
    } catch {
      return { success: false, error: 'Provider key health unavailable.' };
    }
  }

  // --- M3.6: git bisect assist ---
  public async getGitBisectProgress(): Promise<{
    success: boolean;
    progress?: {
      active: boolean;
      session: any;
      currentShort?: string;
      currentSubject?: string;
      remaining: number;
      tested: number;
      estimatedTotal: number;
      message: string;
    };
    error?: string;
  }> {
    try {
      const res = await fetch('/api/git/bisect', { cache: 'no-store' });
      return await res.json();
    } catch {
      return { success: false, error: 'Bisect progress unavailable.' };
    }
  }

  public async startGitBisect(payload: {
    good: string;
    bad: string;
    testCommand: string;
    timeoutMs?: number;
  }): Promise<{ success: boolean; session?: any; error?: string }> {
    try {
      const res = await fetch('/api/git/bisect/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, conversationMode: 'agent' }),
      });
      return await res.json().catch(() => ({ success: false, error: 'Could not start the bisect session.' }));
    } catch {
      return { success: false, error: 'Could not start the bisect session.' };
    }
  }

  public async runGitBisectStep(): Promise<{ success: boolean; classification?: string; session?: any; progress?: any; error?: string }> {
    try {
      const res = await fetch('/api/git/bisect/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationMode: 'agent' }),
      });
      return await res.json().catch(() => ({ success: false, error: 'Could not run the bisect step.' }));
    } catch {
      return { success: false, error: 'Could not run the bisect step.' };
    }
  }

  public async recoverGitBisect(): Promise<{ success: boolean; session?: any; error?: string }> {
    try {
      const res = await fetch('/api/git/bisect/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationMode: 'agent' }),
      });
      return await res.json().catch(() => ({ success: false, error: 'Could not recover the bisect session.' }));
    } catch {
      return { success: false, error: 'Could not recover the bisect session.' };
    }
  }

  public async finishGitBisect(): Promise<{ success: boolean; session?: any; error?: string }> {
    try {
      const res = await fetch('/api/git/bisect/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationMode: 'agent' }),
      });
      return await res.json().catch(() => ({ success: false, error: 'Could not finish the bisect session.' }));
    } catch {
      return { success: false, error: 'Could not finish the bisect session.' };
    }
  }

  // --- M4.4: named checkpoints ---
  public async listCheckpoints(): Promise<{ success: boolean; checkpoints: Array<{ id: string; name: string; createdAt: number; fileCount: number; totalBytes: number; truncated: boolean }>; error?: string }> {
    try {
      const res = await fetch('/api/checkpoints', { cache: 'no-store' });
      return await res.json();
    } catch {
      return { success: false, checkpoints: [], error: 'Checkpoints unavailable.' };
    }
  }

  public async createCheckpoint(name: string): Promise<{ success: boolean; checkpoint?: { id: string; name: string; createdAt: number; fileCount: number; totalBytes: number; truncated: boolean }; error?: string }> {
    const res = await fetch('/api/checkpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationMode: 'agent', name }),
    });
    return res.json().catch(() => ({ success: false, error: 'Checkpoint creation failed.' }));
  }

  public async restoreCheckpoint(id: string): Promise<{ success: boolean; restored?: string[]; conflicts?: string[]; error?: string }> {
    const res = await fetch(`/api/checkpoints/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationMode: 'agent' }),
    });
    return res.json().catch(() => ({ success: false, error: 'Restore failed.' }));
  }

  public async removeCheckpoint(id: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/checkpoints/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationMode: 'agent' }),
    });
    return res.json().catch(() => ({ success: false, error: 'Remove failed.' }));
  }

  public async getCheckpointDiff(id: string, filePath: string): Promise<{ success: boolean; diff?: string; error?: string }> {
    const res = await fetch(`/api/checkpoints/${encodeURIComponent(id)}/diff?path=${encodeURIComponent(filePath)}`, { cache: 'no-store' });
    return res.json().catch(() => ({ success: false, error: 'Diff unavailable.' }));
  }

  public async getCheckpointDetail(id: string): Promise<{ success: boolean; checkpoint?: { id: string; name: string; createdAt: number; fileCount: number; totalBytes: number; truncated: boolean; files: Array<{ filePath: string; bytes: number; hash: string }> }; error?: string }> {
    const res = await fetch(`/api/checkpoints/${encodeURIComponent(id)}`, { cache: 'no-store' });
    return res.json().catch(() => ({ success: false, error: 'Checkpoint unavailable.' }));
  }

  /** M3.4: run the workspace check now (manual trigger from Build & Tests). */
  public async runAutoTestNow(): Promise<{ success: boolean; run?: { ok: boolean; exitCode: number | null; durationMs: number; triggeredBy: 'save' | 'manual'; filePath?: string; stdoutTail: string; stderrTail: string; timedOut: boolean }; skipped?: string; error?: string }> {
    const res = await fetch('/api/editor/auto-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runNow: true }),
    });
    return res.json().catch(() => ({ success: false, error: 'Auto-test run failed.' }));
  }

  public async getInlineCompletion(input: {
    filePath: string;
    language: string;
    prefix: string;
    suffix: string;
    model?: string;
    signal?: AbortSignal;
  }): Promise<{ success: boolean; completion?: string; error?: string }> {
    const res = await fetch('/api/editor/inline-completion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        filePath: input.filePath,
        language: input.language,
        prefix: input.prefix,
        suffix: input.suffix,
        ...(input.model ? { model: input.model } : {}),
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: result.error || 'Inline completion unavailable.' };
    return result;
  }
  private isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  // --- WORKSPACE ---
  /**
   * QUILLIX MISSION CONTROL: persisted deadline goal state.
   * Read-only: returns a normalized state, or null when unavailable.
   */
  public async getMissionState(): Promise<MissionState | null> {
    try {
      const res = await fetch('/api/mission/state', { cache: 'no-store' });
      if (!res.ok) return null;
      const result = await res.json().catch(() => ({}));
      if (!result?.success) return null;
      return parseMissionState(result.state);
    } catch {
      return null;
    }
  }

  /** M1.5: what the last project-index refresh actually re-read. */
  public async getRagStatus(): Promise<{ success: boolean; files?: number; chunks?: number; cachedFiles?: number; reindexedFiles?: number; durationMs?: number } | null> {
    try {
      const res = await fetch('/api/project/rag/status', { cache: 'no-store' });
      return await res.json();
    } catch {
      return null;
    }
  }

  /** M1.5: ask the server to drop one file's cached index chunks (or all). */
  public async invalidateRagIndex(filePath?: string): Promise<{ success: boolean; removed?: number } | null> {
    try {
      const res = await fetch('/api/project/rag/invalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filePath ? { filePath } : {}),
      });
      return await res.json();
    } catch {
      return null;
    }
  }

  /** M2.3: approvals currently blocking a running agent run. */
  public async listPendingApprovals(): Promise<Array<{ id: string; kind: 'terminal' | 'git' | 'file'; title: string; command?: string; reason?: string }>> {
    try {
      const res = await fetch('/api/agent/approvals', { cache: 'no-store' });
      const result = await res.json();
      return Array.isArray(result?.approvals) ? result.approvals : [];
    } catch {
      return [];
    }
  }

  /** M2.3: approve or reject many queued approvals at once (Approve all / Reject all). */
  public async batchResolveApprovals(approved: boolean, ids?: string[]): Promise<{ resolved: string[]; unresolved: string[] } | null> {
    try {
      const res = await fetch('/api/agent/approvals/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, ...(ids ? { ids } : {}) }),
      });
      const result = await res.json();
      return { resolved: Array.isArray(result?.resolved) ? result.resolved : [], unresolved: Array.isArray(result?.unresolved) ? result.unresolved : [] };
    } catch {
      return null;
    }
  }

  /** M1.4: answer "where is X defined?" from the live indexed workspace. */
  public async answerCodebaseQuestion(question: string): Promise<{
    kind: 'definition' | 'none';
    text: string;
    match?: { file: string; line: number; kind: string; symbol: string; snippet: string };
    matches: Array<{ file: string; line: number; kind: string; symbol: string; snippet: string }>;
    searchedFiles: number;
  } | null> {
    try {
      const res = await fetch(`/api/codebase/answer?question=${encodeURIComponent(String(question || ''))}`, { cache: 'no-store' });
      const result = await res.json();
      if (!result?.success) return null;
      return result;
    } catch {
      return null;
    }
  }

  // --- WORKSPACE ---
  public async getTree(depth = 5): Promise<{ success: boolean; tree: FileNode; root: string }> {
    if (this.isElectron) {
      return window.electronAPI.getTree(depth);
    }
    const res = await fetch(`/api/workspace/tree?depth=${depth}`);
    return res.json();
  }

  public async setRoot(targetPath: string): Promise<{ success: boolean; path: string; error?: string }> {
    if (this.isElectron) {
      const result = await window.electronAPI.setRoot(targetPath);
      if (result.success) this.setConversationModeContext(result.path || targetPath, 'chat');
      return result;
    }
    const res = await fetch('/api/workspace/set-root', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath }),
    });
    const result = await res.json();
    if (result.success) this.setConversationModeContext(result.path || targetPath, 'chat');
    return result;
  }

  /** Lightweight: current workspace root + recently used workspaces. */
  public async getWorkspaceRoot(): Promise<{
    success: boolean;
    path: string;
    recent: string[];
  }> {
    const res = await fetch('/api/workspace/root');
    return res.json();
  }

  public async readFile(filePath: string): Promise<{ success: boolean; content?: string; size?: number; error?: string }> {
    if (this.isElectron) {
      return window.electronAPI.readFile(filePath);
    }
    const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}`);
    return res.json();
  }

  /** M2.5: pass `expectedContent` to opt into optimistic concurrency; the server
   *  answers HTTP 409 with `conflict: true` when the file changed on disk. */
  public async writeFile(
    filePath: string,
    content: string,
    isNew = false,
    expectedContent?: string
  ): Promise<{ success: boolean; conflict?: boolean; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    if (this.isElectron) {
      return window.electronAPI.writeFile(filePath, content, isNew, expectedContent);
    }
    const res = await fetch('/api/workspace/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, content, isNew, conversationMode: this.conversationMode, ...(expectedContent === undefined ? {} : { expectedContent }) }),
    });
    return res.json();
  }

  public async deleteFile(filePath: string): Promise<{ success: boolean; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    if (this.isElectron) {
      return window.electronAPI.deleteFile(filePath);
    }
    const res = await fetch('/api/workspace/file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async renameFile(oldPath: string, newPath: string): Promise<{ success: boolean; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    if (this.isElectron) {
      return window.electronAPI.renameFile(oldPath, newPath);
    }
    const res = await fetch('/api/workspace/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async searchFiles(
    query: string,
    options: { caseSensitive?: boolean; wholeWord?: boolean; isRegex?: boolean } = {}
  ): Promise<{ success: boolean; matches: SearchMatch[]; error?: string }> {
    if (this.isElectron) {
      return window.electronAPI.searchFiles(query, options);
    }
    const params = new URLSearchParams({
      q: query,
      caseSensitive: String(!!options.caseSensitive),
      wholeWord: String(!!options.wholeWord),
      isRegex: String(!!options.isRegex),
    });
    const res = await fetch(`/api/workspace/search?${params.toString()}`);
    return res.json();
  }

  // --- PROJECT META ---
  public async getProjectMeta(): Promise<{ success: boolean; meta: ProjectMetadata }> {
    if (this.isElectron) {
      return window.electronAPI.getProjectMeta();
    }
    const res = await fetch('/api/project/meta');
    return res.json();
  }

  // --- SETTINGS ---
  public async getSettings(): Promise<{ success: boolean; settings?: QuillixSettings; error?: string }> {
    if (this.isElectron) {
      return window.electronAPI.getSettings();
    }
    const res = await fetch('/api/settings');
    return res.json();
  }

  /** Safe provider metadata for brain-aware UI and future packaged plugins. */
  public async getBrainCatalog(): Promise<BrainCatalogResponse> {
    const res = await fetch('/api/brains', { cache: 'no-store' });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.success) throw new Error(result.error || 'Brain catalog unavailable.');
    return result as BrainCatalogResponse;
  }

  public async updateSettings(
    patch: Partial<QuillixSettings>
  ): Promise<{ success: boolean; settings?: QuillixSettings; error?: string }> {
    if (this.isElectron) {
      return window.electronAPI.updateSettings(patch);
    }
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const result = await res.json().catch(() => ({}));
    if (res.status === 409) {
      try {
        const status = await this.getAgentStatus();
        const detail = status.busy
          ? status.stopping
            ? 'The server is stopping the active task; retry after it finishes.'
            : 'The server still has an active task; use Stop in the Agent panel before retrying.'
          : 'The server reports no active task; the renderer state was stale, so retry this settings change.';
        return { ...result, success: false, error: `${result.error || 'Settings change was rejected.'} ${detail}` };
      } catch {
        return { ...result, success: false, error: result.error || 'Settings change was rejected; check the Agent status and retry.' };
      }
    }
    return result;
  }

  // --- AGENT APPROVALS ---
  public async approveAgent(approvalId: string, approved: boolean): Promise<{ success: boolean }> {
    if (this.mutationBlockedReason()) return { success: false };
    const res = await fetch('/api/agent/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId, approved, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async rollbackTask(taskId: string): Promise<{ success: boolean; restored?: string[]; conflicts?: string[]; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  /** Persisted agent task journal for the active workspace (newest first). */
  public async getTasks(): Promise<TaskHistoryRecord[]> {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Task history could not be loaded.');
    return (data.tasks || []) as TaskHistoryRecord[];
  }

  public async stopAgent(): Promise<{ success: boolean; stopped?: boolean; error?: string }> {
    const res = await fetch('/api/agent/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return res.json();
  }

  public async getAgentStatus(): Promise<{ success: boolean; busy: boolean; stopping: boolean; startedAt: number | null; stopRequestedAt: number | null }> {
    const res = await fetch('/api/agent/status');
    return res.json();
  }

  public async getTokenEfficiency(limit = 20): Promise<{
    success: boolean;
    sampleSize: number;
    completedTasks: number;
    verifiedTasks: number;
    totalTokens: number;
    totalModelCalls: number;
    totalToolCalls: number;
    totalVerificationRuns: number;
    totalVerifiedFiles: number;
    averageTokensPerVerifiedFile: number | null;
    medianTokens: number | null;
    p95Tokens: number | null;
    medianDurationMs: number | null;
    p95DurationMs: number | null;
    passRatePercent: number;
    tasks: Array<Record<string, unknown>>;
  }> {
    const res = await fetch(`/api/metrics/token-efficiency?limit=${encodeURIComponent(String(limit))}`, { cache: 'no-store' });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.success) throw new Error(result.error || 'Token-efficiency telemetry unavailable.');
    return result;
  }

  // --- TAVILY (web search / verification) ---
  public async getTavilyUsage(): Promise<{ success: boolean; usage?: { searches: number; extracts: number; credits: number; estimatedCostUsd: number; verifications: number; updatedAt: string; daily?: { date: string; searches: number; extracts: number } }; error?: string }> {
    const res = await fetch('/api/verification/tavily/usage', { cache: 'no-store' });
    return res.json().catch(() => ({ success: false, error: 'Tavily usage unavailable.' }));
  }

  public async getTavilyBudget(): Promise<{ success: boolean; budget?: { date: string; searches: number; extracts: number; cap: number; remaining: number; allowed: boolean }; consent?: boolean; offlineMode?: boolean; error?: string }> {
    const res = await fetch('/api/verification/tavily/budget', { cache: 'no-store' });
    return res.json().catch(() => ({ success: false, error: 'Tavily budget unavailable.' }));
  }

  public async clearTavilyCaches(): Promise<{ success: boolean; budget?: { date: string; searches: number; extracts: number; cap: number; remaining: number; allowed: boolean }; error?: string }> {
    const res = await fetch('/api/verification/tavily/cache-clear', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    return res.json().catch(() => ({ success: false, error: 'Could not clear Tavily caches.' }));
  }

  /** M5.6 telemetry for the Performance dashboard. */
  public async getPromptCacheStats(): Promise<{ success: boolean; enabled?: boolean; cache?: { entries: number; hits: number; misses: number; evictions: number }; hitRate?: number; error?: string }> {
    const res = await fetch('/api/metrics/prompt-cache', { cache: 'no-store' });
    return res.json().catch(() => ({ success: false, error: 'Prompt-cache telemetry unavailable.' }));
  }

  /**
   * M-TAVILY-3: Deep Research over SSE. Events:
   *   { type: 'plan', queries } · { type: 'search', query, citations, cached }
   *   { type: 'budget', message } · { type: 'answer', chunk }
   *   { type: 'done', sources, queries, citations } · { error }
   */
  public async runResearch(
    prompt: string,
    onEvent: (event: Record<string, any>) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationMode: 'agent', prompt }),
      signal,
    });
    if (!response.body) throw new Error('Research stream unavailable.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 2);
        if (raw.startsWith('data:')) {
          try { onEvent(JSON.parse(raw.slice(5).trim())); } catch { /* ignore a malformed keep-alive frame */ }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
  }

  // --- TERMINAL ---
  /**
   * Opens the native OS folder picker (desktop app only).
   * Returns the selected absolute path, or null when cancelled / running in
   * a plain browser.
   */
  public async selectNativeFolder(): Promise<string | null> {
    if (typeof window !== 'undefined' && window.quillixDesktop) {
      // Preserve real picker failures for the calling screen to explain. A
      // user cancellation is already represented by the bridge as `null`.
      return await window.quillixDesktop.selectFolder();
    }
    return null;
  }

  /** True when running inside the NUVRO AI desktop app. */
  public isDesktopApp(): boolean {
    return typeof window !== 'undefined' && !!window.quillixDesktop;
  }

  /** Creates a new project folder under the given parent and makes it the workspace. */
  public async createProject(
    parentPath: string,
    projectName: string
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    const res = await fetch('/api/workspace/create-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath, projectName, conversationMode: this.conversationMode }),
    });
    const result = await res.json();
    if (result.success && result.path) this.setConversationModeContext(result.path, 'chat');
    return result;
  }

  /** Recent commands executed by the agent and the user (newest last). */
  public async getTerminalHistory(
    limit = 50
  ): Promise<{ success: boolean; history: TerminalHistoryEntry[] }> {
    const res = await fetch(`/api/terminal/history?limit=${limit}`);
    return res.json();
  }

  /**
   * Part 3: recent terminal self-healing attempts (what was repaired
   * automatically, what was skipped and why).
   */
  public async getSelfHealHistory(limit = 20): Promise<SelfHealEntry[]> {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit) || 20));
    const res = await fetch(`/api/agent/self-heal/history?limit=${bounded}`, { cache: 'no-store' });
    const result = await res.json();
    if (!res.ok || !result?.success) throw new Error(result?.error || 'Self-heal history unavailable');
    return Array.isArray(result.entries) ? (result.entries as SelfHealEntry[]) : [];
  }

  public async runCommand(
    command: string,
    cwd?: string,
    shell?: string,
    approved?: boolean
  ): Promise<{
    success: boolean;
    result?: CommandExecutionResult;
    needsApproval?: boolean;
    risk?: string;
    reason?: string;
    error?: string;
  }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    if (this.isElectron) {
      return window.electronAPI.runCommand(command, cwd, shell);
    }
    const res = await fetch('/api/terminal/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, cwd, shell, approved, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async checkRisk(command: string): Promise<{ success: boolean; risk: 'SAFE' | 'REVIEW' | 'DANGEROUS'; reason?: string }> {
    if (this.isElectron) {
      return window.electronAPI.checkRisk(command);
    }
    const res = await fetch('/api/terminal/check-risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    return res.json();
  }

  // --- GIT ---
  public async getGitStatus(): Promise<{ success: boolean; status: any }> {
    if (this.isElectron) {
      return window.electronAPI.getGitStatus();
    }
    const res = await fetch('/api/git/status');
    return res.json();
  }

  public async getGitDiff(staged = false): Promise<{ success: boolean; diff: string }> {
    if (this.isElectron) {
      return window.electronAPI.getGitDiff(staged);
    }
    const res = await fetch(`/api/git/diff?staged=${staged}`);
    return res.json();
  }

  public async getGitLog(limit = 10): Promise<{ success: boolean; log: any[] }> {
    if (this.isElectron) {
      return window.electronAPI.getGitLog(limit);
    }
    const res = await fetch(`/api/git/log?limit=${limit}`);
    return res.json();
  }

  /** M1.6: search across git history (commits whose diffs contain the term). */
  public async searchGitHistory(query: string, limit = 30): Promise<{
    success: boolean;
    isGit: boolean;
    query: string;
    commits: Array<{ hash: string; author: string; date: string; subject: string; files: string[] }>;
    error?: string;
  }> {
    const res = await fetch(`/api/git/history-search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return res.json();
  }

  public async gitStage(filePath = '.'): Promise<{ success: boolean; output: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, output: blocked };
    if (this.isElectron) {
      return window.electronAPI.gitStage(filePath);
    }
    const res = await fetch('/api/git/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async gitCommit(
    message: string,
    authorized?: boolean
  ): Promise<{ success: boolean; output?: string; needsAuthorization?: boolean; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    if (this.isElectron) {
      return window.electronAPI.gitCommit(message);
    }
    const res = await fetch('/api/git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, authorized, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async gitRestore(
    filePath: string,
    authorized?: boolean
  ): Promise<{ success: boolean; output?: string; needsAuthorization?: boolean; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    if (this.isElectron) {
      return window.electronAPI.gitRestore(filePath);
    }
    const res = await fetch('/api/git/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, authorized, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  // --- GIT: task branches (one agent task = one branch, Cursor-style) ---
  // These always go over HTTP: the desktop app serves the same local server,
  // so both dev and packaged builds hit the same endpoints.
  public async getGitBranches(): Promise<{
    success: boolean;
    branches: Array<{ name: string; current: boolean }>;
    current: string;
    taskBranch: { branch: string; base: string; createdAt: number; title?: string } | null;
    error?: string;
  }> {
    const res = await fetch('/api/git/branches');
    return res.json();
  }

  public async gitCreateBranch(name: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    const res = await fetch('/api/git/branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async gitCheckout(name: string): Promise<{ success: boolean; output?: string; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    const res = await fetch('/api/git/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async gitTaskBranch(title?: string): Promise<{
    success: boolean;
    branch?: string;
    base?: string;
    existing?: boolean;
    skipped?: boolean;
    error?: string;
  }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    const res = await fetch('/api/git/task-branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: String(title || '').slice(0, 200), conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async gitFinishTask(
    message?: string,
    authorized?: boolean
  ): Promise<{ success: boolean; branch?: string; base?: string; output?: string; conflict?: boolean; needsAuthorization?: boolean; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    const res = await fetch('/api/git/finish-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, authorized, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async gitDiscardTask(authorized?: boolean): Promise<{ success: boolean; branch?: string; base?: string; output?: string; needsAuthorization?: boolean; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    const res = await fetch('/api/git/discard-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorized, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  // --- OLLAMA ---
  public async getOllamaStatus(model?: string, signal?: AbortSignal): Promise<{ success: boolean; status?: any; error?: string }> {
    if (this.isElectron) {
      return window.electronAPI.getOllamaStatus(model);
    }
    const query = model ? `?model=${encodeURIComponent(model)}` : '';
    const res = await fetch(`/api/ollama/status${query}`, { signal, cache: 'no-store' });
    return res.json();
  }

  // --- DIAGNOSTICS ---
  public async getHealth(): Promise<{ success: boolean; items: SystemHealthItem[] }> {
    if (this.isElectron) {
      return window.electronAPI.getHealth();
    }
    const res = await fetch('/api/diagnostics/health');
    return res.json();
  }

  /**
   * M7.5: compact provider health/throughput summary for the Studio monitor.
   * Purely observational — reading it never changes request pacing, retries,
   * quota handling, or billing. The summary is undefined when the active
   * provider does not publish diagnostics (for example a plain local model).
   */
  public async getProviderHealth(): Promise<{ success: boolean; health?: ProviderHealthSummary }> {
    try {
      const res = await fetch('/api/providers/diagnostics', { cache: 'no-store' });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.success) return { success: false };
      const health = result?.providerDiagnostics?.health;
      return {
        success: true,
        health: health && typeof health === 'object' ? (health as ProviderHealthSummary) : undefined,
      };
    } catch {
      return { success: false };
    }
  }

  // --- TOOLS ---
  public async getCodingPlugins(): Promise<{ success: boolean; plugins: import('../shared/codingPlugins.js').CodingPlugin[] }> {
    return (await fetch('/api/extensions/catalog')).json();
  }

  public async setCodingPlugin(id: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    return (await fetch(`/api/extensions/coding/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, conversationMode: this.conversationMode }),
    })).json();
  }

  public async getToolList(): Promise<{ success: boolean; tools: ToolDefinition[] }> {
    if (this.isElectron) {
      return window.electronAPI.getToolList();
    }
    const res = await fetch('/api/tools/list');
    return res.json();
  }

  public async executeTool(
    name: string,
    args: any,
    approved?: boolean
  ): Promise<ToolResult & { needsApproval?: boolean }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { toolCallId: `blocked_${Date.now()}`, toolName: name, success: false, output: '', error: blocked };
    if (this.isElectron) {
      return window.electronAPI.executeTool(name, args);
    }
    const res = await fetch('/api/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args, approved, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async stopTerminalCommand(): Promise<{ success: boolean; stopped?: number }> {
    const res = await fetch('/api/terminal/stop', { method: 'POST' });
    return res.json();
  }

  // --- PROJECT SYSTEM (language runners / RUN / preview / memory) ---

  public async detectProject(root?: string): Promise<{
    success: boolean;
    root?: string;
    profile?: ProjectProfile;
    error?: string;
  }> {
    const qs = root ? `?root=${encodeURIComponent(root)}` : '';
    const res = await fetch(`/api/project/detect${qs}`);
    return res.json();
  }

  public async runProject(root?: string): Promise<{
    success: boolean;
    run?: ProjectRunInfo;
    previewOnly?: boolean;
    previewEntry?: string;
    profile?: ProjectProfile;
    root?: string;
    error?: string;
  }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    const res = await fetch('/api/project/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async getProjectRunStatus(idOrRoot?: string): Promise<{
    success: boolean;
    run?: ProjectRunInfo | null;
  }> {
    if (!idOrRoot) return { success: true, run: null };
    const isId = idOrRoot.startsWith('run_');
    const qs = isId
      ? `?id=${encodeURIComponent(idOrRoot)}`
      : `?root=${encodeURIComponent(idOrRoot)}`;
    const res = await fetch(`/api/project/run/status${qs}`);
    return res.json();
  }

  public async stopProjectRun(id: string): Promise<{ success: boolean; stopped?: boolean }> {
    const res = await fetch('/api/project/run/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    return res.json();
  }

  public async getProjectMemory(): Promise<{ success: boolean; memory?: ProjectMemorySnapshot }> {
    const res = await fetch('/api/project/memory');
    return res.json();
  }

  public async openProject(root: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch('/api/project/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root }),
    });
    return res.json();
  }

  /** URL for the built-in preview iframe (served by the NUVRO AI server). */
  public previewUrl(root: string, entry: string): string {
    const rel = root ? `${root}/${entry}` : entry;
    return `/preview/${rel.split('/').map(encodeURIComponent).join('/')}`;
  }

  public async startPreview(root: string, entry: string): Promise<{
    success: boolean;
    session?: { id: string; status: 'starting' | 'ready' | 'stopped' | 'failed'; error?: string };
    origin?: string;
    previewPath?: string;
    error?: string;
    issues?: Array<{ filePath: string; check: string; error: string }>;
  }> {
    const blocked = this.mutationBlockedReason();
    if (blocked) return { success: false, error: blocked };
    const res = await fetch('/api/preview/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, entry, conversationMode: this.conversationMode }),
    });
    return res.json();
  }

  public async getPreviewStatus(id: string): Promise<{
    success: boolean;
    session?: { id: string; status: 'starting' | 'ready' | 'stopped' | 'failed'; error?: string } | null;
    error?: string;
  }> {
    const res = await fetch(`/api/preview/status?id=${encodeURIComponent(id)}`);
    return res.json();
  }

  public async stopPreview(id: string): Promise<{ success: boolean; stopped?: boolean; error?: string }> {
    const res = await fetch('/api/preview/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    return res.json();
  }
}

export const api = new ApiBridge();
