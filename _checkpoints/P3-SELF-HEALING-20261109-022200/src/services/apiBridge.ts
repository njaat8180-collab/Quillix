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

  public async writeFile(filePath: string, content: string, isNew = false, expectedContent?: string): Promise<{ success: boolean; error?: string }> {
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

  /** True when running inside the Quillix desktop app. */
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

  /** URL for the built-in preview iframe (served by the Quillix server). */
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
