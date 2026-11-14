import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Inline editing contract (ghost-text completion + Ctrl+K inline AI bar).
// The repo verifies UI without jsdom via tsc plus source-scanning contracts;
// this gate locks in the 2026-11-12 inline-editing upgrade and bug fixes:
//   - completions resume after a comment line (current-line-only suppression)
//   - Ctrl+K is not stolen from other inputs; Escape / outside click dismiss
//   - the ghost-text provider resolves the model's file in O(1), not O(n)
//   - pacing constants are shared, and truncated tails are never inserted
// It fails (exit 1) on a tree without these behaviors.
const root = process.cwd();
const editor = fs.readFileSync(path.join(root, 'src', 'components', 'EditorArea.tsx'), 'utf8');
const shared = fs.readFileSync(path.join(root, 'src', 'shared', 'inlineCompletion.ts'), 'utf8');

// --- shared module surface ---
assert.match(shared, /export function isCompletionSuppressedContext\(/, 'shared module exports the current-line comment detector');
assert.match(shared, /export function trimIncompleteTail\(/, 'shared module exports the dangling-tail trimmer');
assert.match(shared, /export const INLINE_COMPLETION_DEBOUNCE_MS = 450;/, 'debounce pacing is a shared constant');
assert.match(shared, /export const INLINE_COMPLETION_THROTTLE_MS = 700;/, 'throttle pacing is a shared constant');
assert.match(shared, /value = trimIncompleteTail\(value\);/, 'cleanInlineCompletion trims an unterminated trailing line');
assert.doesNotMatch(shared, /slice\(-180\)/, 'no last-180-characters comment heuristic anywhere');

// --- renderer wiring ---
assert.match(editor, /import \{[^}]*isCompletionSuppressedContext[^}]*\} from '\.\.\/shared\/inlineCompletion\.js';/, 'EditorArea imports the comment detector');
assert.match(editor, /import \{[^}]*trimIncompleteTail[^}]*\} from '\.\.\/shared\/inlineCompletion\.js';/, 'EditorArea imports the tail trimmer');
assert.match(editor, /import \{[^}]*INLINE_COMPLETION_DEBOUNCE_MS[^}]*\} from '\.\.\/shared\/inlineCompletion\.js';/, 'EditorArea imports the debounce constant');
assert.match(editor, /import \{[^}]*INLINE_COMPLETION_THROTTLE_MS[^}]*\} from '\.\.\/shared\/inlineCompletion\.js';/, 'EditorArea imports the throttle constant');
assert.match(editor, /if \(!before\.trim\(\) \|\| isCompletionSuppressedContext\(before\.slice\(lineStart\), languageId\)\)/, 'suppression checks only the current line');
assert.doesNotMatch(editor, /before\.slice\(-180\)/, 'the old last-180-characters heuristic is gone from the editor');
assert.match(editor, /await new Promise\(resolve => setTimeout\(resolve, INLINE_COMPLETION_DEBOUNCE_MS\)\);/, 'debounce uses the shared constant');
assert.doesNotMatch(editor, /setTimeout\(resolve, 450\)/, 'no hardcoded 450 ms debounce');
assert.doesNotMatch(editor, /lastInlineRequestAt\.current < 700/, 'no hardcoded 700 ms throttle');
assert.match(editor, /const completion = trimIncompleteTail\(result\.completion\);/, 'the completion is trimmed before insert');
assert.match(editor, /insertText: completion,/, 'the trimmed completion is what gets inserted');

// --- O(1) model -> source resolution ---
assert.match(editor, /const sourceUriIndex = React\.useMemo\(\(\) => \{/, 'a uri index is memoized from the file set');
assert.match(editor, /sourceUriIndexRef\.current = sourceUriIndex;/, 'the index is read through a ref for fresh closures');
assert.match(editor, /const activeSource = resolveModelSource\(String\(model\.uri\.toString\(\)\)\);/, 'the inline provider resolves via the index, not a linear scan');

// --- Ctrl+K shortcut and dismissal ---
assert.match(editor, /const inTextField = !!target\?\.closest\?\.\('input, textarea, \[contenteditable="true"\]'\);/, 'Ctrl+K checks whether a text field has focus');
assert.match(editor, /if \(inTextField && !editorFocused\) return;/, 'Ctrl+K is not claimed while another input is focused');
assert.match(editor, /if \(e\.key === 'Escape'\) setShowInlinePrompt\(false\);/, 'Escape closes the inline AI bar');
assert.match(editor, /window\.addEventListener\('pointerdown', onPointerDown\);/, 'a click outside the bar closes it');
assert.match(editor, /<div ref=\{inlinePromptRef\}/, 'the bar node is referenced for dismissal');
assert.match(editor, /aria-label="Close inline AI prompt"/, 'the bar close button is labelled for screen readers');

// --- ghost-text accept hint ---
assert.match(editor, /const \[inlineHint, setInlineHint\] = useState\(false\);/, 'the editor tracks the suggestion hint');
assert.match(editor, /Suggestion ready — Tab to accept/, 'the accept hint is shown after a completion');
assert.match(editor, /Ctrl\+→ accepts the next word/, 'word-by-word accept is taught');

console.log(JSON.stringify({ status: 'PASS', files: ['src/shared/inlineCompletion.ts', 'src/components/EditorArea.tsx'], checks: 29 }));
