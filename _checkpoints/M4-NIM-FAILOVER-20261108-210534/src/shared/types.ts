export type AgentMode =
  | 'ask'
  | 'edit'
  | 'agent'
  | 'debug'
  | 'review'
  | 'plan'
  | 'terminal'
  | 'analyze';

export type PermissionLevel =
  | 'read'
  | 'write'
  | 'execute'
  | 'network'
  | 'git'
  | 'destructive';

export type CommandRisk = 'SAFE' | 'REVIEW' | 'DANGEROUS';

export interface ToolDefinition {
  name: string;
  category: 'file' | 'code' | 'patch' | 'terminal' | 'build' | 'git' | 'project';
  description: string;
  permission: PermissionLevel;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  providerMetadata?: {protocol:string;blocks:any[]};
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  output: string;
  error?: string;
  data?: any;
  durationMs?: number;
  /** True when a change was staged as a patch instead of written (Auto Apply Diffs off) */
  staged?: boolean;
  /** True when execution was blocked and requires explicit user approval */
  needsApproval?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  mode?: AgentMode;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  plan?: PlanStep[];
  /** Actual request-adaptive workflow phases for this run. */
  phases?: AgentPhase[];
  patches?: FilePatch[];
  activityLog?: AgentActivity[];
  error?: string;
  /** Backend acceptance result; true only after the final verified gate. */
  verified?: boolean;
  /** This agent task ended incomplete and can continue from its saved checkpoint. */
  resumable?: boolean;
  taskId?: string;
  observability?: AgentObservability;
  rollback?: { available: boolean; files: number; restoredAt?: number; conflicts?: string[] };
}

/** User-visible evidence for one brain/body execution. */
export interface AgentObservability {
  provider?: string;
  model?: string;
  capabilities?: { tools: boolean; streaming: boolean; reasoning: boolean };
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  toolCalls: number;
  toolFailures: number;
  verificationRuns: number;
  retryCount?: number;
  /** Provider-independent request sizing; estimated at roughly four chars/token. */
  modelCalls?: number;
  inputChars?: number;
  outputChars?: number;
  toolResultChars?: number;
  contextCharsPeak?: number;
  /** Serialized raw conversation chars and provider message-array chars, excluding system/tool schemas. */
  rawConversationChars?: number;
  sentMessageChars?: number;
  /** Character reduction vs. raw conversation; may be negative when focused context adds more text. */
  messageHistoryReductionPercent?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedTotalTokens?: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  actualTotalTokens?: number;
  tokenCountSource?: 'estimate' | 'provider' | 'mixed';
  byTool?: Record<string, { calls: number; failures: number; totalDurationMs: number }>;
}

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  tool?: string;
}

/** One phase of the request-adaptive agent workflow. Status changes only when
 *  the real work behind the phase actually happened. */
export interface AgentPhase {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  detail?: string;
}

export interface FilePatch {
  filePath: string;
  changeType: 'created' | 'modified' | 'deleted' | 'renamed';
  oldContent?: string;
  newContent?: string;
  diff: string;
  linesAdded: number;
  linesRemoved: number;
  applied?: boolean;
  rejected?: boolean;
}

export interface FileNode {
  name: string;
  path: string; // relative to workspace root
  fullPath: string;
  isDirectory: boolean;
  size?: number;
  children?: FileNode[];
  gitStatus?: 'unmodified' | 'modified' | 'staged' | 'untracked' | 'deleted';
}

export interface SearchMatch {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export interface ProjectMetadata {
  workspacePath: string;
  name: string;
  languages: string[];
  framework: string;
  runtime: string;
  packageManager: string;
  entryPoints: string[];
  configFiles: string[];
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  isGitRepo: boolean;
  gitBranch?: string;
  gitModifiedCount?: number;
  importantDirs: string[];
}

export interface TerminalSession {
  id: string;
  title: string;
  shell: string;
  cwd: string;
  isActive: boolean;
  history: string[];
}

export interface CommandExecutionResult {
  command: string;
  cwd: string;
  risk: CommandRisk;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface AgentActivity {
  id: string;
  timestamp: number;
  type:
    | 'thinking'
    | 'reading_file'
    | 'searching_code'
    | 'planning'
    | 'calling_tool'
    | 'editing_file'
    | 'running_command'
    | 'running_tests'
    | 'analyzing_error'
    | 'applying_patch'
    | 'verifying'
    | 'completed'
    | 'error';
  message: string;
  details?: string;
}

export interface SystemHealthItem {
  id: string;
  name: string;
  category: 'runtime' | 'tool' | 'service';
  status: 'available' | 'missing' | 'warning';
  version?: string;
  details: string;
}

export type QuillixTheme = 'light' | 'dark' | 'gray' | 'gradient';

/** Global animation intensity for the UI. `full` keeps the designed motion,
 *  `minimal` keeps short fades only (no transforms/springs/ambient loops),
 *  `off` disables animation everywhere. */
export type QuillixAnimationLevel = 'off' | 'minimal' | 'full';

/**
 * Runtime settings shared between the Quillix UI, the AgentEngine and the
 * Ollama provider. Persisted by the server (~/.quillix/settings.json).
 */
export interface QuillixSettings {
  /** Ollama model used for every AI request (default: qwen2.5-coder:3b). */
  model: string;
  /** Built-in provider ID or a validated dynamically registered brain ID. */
  aiProvider?: string;
  /** Exact OpenAI model ID; independent from the Universal API model. */
  openaiModel?: string;
  openaiKeyConfigured?: boolean;
  grokModel?: string;
  grokKeyConfigured?: boolean;
  groqModel?: string;
  groqKeyConfigured?: boolean;
  nvidiaModel?: string;
  /** Ordered NVIDIA model ids used for automatic failover (most preferred first). */
  nvidiaModelPriority?: string[];
  nvidiaKeyConfigured?: boolean;
  universalProtocol?: 'openai' | 'responses' | 'anthropic' | 'gemini';
  universalEndpoint?: string;
  universalModel?: string;
  universalPreset?: import('./providerPresets.js').ProviderPresetId;
  universalKeyConfigured?: boolean;
  /** Number of encrypted alternate keys available for optional failover. */
  universalKeyPoolCount?: number;
  openaiKeyPoolCount?: number;
  groqKeyPoolCount?: number;
  grokKeyPoolCount?: number;
  nvidiaKeyPoolCount?: number;
  sarvamKeyPoolCount?: number;
  /** True when a Tavily key is available in Windows secure storage or env. */
  tavilyKeyConfigured?: boolean;
  providerProfiles?: import('../server/providerProfiles.js').ProviderProfile[];
  activeProviderProfile?: string;
  sarvamKeyConfigured?: boolean;
  /** Base URL of the local Ollama service. */
  ollamaBaseUrl: string;
  /** When ON, AI requests may only target loopback addresses. Default ON. */
  offlineMode: boolean;
  /** Maximum autonomous tool-execution iterations per user prompt (1-50). */
  maxAutonomousTurns: number;
  /** Sampling temperature passed to Ollama (0-2). */
  temperature: number;
  /** When ON, dangerous terminal commands require explicit user approval. */
  terminalApproval: boolean;
  /** When ON, agent file edits are applied immediately. When OFF they are
   *  staged as patches and require user confirmation. */
  autoApplyDiffs: boolean;
  /** When ON, git commit/restore require explicit authorization. */
  gitApproval: boolean;
  /** Bundled coding packs disabled by the user. No downloaded code is loaded here. */
  disabledCodingPlugins?: string[];
  /** UI theme. */
  theme: QuillixTheme;
  /** Global animation intensity for the UI (full | minimal | off). */
  animationLevel: QuillixAnimationLevel;
  /** Last user-selected workspace root (persisted across restarts). */
  workspaceRoot?: string;
  /** Most recently used workspace folders, newest first (max 6). */
  recentWorkspaces?: string[];
  /** Turbo Speed Mode: reduces artificial delays and enables adaptive pacing while respecting provider limits. */
  turboSpeedMode?: boolean;
  /** Performance mode profile for request pacing and defaults. */
  performanceMode?: 'eco' | 'balanced' | 'turbo';
  /** Request pacing mode selection. */
  requestPacingMode?: 'adaptive' | 'fixed';
  /** Schema version of the persisted settings record (added in M9.1; optional for backward compatibility with legacy files). */
  version?: number;
}

/** Compact, decision-ready health/throughput view derived from provider
 * diagnostics. Consumed by the Studio performance monitor (M7.5) and the
 * coding/Turbo benchmarks (phases 13/17). Purely observational — it never
 * bypasses quota or billing and never changes request behavior. */
export interface ProviderHealthSummary {
  requests: number;
  successes: number;
  failures: number;
  successRate: number;
  rateLimited: boolean;
  authError: boolean;
  billing: boolean;
  averageLatencyMs: number;
  averageFirstTokenMs: number;
  tokensPerSecond: number;
  effectiveIntervalMs: number;
  queueDepth: number;
  recommendedWaitMs: number;
  availability: 'ok' | 'throttled' | 'auth' | 'billing' | 'cooldown' | 'circuit-open' | 'degraded' | 'unknown';
}

export interface TerminalHistoryEntry {
  id: string;
  command: string;
  cwd: string;
  exitCode: number;
  durationMs: number;
  source: 'user' | 'agent';
  timestamp: number;
}

export interface PermissionRequest {
  id: string;
  type: PermissionLevel;
  title: string;
  description: string;
  command?: string;
  filePath?: string;
  risk: CommandRisk;
  onApprove: () => void;
  onReject: () => void;
}

// ============================================================================
// LANGUAGE RUNNER SYSTEM — per-language execution adapters
// ============================================================================

/** A detected/derived execution profile for a project or folder. */
export interface ProjectProfile {
  /** Adapter id, e.g. 'python', 'node', 'static-web'. */
  language: string;
  /** Human-readable language name, e.g. 'Python 3', 'C++'. */
  languageLabel: string;
  /** e.g. 'script', 'web-static', 'node-app', 'compiled'. */
  projectType: string;
  /** File to execute / open first (relative to project root). */
  entryPoint?: string;
  /** e.g. 'npm', 'pnpm', 'yarn', 'pip', 'cargo', 'gradle'. */
  packageManager?: string;
  /** Declared/known dependencies (name -> version or ''). */
  dependencies: Record<string, string>;
  /** Install command (shell string) or undefined when none needed. */
  installCommand?: string;
  /** Build/compile command when the language needs a build step. */
  buildCommand?: string;
  /** The command that actually runs the project. */
  runCommand: string;
  /** Test command when the project has a test setup. */
  testCommand?: string;
  /** True when the project can be previewed in the built-in browser panel. */
  previewable: boolean;
  /** File to open in the built-in preview (relative to project root). */
  previewEntry?: string;
  /** How the profile was derived (shown in UI / logs). */
  detectionNotes: string[];
  /** True when the required runtime exists on this machine. */
  runtimeAvailable?: boolean;
  /** Which runtime binary is used (e.g. 'python', 'node', 'g++'). */
  runtimeBinary?: string;
}

/** Live status of a project run started through the RUN button. */
export interface ProjectRunInfo {
  id: string;
  /** Absolute project root. */
  root: string;
  command: string;
  status: 'running' | 'exited' | 'failed' | 'stopped';
  exitCode?: number;
  /** Combined stdout+stderr captured so far (tail-capped). */
  output: string;
  startedAt: number;
  endedAt?: number;
}

// ============================================================================
// PROJECT MEMORY — persistent context across conversations
// ============================================================================

export interface ProjectErrorRecord {
  timestamp: number;
  /** Short error description. */
  error: string;
  /** Which file it was fixed in, when known. */
  fixedIn?: string;
  resolved: boolean;
}

export interface ProjectTaskMemory {
  timestamp: number;
  summary: string;
  status: 'completed' | 'failed' | 'cancelled';
  files: string[];
}

export interface ProjectMemoryRecord {
  name: string;
  /** Absolute project root. */
  root: string;
  language?: string;
  framework?: string;
  entryPoint?: string;
  dependencies?: string[];
  runCommand?: string;
  testStatus?: 'passed' | 'failed' | 'untested';
  /** Files known to belong to this project (relative paths). */
  files: string[];
  errors: ProjectErrorRecord[];
  /** Compact continuation envelope; raw prompts and model output are not stored. */
  recentTasks?: ProjectTaskMemory[];
  createdAt: number;
  lastActivityAt: number;
}

export interface ProjectMemorySnapshot {
  workspaceRoot: string;
  activeProject?: string;
  projects: ProjectMemoryRecord[];
}

// ============================================================================
// PROJECT REPORT — real filesystem state after an agent run
// ============================================================================

export interface ProjectReportFile {
  /** Path relative to the workspace root. */
  relativePath: string;
  /** Verified absolute path on disk. */
  absolutePath: string;
  changeType: 'created' | 'modified' | 'deleted' | 'renamed';
  /** Verified to exist on disk at report time (created/modified only). */
  exists: boolean;
  sizeBytes?: number;
}

export interface ProjectReport {
  projectName: string;
  /** Absolute project root (verified on disk). */
  projectRoot: string;
  files: ProjectReportFile[];
  /** Rendered text file tree of the project folder. */
  fileTree: string;
  profile?: ProjectProfile;
  verification: {
    syntaxChecked: boolean;
    executed: boolean;
    exitCode?: number;
    /** Summary line, e.g. 'All files passed node --check'. */
    summary: string;
    issues?: string[];
  };
  /** Real commands executed during the run, with their true exit codes (§20). */
  commandsExecuted?: Array<{ command: string; cwd: string; exitCode: number; durationMs: number }>;
  /** Files deleted during the run (§20). */
  deletedFiles?: string[];
}
