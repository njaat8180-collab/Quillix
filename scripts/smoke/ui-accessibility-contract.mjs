import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M9.8 accessibility regression contract: icon-only controls must expose an
// accessible name, and the chat history popover must follow the dialog
// keyboard pattern (Escape closes, focus returns to the trigger). Pre-fix
// code shipped icon-only buttons with no name and a popover with no Escape
// handling, so keyboard/screen-reader users hit dead ends.
const project = path.resolve(import.meta.dirname, '../..');
const diagnostics = fs.readFileSync(path.join(project, 'src/components/DiagnosticsModal.tsx'), 'utf8');
const tools = fs.readFileSync(path.join(project, 'src/components/ToolRegistryPanel.tsx'), 'utf8');
const terminal = fs.readFileSync(path.join(project, 'src/components/TerminalPanel.tsx'), 'utf8');
const panel = fs.readFileSync(path.join(project, 'src/components/ChatPanel.tsx'), 'utf8');
const composer = fs.readFileSync(path.join(project, 'src/components/Composer.tsx'), 'utf8');
const settings = fs.readFileSync(path.join(project, 'src/components/SettingsScreen.tsx'), 'utf8');
const toolsPanel = fs.readFileSync(path.join(project, 'src/components/ToolRegistryPanel.tsx'), 'utf8');
const fileTree = fs.readFileSync(path.join(project, 'src/components/FileTree.tsx'), 'utf8');

const checks = [
  ['diagnostics close button has an accessible name', /onClick=\{onClose\}[^>]*aria-label="Close diagnostics"[\s\S]*?<X size=\{16\} \/>/],
  ['tool registry refresh button has an accessible name', /onClick=\{fetchTools\}[^>]*aria-label="Refresh tools"[\s\S]*?<RefreshCw size=\{13\}/],
  ['terminal submit button has an accessible name', /type="submit"[\s\S]*?aria-label="Run terminal command"[\s\S]*?<CornerDownLeft size=\{14\} \/>/],
  ['chat history popover closes on Escape', /if \(event\.key !== 'Escape'\) return;[\s\S]*?setHistoryOpen\(false\);/],
  ['Escape returns focus to the history trigger', /historyTriggerRef\.current\?\.focus\(\);/],
  ['history trigger is wired to the focus-return ref', /ref=\{historyTriggerRef\}[\s\S]*?onClick=\{\(\) => setHistoryOpen\(\(open\) => !open\)\}/],
  ['the Escape listener is cleaned up on close', /return \(\) => window\.removeEventListener\('keydown', onKeyDown\);/],
  ['continue focuses the composer through a ref instead of a DOM query', /composerInputRef\.current\?\.focus\(\);/],
  ['chat panel hands the composer its input ref', /inputRef=\{composerInputRef\}/],
  ['composer accepts and attaches the parent input ref', /const messageInputRef = inputRef \?\? textareaRef;/],
  ['composer no longer relies on a DOM query to find its textarea', /ref=\{messageInputRef\}/],
  ['settings dialog exposes modal semantics and is focusable', /role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?tabIndex=\{-1\}/],
  ['settings dialog focuses itself when opened', /dialogRef\.current\?\.focus\(\);/],
  ['settings dialog closes on Escape through the latest close handler', /if \(event\.key === 'Escape'\) \{[\s\S]*?onCloseRef\.current\(\)/],
  ['settings dialog traps Tab inside the dialog', /if \(!event\.shiftKey && active === last\) \{[\s\S]*?first\.focus\(\);/],
  ['settings dialog restores focus to the opener on close', /previouslyFocused\?\.focus\(\);/],
  ['tools/plugins switch is a labeled tablist', /role="tablist" aria-label="Tools and plugins"/],
  ['each tab exposes selected state and roving tabindex', /'aria-selected': view === id,[\s\S]*?tabIndex: view === id \? 0 : -1/],
  ['tabs are operable with arrow keys', /event\.key !== 'ArrowLeft' && event\.key !== 'ArrowRight'/],
  ['activating a tab moves focus to it', /requestAnimationFrame\(\(\) => tabRefs\.current\[next\]\?\.focus\(\)\)/],
  ['file tree new-file button has an accessible name', /title="New File \(Root\)"\s*\n\s*aria-label="New File \(Root\)"/],
  ['file tree new-folder button has an accessible name', /title="New Folder \(Root\)"\s*\n\s*aria-label="New Folder \(Root\)"/],
  ['file tree refresh button has an accessible name', /title="Refresh Files"\s*\n\s*aria-label="Refresh Files"/],
];

const haystack = `${diagnostics}\n${tools}\n${terminal}\n${panel}\n${composer}\n${settings}\n${toolsPanel}\n${fileTree}`;
for (const [name, pattern] of checks) assert.match(haystack, pattern, name);
console.log(JSON.stringify({ status: 'PASS', files: ['src/components/DiagnosticsModal.tsx', 'src/components/ToolRegistryPanel.tsx', 'src/components/TerminalPanel.tsx', 'src/components/ChatPanel.tsx', 'src/components/Composer.tsx', 'src/components/SettingsScreen.tsx', 'src/components/FileTree.tsx'], checks: checks.length }));
