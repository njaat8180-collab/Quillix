import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '../..');
const panel = fs.readFileSync(path.join(project, 'src/components/ChatPanel.tsx'), 'utf8');
const chatView = fs.readFileSync(path.join(project, 'src/components/ChatView.tsx'), 'utf8');
const composer = fs.readFileSync(path.join(project, 'src/components/Composer.tsx'), 'utf8');
const app = fs.readFileSync(path.join(project, 'src/App.tsx'), 'utf8');
const modeStorage = fs.readFileSync(path.join(project, 'src/shared/conversationModeStorage.ts'), 'utf8');
const server = fs.readFileSync(path.join(project, 'server.ts'), 'utf8');
const intentRouter = fs.readFileSync(path.join(project, 'src/server/intentRouter.ts'), 'utf8');
const css = fs.readFileSync(path.join(project, 'src/index.css'), 'utf8');
const atlas = fs.readFileSync(path.join(project, 'src/atlas.css'), 'utf8');
const productionCss = fs.readFileSync(path.join(project, 'src/production-ui.css'), 'utf8');
const workspace = fs.readFileSync(path.join(project, 'src/components/WorkspaceView.tsx'), 'utf8');
const studioEditor = fs.readFileSync(path.join(project, 'src/components/EditorArea.tsx'), 'utf8');
const terminal = fs.readFileSync(path.join(project, 'src/components/TerminalPanel.tsx'), 'utf8');
const fileTree = fs.readFileSync(path.join(project, 'src/components/FileTree.tsx'), 'utf8');
const gitPanel = fs.readFileSync(path.join(project, 'src/components/GitPanel.tsx'), 'utf8');
const toolsPanel = fs.readFileSync(path.join(project, 'src/components/ToolRegistryPanel.tsx'), 'utf8');
const runner = fs.readFileSync(path.join(project, 'src/components/ProjectRunner.tsx'), 'utf8');
const main = fs.readFileSync(path.join(project, 'src/main.tsx'), 'utf8');
const workbench = fs.readFileSync(path.join(project, 'src/components/WorkbenchLayout.tsx'), 'utf8');

const checks = [
  ['command palette stacks search, results and hints vertically', /\.q-palette\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s],
  ['command palette search keeps a visible keyboard focus indicator', /\.q-palette-input input:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/],
  ['command palette dialog exposes modal semantics and a named search field', /role="dialog" aria-modal="true" aria-label="Command palette"[\s\S]*aria-label="Search commands"/],
  ['dashboard, chat and tools views constrain their scrollable content to the viewport', /key="dashboard" \{\.\.\.motionPage\} className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden"[\s\S]*key="chat" \{\.\.\.motionPage\} className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden"[\s\S]*key="action" \{\.\.\.motionPage\} className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden"/],
  ['studio editor host is a height-constrained flex column so Monaco gets a real viewport', /\.q-workbench-editor \{ display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: hidden; \}/],
  ['workspace editor ancestors allow flex children to shrink and keep Monaco visible', /q-editor-workspace flex-1 flex min-h-0 min-w-0 overflow-hidden[\s\S]*flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden[\s\S]*flex-1 min-h-0 flex flex-col overflow-hidden/],
  ['short Studio viewports compact the empty editor without clipping its key actions', /@media\(max-height:760px\)[\s\S]*\.q-editor-emblem \{ display:none; \}[\s\S]*\.q-editor-shortcuts \{ gap:4px; \}/],
  ['short Chat viewports compact the welcome panel above the composer', /@media\(max-height:760px\)[\s\S]*\.q-agent-welcome \{ padding-top:12px; padding-bottom:8px; \}[\s\S]*\.q-agent-suggestions>button \{ padding-top:8px; padding-bottom:8px; \}/],
  ['Monaco wrapper is shrinkable and keeps its own content inside the editor viewport', /flex-1 min-h-0 min-w-0 flex flex-col bg-\[var\(--bg\)\] overflow-hidden relative[\s\S]*flex-1 min-h-0 min-w-0 h-full w-full overflow-hidden[\s\S]*height="100%"/],
  ['file read failures are shown in the editor area with a retry action', /if \(res\.success\)[\s\S]*setFileOpenError\(\{ path: filePath, message \}\)[\s\S]*!activeTab && fileOpenError \?[\s\S]*role="alert"[\s\S]*Retry opening file/],
  ['Chat panel passes the welcome screen into ChatView', /<ChatView[\s\S]*?emptyState=\{emptyState\}/],
  ['conversation log is a focusable scroll region containing the welcome screen', /className="flex-1 min-h-0 overflow-y-auto" role="log"[^>]*tabIndex=\{0\}[\s\S]*\{emptyState\}/],
  ['empty chat does not auto-scroll its welcome screen out of view', /if \(!messages\.length && !activities\.length && !streamingText\) return;[\s\S]*scrollIntoView/],
  ['workspace picker errors are shown to the user and selected path is applied', /handleOpenWorkspace[\s\S]*api\.selectNativeFolder\(\)[\s\S]*if \(!res\.success\) throw new Error[\s\S]*setWorkspaceRoot\(selectedRoot\)[\s\S]*window\.alert\(`Could not open workspace:/],
  ['recent workspace selection applies the selected path and reports failures', /handleSelectRecentWorkspace[\s\S]*api\.setRoot\(folder\)[\s\S]*if \(!res\.success\) throw new Error[\s\S]*setWorkspaceRoot\(selectedRoot\)[\s\S]*window\.alert\(`Could not switch workspace:/],
  ['workspace view catches folder-picker failures and releases its busy state', /const handleOpenFolder = async \(\) => \{[\s\S]*try \{[\s\S]*api\.selectNativeFolder\(\)[\s\S]*catch \(error\)[\s\S]*setWorkspaceError[\s\S]*finally \{[\s\S]*setWorkspaceBusy\(false\)/],
  ['workspace switching is disabled while the agent is changing the active project', /agentBusy\?: boolean[\s\S]*if \(agentBusy\) \{[\s\S]*Finish or stop the active agent task before switching workspaces[\s\S]*disabled=\{workspaceBusy \|\| agentBusy\}/],
  ['last-run status reports message-history size reduction with an explicit non-token disclaimer', /messageHistoryReductionPercent[\s\S]*Serialized provider message-array characters compared with the full conversation history\. This is not provider-token savings/],
  ['history trigger is accessible', /aria-label="Chat history"[\s\S]*aria-expanded=\{historyOpen\}/],
  ['history picker has searchable input', /q-chat-history-search[\s\S]*aria-label="Search chats"/],
  ['search filters title and message content', /chat\.title\.toLowerCase\(\)\.includes\(query\)[\s\S]*chat\.messages\.some/],
  ['each chat has inline selection action', /q-chat-history-select[\s\S]*onSelectChat\(chat\.id\)/],
  ['each chat has inline delete action', /q-chat-history-delete[\s\S]*onDeleteChat\(chat\.id\)/],
  ['delete action is labeled per chat', /aria-label=\{`Delete chat \$\{chat\.title\}`\}/],
  ['history popover and items animate', /variants=\{popoverVariants\}[\s\S]*variants=\{cardHoverVariants\}/],
  ['full motion respects the OS setting while lower levels force reduced spatial motion', /reducedMotion=\{level === 'full' \? 'user' : 'always'\}/],
  ['None skips Motion animations and Minimal uses a short transition default', /skipAnimations=\{level === 'off'\}[\s\S]*transition=\{level === 'minimal' \? \{ duration: 0\.12, ease: 'easeOut' \} : undefined\}/],
  ['CSS None disables animations and transitions while Minimal removes CSS keyframes', /data-animation-level="off"[\s\S]*animation: none !important;[\s\S]*transition: none !important;[\s\S]*data-animation-level="minimal"[\s\S]*animation: none !important;[\s\S]*transition-duration: 120ms !important;/],
  ['Tailwind typography remains in its utility layer', /@layer base \{[\s\S]*box-sizing: border-box;[\s\S]*\}/],
  ['Chat history items reserve room for title, metadata and delete controls', /\.q-chat-history-select\s*\{[^}]*flex-direction: row;[^}]*\}[\s\S]*\.q-chat-history-item-copy\s*\{[^}]*min-width: 0;[^}]*\}[\s\S]*\.q-chat-history-delete\s*\{[^}]*flex: 0 0 28px;[^}]*\}/s],
  ['explicit Chat and Agent toggle exists', /q-conversation-mode-toggle[\s\S]*Chat[\s\S]*Agent/],
  ['Chat mode is exposed as an accessible radio', /role="radio"[\s\S]*aria-checked=\{conversationMode === (["'])chat\1\}/],
  ['Agent mode is exposed as an accessible radio', /role="radio"[\s\S]*aria-checked=\{conversationMode === (["'])agent\1\}/],
  ['mode persists per canonical workspace key', /readConversationMode\(workspaceRoot[\s\S]*conversationModeStorageKey\(workspaceRoot\)/],
  ['Windows workspace storage keys normalize path case', /function normalizeWorkspaceKey[\s\S]*normalized\.toLowerCase\(\)/],
  ['unavailable browser storage fails closed to Chat', /catch\s*\{\s*return 'chat';\s*\}/],
  ['mode changes sync across windows and Chat cancels active work', /conversationModeFromStorageEvent[\s\S]*next === 'chat' && isWorking[\s\S]*api\.stopAgent\(\)[\s\S]*abortControllerRef\.current\?\.abort\(\)[\s\S]*addEventListener\('storage', onStorage\)/],
  ['switching to Chat stops the active coding run', /if \(next === 'chat' && isWorking\)[\s\S]*api\.stopAgent\(\)[\s\S]*abortControllerRef\.current\?\.abort\(\)/],
  ['mode readiness is bound to the currently selected workspace', /conversationModeWorkspaceRoot === workspaceRoot/],
  ['stored mode hydrates before a run can start', /if \(!workspaceRoot \|\| !conversationModeReady\)[\s\S]*Loading the active workspace and its saved Chat\/Agent mode[\s\S]*const effectiveMode/],
  ['mode controls and send remain disabled during mode hydration', /disabled=\{!conversationModeReady\}/],
  ['composer cannot send before mode hydration completes', /disabled=\{!value\.trim\(\) \|\| !conversationModeReady\}/],
  ['Chat mode forces read-only ask workflow', /conversationMode === 'chat'[\s\S]*effectiveMode[\s\S]*'ask'/],
  ['agent API parses and rejects missing or invalid top-level conversation mode', /parseConversationMode\(req\.body\?\.conversationMode\)[\s\S]*if \(!conversationMode\)[\s\S]*status\(400\)/],
  ['Ask/Plan promotes terse edit prompts using the active editor file', /isMutationRequest\(prompt,\s*\{\s*currentFile:\s*activeEditorFile\s*\}\)/],
  ['incomplete agent results expose a checkpoint resume action', /message\.resumable && message\.taskId && onResumeTask[\s\S]*Resume from checkpoint/],
  ['resume action passes the saved task ID into agent execution', /runAgent\('Continue this task from its saved checkpoint\.[^']*', taskId\)/],
  ['Chat mode blocks checkpoint resume before creating a run', /if \(resumeTaskId && conversationMode !== 'agent'\) \{[\s\S]*Switch to Agent mode to resume[\s\S]*return;/],
  ['resume task ID is included in the run request', /resumeTaskId \? \{ resumeTaskId \} : \{\}/],
  ['resume request preserves the selected conversation mode', /body: JSON\.stringify\(\{[\s\S]*?conversationMode,\s*conversationHistory: messages\.slice\(-8\)/],
  ['Chat mode cannot approve a pending workspace or terminal action', /const allow = approved && conversationMode === 'agent'[\s\S]*api\.approveAgent\(approvalId, allow\)/],
  ['Chat mode cannot roll back workspace files', /const handleRollback = async \(taskId: string\) => \{\s*if \(conversationMode !== 'agent'\)[\s\S]*api\.rollbackTask\(taskId\)/],
  ['Chat mode cannot apply a saved code patch', /const handleApplyPatch = async \(patch: FilePatch\) => \{\s*if \(conversationMode !== 'agent'\)[\s\S]*api\.writeFile\(patch\.filePath/],
  ['provider failures preserve the task ID for checkpoint recovery', /event: 'error'[\s\S]*interruptedTask\.id[\s\S]*resumable: true/],
  ['error event exposes checkpoint metadata to the chat result', /taskId: typeof data\.taskId[\s\S]*resumable: data\.resumable === true/],
  ['interrupted stream stores its acknowledged checkpoint in chat', /data\.event === 'task_started'[\s\S]*startedTaskId = data\.taskId[\s\S]*taskId: startedTaskId, resumable: true/],
  ['Studio derives read-only state from mode hydration and explicit mode', /const readOnly = !conversationModeReady \|\| conversationMode !== 'agent'/],
  ['Chat mode hides file create, rename, and delete actions', /!readOnly && <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 shrink-0">/],
  ['Monaco editor becomes read-only in Chat mode', /options=\{\{[\s\S]*?readOnly,/],
  ['terminal commands are locally rejected and disabled in Chat mode', /if \(readOnly \|\| !cmd\.trim\(\) \|\| isRunning\) return/],
  ['Git mutations have local Chat-mode guards', /const handleStage = async[\s\S]*?if \(readOnly\) return;/],
  ['manual tool execution is disabled in Chat mode', /disabled=\{readOnly \|\| isExecuting \|\| !selectedTool\}/],
  ['project run and preview honor read-only state', /const handleRun = useCallback[\s\S]*?if \(disabled\) return;/],
];
for (const [name, pattern] of checks) assert.match(panel + '\n' + chatView + '\n' + composer + '\n' + app + '\n' + server + '\n' + css + '\n' + atlas + '\n' + productionCss + '\n' + modeStorage + '\n' + workspace + '\n' + studioEditor + '\n' + terminal + '\n' + fileTree + '\n' + gitPanel + '\n' + toolsPanel + '\n' + runner + '\n' + main + '\n' + workbench, pattern, name);
assert.doesNotMatch(css, /^\.text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl)\s*\{/m, 'Tailwind typography utilities are not shadowed by unlayered duplicates');
assert.match(intentRouter, /conversationMode === 'chat'[\s\S]*return \{ kind: 'chat',[\s\S]*context\.matchesRememberedProject\(\)/, 'Chat lock precedes remembered-project fallback');
console.log(JSON.stringify({ status: 'PASS', files: ['server.ts', 'src/server/intentRouter.ts', 'src/components/ChatPanel.tsx', 'src/components/ChatView.tsx', 'src/components/Composer.tsx', 'src/App.tsx', 'src/shared/conversationModeStorage.ts', 'src/components/WorkbenchLayout.tsx', 'src/index.css'], checks: checks.length + 1 }));
