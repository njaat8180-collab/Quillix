import React from 'react';
import { Bug, Hammer, SearchCheck, TestTube2, Wrench, Sparkles, FolderGit2 } from 'lucide-react';
import { ProjectMetadata } from '../shared/types.js';

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  prompt: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'fix-bug',
    label: 'Fix a bug',
    description: 'Describe the bug and QUILLIX will locate and fix it',
    icon: <Bug size={18} />,
    prompt: 'Help me fix a bug. I will describe it in my next message.',
  },
  {
    id: 'build-something',
    label: 'Build something',
    description: 'Describe a feature, component, or script to create',
    icon: <Hammer size={18} />,
    prompt: 'Help me build something new. I will describe what I need in my next message.',
  },
  {
    id: 'analyze-project',
    label: 'Analyze project',
    description: 'Inspect the codebase, structure, and dependencies',
    icon: <SearchCheck size={18} />,
    prompt: 'Analyze this project and give me an overview of its structure, stack, and health.',
  },
  {
    id: 'run-tests',
    label: 'Run tests',
    description: 'Run the test suite and summarize results',
    icon: <TestTube2 size={18} />,
    prompt: 'Run the project tests and summarize the results. Fix any failures you find.',
  },
  {
    id: 'fix-errors',
    label: 'Fix errors',
    description: 'Find and repair build or type errors',
    icon: <Wrench size={18} />,
    prompt: 'Run the build and type checks, then fix any errors you find.',
  },
  {
    id: 'refactor-code',
    label: 'Refactor code',
    description: 'Improve readability and structure safely',
    icon: <Sparkles size={18} />,
    prompt: 'Help me refactor code for readability and performance. I will point at the target next.',
  },
];

interface DashboardProps {
  projectMeta: ProjectMetadata | null;
  onQuickAction: (action: QuickAction) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ projectMeta, onQuickAction }) => {
  const fileCount =
    projectMeta && typeof (projectMeta as any).fileCount === 'number' ? (projectMeta as any).fileCount : null;

  return (
    <div className="q-gradient-hero flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 pt-14 pb-8">
        {/* Hero */}
        <div className="text-center mb-8">
          <div
            className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, var(--accent), var(--accent-secondary))` }}
            aria-hidden="true"
          >
            <Sparkles size={26} />
          </div>
          <h1 className="text-3xl font-bold text-[var(--text)] mb-1.5">Build with QUILLIX</h1>
          <p className="text-[15px] text-[var(--text-muted)]">Your local AI coding agent.</p>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              onClick={() => onQuickAction(action)}
              className="q-gradient-surface q-transition text-left p-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] hover:shadow-md group"
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 q-transition group-hover:scale-105"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                aria-hidden="true"
              >
                {action.icon}
              </div>
              <div className="text-sm font-semibold text-[var(--text)] mb-0.5">{action.label}</div>
              <div className="text-[11px] leading-snug text-[var(--text-muted)]">{action.description}</div>
            </button>
          ))}
        </div>

        {/* Compact project card */}
        {projectMeta && (
          <div className="q-gradient-surface rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 flex items-center gap-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              aria-hidden="true"
            >
              <FolderGit2 size={19} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Project</div>
              <div className="text-sm font-semibold text-[var(--text)] truncate">{projectMeta.name}</div>
              <div className="text-[11px] text-[var(--text-muted)] truncate">
                {[projectMeta.framework, projectMeta.languages.slice(0, 3).join(' • ')]
                  .filter(Boolean)
                  .join(' • ')}
                {fileCount !== null ? ` • ${fileCount} files` : ''}
              </div>
            </div>
            {projectMeta.isGitRepo && (
              <span className="ml-auto text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] text-[var(--text-muted)] shrink-0">
                {projectMeta.gitBranch || 'main'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
