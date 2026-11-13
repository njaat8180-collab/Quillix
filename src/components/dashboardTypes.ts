import type { AgentActivity, ProjectMetadata, QuillixSettings } from '../shared/types.js';
import type { OllamaState } from './TopHeader.js';
import type { QuickAction } from './Dashboard.js';

/** Shared data contract for the active Atlas dashboard. */
export interface DashboardViewProps {
  ollama: OllamaState;
  model?: string;
  provider?: string;
  sarvamKeyConfigured?: boolean;
  sarvamConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  universalConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  openaiConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  grokConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  groqConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  nvidiaConnection?: 'untested' | 'checking' | 'connected' | 'failed';
  offlineMode?: boolean;
  workspaceRoot: string;
  recentWorkspaces: string[];
  recentActivities: AgentActivity[];
  projectMeta: ProjectMetadata | null;
  onQuickAction: (action: QuickAction) => void;
  onOpenWorkspace: () => void;
  onCreateProject: () => void;
  onOpenChat: () => void;
  onSelectRecentWorkspace: (path: string) => void;
  onOpenSettings: () => void;
  settings: QuillixSettings | null;
  onSettingsChanged: (next: QuillixSettings) => void;
  onToggleTurboSpeed?: (next: boolean) => void;
  onConnectionChange: (provider: string, status: 'untested' | 'checking' | 'connected' | 'failed') => void;
  onRefreshOllama: () => Promise<void> | void;
}
