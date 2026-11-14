// QUILLIX M7.4 contract — contextual inline chat ("Ask about this line").
//
// Two halves:
//   1. Source surface — the shared context helper, the bubble component, the
//      renderer wiring, the server route and the renderer bridge must all
//      exist and keep their safeguards.
//   2. Runtime behaviour — the REAL shared helper is imported and exercised on
//      a real string, proving that the context window is bounded, that the
//      anchor line is always inside it, and that the bubble is kept on screen.
//
// The runtime half is what makes this a contract instead of a description: a
// source scan alone cannot prove the window is bounded.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const project = path.resolve(import.meta.dirname, '../..');
const read = (...parts) => fs.readFileSync(path.join(project, ...parts), 'utf8');

const helperSource = read('src', 'shared', 'contextualChat.ts');
const bubbleSource = read('src', 'components', 'ContextualChatBubble.tsx');
const editorSource = read('src', 'components', 'EditorArea.tsx');
const serverSource = read('server.ts');
const bridgeSource = read('src', 'services', 'apiBridge.ts');
const combinedSource = [helperSource, bubbleSource, editorSource, serverSource, bridgeSource].join('\n');

const checks = [
  ['the shared context helper exists as its own module',
    /export function buildContextualChatContext\(/],
  ['the shared helper bounds the context window to a fixed number of lines',
    /export const CONTEXTUAL_CHAT_CONTEXT_LINES = 12/],
  ['the shared helper bounds the context window by characters too',
    /export const CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS = 12_000/],
  ['the shared helper clamps a requested line into the document',
    /export function normalizeAnchorLine\(/],
  ['the shared helper builds the prompt',
    /export function buildContextualChatPrompt\(/],
  ['the shared helper positions the bubble inside the viewport',
    /export function positionContextualChatBubble\(/],
  ['the bubble component is rendered',
    /export const ContextualChatBubble: React\.FC/],
  ['the bubble asks the shared helper where to sit',
    /positionContextualChatBubble\(anchorTop, lineHeight, BUBBLE_WIDTH, BUBBLE_HEIGHT, viewport\)/],
  ['the editor tracks the line under the pointer',
    /editor\.onMouseMove\(/],
  ['the editor offers an "Ask about this" affordance for that line',
    /Ask about this/],
  ['the editor renders the anchored bubble',
    /<ContextualChatBubble/],
  ['the editor measures the viewport so the bubble can be clamped',
    /new ResizeObserver\(update\)/],
  ['the editor sends the question through the bridge',
    /api\.askAboutLine\(/],
  ['the server exposes the contextual question route',
    /app\.post\('\/api\/editor\/ask-line', requireAgentMode/],
  ['the server rebuilds the window with the shared helper',
    /buildContextualChatPrompt\(anchor, question\)/],
  ['the server refuses a request without a question',
    /A question is required\./],
  ['the server refuses a request without a file path',
    /A file path is required\./],
  ['the server refuses a request without the file content',
    /The file content is required\./],
  ['the server bounds the model call with a timeout',
    /setTimeout\(\(\) => controller\.abort\(\), 45_000\)/],
  ['the server turns an aborted call into a 504',
    /res\.status\(aborted \? 504 : 502\)/],
  ['the bridge posts to the contextual question route',
    /fetch\('\/api\/editor\/ask-line'/],
];

for (const [label, pattern] of checks) {
  assert.ok(pattern.test(combinedSource), `M7.4 contract: ${label}`);
}

// --- Runtime behaviour ------------------------------------------------------

const helperUrl = pathToFileURL(path.join(project, 'src', 'shared', 'contextualChat.ts')).href;
const {
  buildContextualChatContext,
  buildContextualChatPrompt,
  normalizeAnchorLine,
  positionContextualChatBubble,
  CONTEXTUAL_CHAT_CONTEXT_LINES,
  CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS,
} = await import(helperUrl);

// A real document, not a stub.
const lines = Array.from({ length: 500 }, (_, i) => `const value${i} = ${i}; // line ${i + 1}`);
const document = lines.join('\n');
const anchor = { filePath: 'src/app.ts', line: 250, content: document };

// The window around an anchor is bounded and contains the anchor.
const context = buildContextualChatContext(anchor);
assert.ok(context.text.length <= CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS,
  `M7.4 contract: the context window exceeded the ${CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS} character ceiling`);
assert.ok(context.endLine - context.startLine + 1 <= CONTEXTUAL_CHAT_CONTEXT_LINES * 2 + 1,
  'M7.4 contract: the context window exceeded the configured line budget');
assert.ok(context.text.includes('const value250 = 250;'),
  'M7.4 contract: the anchored line is missing from the context window');
assert.ok(context.text.includes('>>>'),
  'M7.4 contract: the anchor line is not marked in the context window');
assert.ok(context.startLine <= 250 && context.endLine >= 250,
  'M7.4 contract: the context window does not cover the anchor line');

// A window that cannot fit is shrunk and says so, rather than sending it all.
const huge = { filePath: 'src/huge.ts', line: 2, content: 'x'.repeat(200_000) };
const shrunk = buildContextualChatContext(huge);
assert.ok(shrunk.text.length <= CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS,
  'M7.4 contract: an oversized file was not clipped to the character ceiling');
assert.equal(shrunk.truncated, true, 'M7.4 contract: a clipped window did not report truncation');

// An anchor outside the document is clamped instead of throwing.
assert.equal(normalizeAnchorLine(-5, 500), 1);
assert.equal(normalizeAnchorLine(9999, 500), 500);
assert.equal(normalizeAnchorLine(0, 0), 1);

// The prompt names the file and the line, and carries the context.
const prompt = buildContextualChatPrompt(anchor, 'What does this do?');
assert.ok(prompt.includes('src/app.ts'), 'M7.4 contract: the prompt does not name the file');
assert.ok(prompt.includes('250'), 'M7.4 contract: the prompt does not name the line');
assert.ok(prompt.includes('What does this do?'), 'M7.4 contract: the prompt does not carry the question');
assert.ok(prompt.includes('>>>'), 'M7.4 contract: the prompt does not mark the anchor line');
assert.equal(buildContextualChatPrompt(anchor, '   '), '', 'M7.4 contract: an empty question produced a prompt');

// The bubble is clamped to the viewport instead of overflowing it.
const viewport = { width: 800, height: 600 };
const nearBottom = positionContextualChatBubble(560, 18, 340, 220, viewport);
assert.ok(nearBottom.top + 220 <= viewport.height,
  'M7.4 contract: the bubble overflows the bottom of the viewport');
assert.ok(nearBottom.left >= 0, 'M7.4 contract: the bubble overflows the left of the viewport');
assert.ok(nearBottom.left + 340 <= viewport.width,
  'M7.4 contract: the bubble overflows the right of the viewport');
const nearTop = positionContextualChatBubble(2, 18, 340, 220, viewport);
assert.ok(nearTop.top >= 0, 'M7.4 contract: the bubble overflows the top of the viewport');

console.log(JSON.stringify({
  status: 'PASS',
  checks: checks.length,
  runtimeAssertions: 16,
  contextChars: context.text.length,
  contextCeiling: CONTEXTUAL_CHAT_MAX_CONTEXT_CHARS,
  windowLines: `${context.startLine}-${context.endLine}`,
}));
