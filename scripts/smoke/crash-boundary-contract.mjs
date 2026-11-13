import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// M9.9 crash-boundary contract: the whole React tree must be wrapped so an
// uncaught render error surfaces a branded recovery screen (Restart / Recover /
// Report) instead of a blank window. The boundary must be self-contained (no
// node:crypto, no server-only redaction import that would break the browser
// bundle) and must redact credentials out of any captured crash text.
const project = path.resolve(import.meta.dirname, '../..');
const main = fs.readFileSync(path.join(project, 'src/main.tsx'), 'utf8');
const boundary = fs.readFileSync(path.join(project, 'src/components/CrashBoundary.tsx'), 'utf8');

function has(hay, needle, message) {
  if (needle instanceof RegExp) {
    assert.ok(needle.test(hay), `crash-boundary contract: ${message}`);
  } else {
    assert.ok(hay.includes(needle), `crash-boundary contract: ${message}`);
  }
}

// --- wiring ---
has(main, "import { QuillixErrorBoundary } from './components/CrashBoundary.tsx';", 'main.tsx imports the crash boundary');
has(main, '<QuillixErrorBoundary>', 'main.tsx wraps the tree in the boundary');
has(main, '<ThemeProvider>', 'theme provider stays inside the boundary so its own errors are caught');
has(main, /<MotionConfig[^>]*reducedMotion=\{level === 'full' \? 'user' : 'always'\}/, 'main.tsx preserves the animation-level-aware motion config');
has(main, '<App />', 'App is still rendered inside the boundary');

// --- boundary behavior ---
has(boundary, 'static getDerivedStateFromError(', 'boundary implements getDerivedStateFromError');
has(boundary, 'componentDidCatch(error: Error, info: React.ErrorInfo)', 'boundary implements componentDidCatch');
has(boundary, 'this.setState({ info })', 'boundary records the caught error');
has(boundary, 'role="alertdialog" aria-modal="true" aria-label="NUVRO AI crashed"', 'recovery screen is an accessible modal');
for (const action of ['Restart app', 'Recover workspace', 'Copy crash report']) {
  has(boundary, action, `recovery screen offers "${action}"`);
}
has(boundary, 'window.location.reload()', 'restart reloads the renderer');
has(boundary, /new Set\(\["quillix_theme", "quillix_agent_width"\]\)/, 'recover preserves user preferences');
has(boundary, 'startsWith("quillix_")', 'recover clears only transient quillix_ renderer state');
has(boundary, 'navigator.clipboard.writeText', 'report copies the crash text to the clipboard');

// --- crash persistence + redaction ---
has(boundary, /export const CRASH_STORAGE_KEY = "quillix_last_crash";/, 'crash persisted under a stable key');
has(boundary, 'localStorage.setItem(CRASH_STORAGE_KEY', 'boundary writes the crash report to storage');
has(boundary, 'function redactCrashText(', 'boundary has a local credential redactor');
has(boundary, 'redactCrashText(String(error?.message', 'captured message is redacted');
has(boundary, 'sk-[A-Za-z0-9_-]{12,}', 'redactor masks provider sk- keys');
has(boundary, '(Bearer\\s+)', 'redactor masks Bearer ***');

// --- browser-safety (must render even when the app graph is the failure) ---
assert.doesNotMatch(boundary, /from 'node:crypto'/, 'crash boundary must not import node:crypto');
assert.doesNotMatch(boundary, /secretRedaction/, 'crash boundary must not import the server-only redaction module');
assert.doesNotMatch(boundary, /lucide-react|@monaco-editor|fetch\(/, 'crash boundary must stay dependency-free');

console.log(JSON.stringify({ status: 'PASS', files: ['src/main.tsx', 'src/components/CrashBoundary.tsx'] }));
