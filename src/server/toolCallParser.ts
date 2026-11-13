import type { ToolCall } from '../shared/types.js';
import { normalizeToolName, normalizeToolArgs } from './toolAliases.js';

/**
 * NUVRO AI Tool-Call Text Parser
 *
 * Small local models such as qwen2.5-coder:3b can still fail to use Ollama's
 * native `tool_calls` field and instead WRITE the tool call as plain text:
 *
 *   {"name": "create_file", "arguments": {"filePath": "index.html", ...}}
 *   ```json
 *   {"name": "create_file", "arguments": {...}}
 *   ```
 *   <tool_call>
 *   {"name": "create_file", "arguments": {...}}
 *   </tool_call>
 *
 * This module detects those patterns inside model text, converts them into
 * real ToolCall records (so the executor runs them against the workspace),
 * and removes them from the text the user sees in Chat.
 */

export interface ParsedTextToolCalls {
  calls: ToolCall[];
  /** The original text with every recognized tool-call span removed. */
  cleanedText: string;
}

export type ProviderTextSegmentKind = 'text' | 'code' | 'tool_call' | 'error';
export interface ProviderTextSegment {
  kind: ProviderTextSegmentKind;
  content: string;
  language?: string;
  filePath?: string;
}

/** Splits mixed provider output without guessing where unlabelled code belongs. */
export function classifyProviderText(text: string): ProviderTextSegment[] {
  if (!text) return [];
  const segments: ProviderTextSegment[] = [];
  const fence = /```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > cursor) pushProviderTextSegment(segments, text.slice(cursor, match.index));
    const before = text.slice(Math.max(0, match.index - 160), match.index);
    const fileMatch = /(?:file\s*:\s*|^|\n)\s*[`']?([\w./\\-]+\.[\w]+)[`']?\s*:?\s*$/i.exec(before);
    const language = match[1] || undefined;
    segments.push({ kind: fileMatch ? 'code' : 'code', content: match[2], language, ...(fileMatch ? { filePath: fileMatch[1].replace(/\\/g, '/') } : {}) });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) pushProviderTextSegment(segments, text.slice(cursor));
  return segments.length ? segments : [{ kind: detectProviderTextKind(text), content: text }];
}

function pushProviderTextSegment(segments: ProviderTextSegment[], content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  segments.push({ kind: detectProviderTextKind(trimmed), content: trimmed });
}

function detectProviderTextKind(content: string): ProviderTextSegmentKind {
  if (/\b(?:error|exception|traceback|failed|failure|exit code|stack trace)\b/i.test(content)) return 'error';
  if (/<tool_call>|["'](?:name|tool)["']\s*:/i.test(content)) return 'tool_call';
  return 'text';
}

/**
 * Converts only explicitly labelled fenced code into write_file calls.
 * A filename is required immediately before the fence, for example:
 * `src/app.ts:` followed by a fenced block. Unlabelled code remains prose.
 */
export function extractExplicitCodeFileCalls(text: string): ParsedTextToolCalls {
  if (!text) return { calls: [], cleanedText: text };
  const calls: ToolCall[] = [];
  const removals: Array<{ start: number; end: number }> = [];
  const fence = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:file\s*:\s*)?[`']?([\w./\\-]+\.(?:js|jsx|ts|tsx|py|html?|css|json|md|vue|svelte|go|rs|java|c|cpp|cs|php|rb|sh))[`']?\s*:?\s*\n\s*```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const filePath = match[1].replace(/\\/g, '/');
    const content = match[3];
    if (!content.trim()) continue;
    calls.push(makeToolCall('write_file', { filePath, content }));
    removals.push({ start: match.index, end: match.index + match[0].length });
  }
  let cleanedText = text;
  for (const span of removals.reverse()) cleanedText = cleanedText.slice(0, span.start) + cleanedText.slice(span.end);
  return { calls, cleanedText: cleanedText.replace(/\n{3,}/g, '\n\n').trim() };
}

function isLikelyUnfencedSource(block: string): boolean {
  const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return false;
  const sourceLine = /^\s*(?:import\b|export\b|const\b|let\b|var\b|function\b|async\s+function\b|class\b|return\b|def\b|if\s*\(|if\s+|for\s*\(|for\s+|while\s*\(|while\s+|from\s+\S+\s+import\b|<\/?(?:!doctype|[a-z][\w:-]*\b)|@(?:media|keyframes|import)\b|[.#][\w-]+\s*[,:{]|[a-z][\w-]*\s*\{)/i;
  const syntaxLine = /(?:[{};]|=>|<\/?[a-z][^>]*>|^\s*(?:def|class|if|for|while)\b.*:\s*$)/i;
  const signals = lines.filter(line => sourceLine.test(line) || syntaxLine.test(line)).length;
  if (lines.length === 1) return syntaxLine.test(lines[0]) && !/\b(?:because|therefore|should|means|explains)\b/i.test(lines[0]);
  return signals >= Math.max(2, Math.ceil(lines.length * 0.45)) && lines.some(line => syntaxLine.test(line));
}

function isNarrativeLine(line: string): boolean {
  if (/^\s*(?:\/\/|#)/.test(line)) return false;
  return /^\s*(?:done[.!]?|finished[.!]?|updated[.!]?|ready[.!]?)\s*$/i.test(line) ||
    /^\s*[A-Z][^;{}]{8,}[.!?]\s*$/.test(line);
}

function findUnfencedSourceSpan(text: string): { start: number; end: number; code: string } | undefined {
  const lines = text.split(/\r?\n/);
  const lineStarts = [0];
  const newlinePattern = /\r?\n/g;
  let newline: RegExpExecArray | null;
  while ((newline = newlinePattern.exec(text)) !== null) lineStarts.push(newlinePattern.lastIndex);
  const start = lines.findIndex(line => isLikelyUnfencedSource(line));
  if (start < 0) return undefined;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (isNarrativeLine(lines[index]) && isLikelyUnfencedSource(lines.slice(start, index).join('\n'))) {
      end = index;
      break;
    }
  }
  const code = lines.slice(start, end).join('\n').trim();
  if (!isLikelyUnfencedSource(code)) return undefined;
  const startOffset = lineStarts[start];
  const separatorBeforeEnd = end < lines.length ? (text.slice(0, lineStarts[end]).endsWith('\r\n') ? 2 : 1) : 0;
  const endOffset = end < lines.length ? lineStarts[end] - separatorBeforeEnd : text.length;
  return { start: startOffset, end: endOffset, code };
}

/**
 * Converts one unlabeled fenced source block only when the caller already has
 * an authoritative single file target (for example the open editor file).
 * This fixes provider replies that contain implementation code but omit the
 * filename, without guessing across multiple files or arbitrary chat prose.
 */
export function extractCodeForKnownFile(text: string, targetFile?: string): ParsedTextToolCalls {
  if (!text || !targetFile || !/\.(?:js|jsx|ts|tsx|py|html?|css|json|md|vue|svelte|go|rs|java|c|cpp|cs|php|rb|sh)$/i.test(targetFile)) {
    return { calls: [], cleanedText: text };
  }
  const matches = [...text.matchAll(/```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g)];
  let content: string;
  let start: number;
  let end: number;
  if (matches.length === 1 && matches[0][2].trim()) {
    const match = matches[0];
    content = match[2];
    start = match.index || 0;
    end = start + match[0].length;
  } else if (matches.length === 0 && !/\.md$/i.test(targetFile)) {
    const span = findUnfencedSourceSpan(text);
    if (!span) return { calls: [], cleanedText: text };
    content = span.code;
    start = span.start;
    end = span.end;
  } else {
    return { calls: [], cleanedText: text };
  }
  const call = makeToolCall('write_file', { filePath: targetFile.replace(/\\/g, '/'), content });
  const cleanedText = `${text.slice(0, start)}${text.slice(end)}`.replace(/\n{3,}/g, '\n\n').trim();
  return { calls: [call], cleanedText };
}

/** Shapes a JSON object can take to be considered a tool call. */
function normalizeToolCallObject(
  obj: unknown,
  knownTools: Set<string> | null
): { name: string; args: Record<string, any> } | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const record = obj as Record<string, unknown>;
  const acceptName = (rawName: string, argsCandidate: unknown): { name: string; args: Record<string, any> } | null => {
    // Ignore names that do not resolve to a registered tool; plain JSON in
    // explanations must never become a filesystem operation.
    const name = normalizeToolName(rawName);
    if (knownTools && !knownTools.has(name)) return null;
    if (argsCandidate === undefined) {
      throw new Error(`Missing arguments for tool ${name}; no tools were executed.`);
    }
    let args = argsCandidate;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        throw new Error(`Invalid JSON arguments for tool ${name}; no tools were executed.`);
      }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error(`Invalid object arguments for tool ${name}; no tools were executed.`);
    }
    return { name, args: normalizeToolArgs(args as Record<string, any>) };
  };

  // Native-style object, including an explicit empty arguments object.
  if (typeof record.name === 'string' && record.name.trim()) {
    return acceptName(record.name.trim(), record.arguments ?? record.args ?? record.parameters ??
      (('arguments' in record || 'args' in record || 'parameters' in record) ? null : undefined));
  }

  // NUVRO AI tool envelope, supporting {tool, arguments} and inline fields.
  if (typeof record.tool === 'string' && record.tool.trim()) {
    const hasNested = 'arguments' in record || 'args' in record || 'parameters' in record;
    if (hasNested) {
      return acceptName(record.tool.trim(), record.arguments ?? record.args ?? record.parameters ?? null);
    }
    const { tool: _tool, ...rest } = record;
    return acceptName(record.tool.trim(), Object.keys(rest).length ? rest : undefined);
  }

  // Ollama native fragment: {function: {name, arguments}}. Normalize its
  // aliases via the same strict path as every other envelope.
  if (record.function && typeof record.function === 'object' && !Array.isArray(record.function)) {
    const fn = record.function as Record<string, unknown>;
    if (typeof fn.name === 'string' && fn.name.trim()) {
      return acceptName(fn.name.trim(), fn.arguments ??
        (('arguments' in fn) ? null : undefined));
    }
  }

  return null;
}

/**
 * Finds a complete, balanced JSON value starting at `text.indexOf('{', start)`
 * (or `[`). Returns the parsed value and the index just past the closing brace.
 * Respects string escapes so braces inside strings do not confuse the scanner.
 */
function scanJsonAt(text: string, start: number): { value: unknown; end: number } | null {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && ch === close) {
        const raw = text.slice(start, i + 1);
        try {
          return { value: JSON.parse(raw), end: i + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

let callSeq = 0;
function makeToolCall(name: string, args: Record<string, any>): ToolCall {
  return {
    id: `call_text_${Date.now()}_${callSeq++}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    args,
  };
}

/**
 * Extracts tool calls that the model wrote as text. `knownTools` restricts
 * recognition to registered tool names; pass null to accept any name+args
 * shape (used for defensive chat sanitization).
 */
export function extractToolCallsFromText(
  text: string,
  knownTools: Set<string> | null
): ParsedTextToolCalls {
  if (!text) return { calls: [], cleanedText: text };

  // A few OpenAI-compatible coding models emit a legacy XML-shaped call
  // instead of native tool_calls or the JSON envelope documented below:
  // <tool_call>write_file<arg_key>filePath</arg_key><arg_value>...</arg_value>
  // ...</tool_call>. Accept only complete, registered calls. Incomplete
  // blocks remain prose so the agent can nudge the model to retry; partial
  // file content must never be written.
  const xml = extractXmlStyleToolCalls(text, knownTools);
  if (xml.calls.length > 0 || xml.cleanedText !== text) return xml;

  const calls: ToolCall[] = [];
  const removals: Array<{ start: number; end: number }> = [];
  const protectedSpans: Array<{ start: number; end: number }> = [];

  // 1) <tool_call>...</tool_call> wrappers (qwen template format)
  const tagRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(text)) !== null) {
    protectedSpans.push({ start: m.index, end: m.index + m[0].length });
    const inner = m[1].trim();
    const parsed = tryParseJson(inner);
    if (!parsed.ok) throw new Error('Malformed <tool_call> JSON; no tools were executed.');
    collectCalls(parsed.value, knownTools, calls, () => removals.push({ start: m!.index, end: m!.index + m![0].length }));
  }

  // 2) Fenced ```json / ```tool blocks containing tool calls
  const fenceRegex = /```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g;
  while ((m = fenceRegex.exec(text)) !== null) {
    // JSON inside explanation/code fences is never a fallback bare call.
    // If a fenced batch is not entirely valid, keep it as prose, not actions.
    protectedSpans.push({ start: m.index, end: m.index + m[0].length });
    const language = m[1].toLowerCase();
    if (!['', 'json', 'tool', 'tools'].includes(language)) continue;
    const inner = m[2].trim();
    // Only treat as a tool-call block when it parses as a tool call object.
    const parsed = tryParseJson(inner);
    if (parsed.ok && looksLikeToolCallOnly(parsed.value, knownTools)) {
      collectCalls(parsed.value, knownTools, calls, () => removals.push({ start: m!.index, end: m!.index + m![0].length }));
    } else if (!parsed.ok && /^```(?:tool|tools)\b/.test(m[0])) {
      throw new Error('Malformed tool block JSON; no tools were executed.');
    }
  }

  // 3) Bare JSON objects anywhere in the text (including ```-less output)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    // Skip fenced/wrapped content; it was already handled atomically.
    if (protectedSpans.some((r) => i >= r.start && i < r.end)) continue;
    if (removals.some((r) => i >= r.start && i < r.end)) continue;
    const scanned = scanJsonAt(text, i);
    if (!scanned) continue;
    if (protectedSpans.some((r) => i < r.end && scanned.end > r.start)) continue;
    if (removals.some((r) => i >= r.start && scanned.end <= r.end)) continue;
    const before = collectCalls(scanned.value, knownTools, calls, () => {});
    if (before) {
      removals.push({ start: i, end: scanned.end });
    }
    i = scanned.end - 1;
  }

  // Remove recognized spans from the text (in reverse to keep indices valid)
  removals.sort((a, b) => b.start - a.start);
  let cleaned = text;
  for (const r of removals) {
    cleaned = cleaned.slice(0, r.start) + cleaned.slice(r.end);
  }

  // Tidy leftover artifacts (empty fences, doubled blank lines)
  cleaned = cleaned
    .replace(/```(?:json|tool|tools)?\s*\n\s*```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (calls.length === 0 && looksLikeTruncatedKnownToolEnvelope(text, knownTools)) {
    throw new Error('Malformed or truncated tool-call JSON; no tools were executed. Retry the tool call with complete arguments.');
  }

  return { calls, cleanedText: cleaned };
}

function extractXmlStyleToolCalls(text: string, knownTools: Set<string> | null): ParsedTextToolCalls {
  const calls: ToolCall[] = [];
  const removals: Array<{ start: number; end: number }> = [];
  const block = /<tool_call>\s*([A-Za-z0-9_-]+)\s*([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = block.exec(text)) !== null) {
    const args: Record<string, string> = {};
    const argRegex = /<arg_key>\s*([^<]+?)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
    let argMatch: RegExpExecArray | null;
    while ((argMatch = argRegex.exec(match[2])) !== null) {
      const key = argMatch[1].trim();
      if (!key || key in args) return { calls: [], cleanedText: text };
      args[key] = argMatch[2];
    }
    const remaining = match[2].replace(argRegex, '').trim();
    if (!Object.keys(args).length || remaining) continue;
    const normalized = normalizeToolCallObject({ name: match[1].trim(), arguments: args }, knownTools);
    if (!normalized) continue;
    calls.push(makeToolCall(normalized.name, normalized.args));
    removals.push({ start: match.index, end: match.index + match[0].length });
  }
  if (!removals.length) return { calls: [], cleanedText: text };
  let cleanedText = text;
  for (const span of removals.reverse()) cleanedText = cleanedText.slice(0, span.start) + cleanedText.slice(span.end);
  return { calls, cleanedText: cleanedText.replace(/\n{3,}/g, '\n\n').trim() };
}

function tryParseJson(raw: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, value: null };
  }
}

/**
 * Detect only an unmistakable registered-tool envelope that was cut off
 * before its closing JSON delimiter. Ordinary incomplete JSON remains prose.
 */
function looksLikeTruncatedKnownToolEnvelope(text: string, knownTools: Set<string> | null): boolean {
  if (!knownTools || !knownTools.size) return false;
  const trimmed = text.trim();
  if (!/^[\[{]/.test(trimmed) || /[\]}]$/.test(trimmed)) return false;
  const names = [...knownTools]
    .filter(name => /^[A-Za-z0-9_-]+$/.test(name))
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!names.length) return false;
  const pattern = names.join('|');
  return new RegExp(`["'](?:name|tool)["']\\s*:\\s*["'](?:${pattern})["']`, 'i').test(trimmed);
}

/** True when the value consists ONLY of tool-call objects (no prose). */
function looksLikeToolCallOnly(value: unknown, knownTools: Set<string> | null): boolean {
  const arr = Array.isArray(value) ? value : [value];
  if (arr.length === 0) return false;
  return arr.every((item) => normalizeToolCallObject(item, knownTools) !== null);
}

/**
 * Collects calls from a parsed JSON value. When `mustBePure` is true the value
 * must be entirely tool-call shaped for anything to be collected (used for bare
 * in-text objects so we never mangle legitimate JSON the model is explaining).
 * Returns true when calls were collected.
 */
function collectCalls(
  value: unknown,
  knownTools: Set<string> | null,
  out: ToolCall[],
  remove: () => void,
  mustBePure = false
): boolean {
  const items = Array.isArray(value) ? value : [value];
  const found: Array<{ name: string; args: Record<string, any> }> = [];
  for (const item of items) {
    const call = normalizeToolCallObject(item, knownTools);
    if (call) found.push(call);
  }
  if (found.length === 0) return false;
  // Never execute only part of a proposed batch: an unknown or malformed
  // entry must not result in earlier filesystem writes.
  if (found.length !== items.length) return false;
  for (const f of found) out.push(makeToolCall(f.name, f.args));
  remove();
  return true;
}

/* ------------------------------------------------------------------ */
/* Chat stream sanitizer                                               */
/* ------------------------------------------------------------------ */

/** Fenced code blocks longer than this are hidden from Chat. */
const MAX_CHAT_CODE_LINES = 12;

const HIDDEN_CODE_NOTE = (lines: number, lang: string) =>
  `_[${lines}-line ${lang || 'code'} block written to the workspace — open it in the Editor]_`;

/**
 * Sanitizes a COMPLETE model text for display in Chat:
 *  - removes tool-call JSON (any name+args shape),
 *  - replaces oversized fenced code blocks with a one-line note.
 */
export function sanitizeChatText(text: string, knownTools: Set<string> | null, options: { hideCodeBlocks?: boolean } = {}): string {
  if (!text) return text;
  const { cleanedText } = extractToolCallsFromText(text, knownTools);
  let out = cleanedText;

  // Replace oversized fenced code blocks with a compact note.
  out = out.replace(/```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    if (options.hideCodeBlocks) return '_[Code block withheld from Agent chat.]_';
    const lines = code.replace(/\n$/, '').split('\n').length;
    if (lines > MAX_CHAT_CODE_LINES) {
      return HIDDEN_CODE_NOTE(lines, lang);
    }
    return `\`\`\`${lang}\n${code}\`\`\``;
  });

  if (options.hideCodeBlocks) {
    const source = findUnfencedSourceSpan(out);
    if (source) out = `${out.slice(0, source.start)}_[Unfenced source withheld from Agent chat.]_${out.slice(source.end)}`;
  }

  return out.trim();
}

/**
 * Incremental sanitizer for STREAMING tokens. The model streams text token by
 * token; this filter holds back anything inside a fenced code block or a
 * potential tool-call JSON blob and only releases text that is safe for Chat.
 * Small fences are flushed when they close; large ones become a one-line note.
 */
export class ChatStreamFilter {
  private buffer = '';
  private inFence = false;
  private fenceLang = '';
  private fenceLines: string[] = [];
  private rawCodeLines: string[] = [];
  private inXmlToolCall = false;
  private finished = false;

  private knownTools: Set<string> | null;
  private hideCodeBlocks: boolean;
  constructor(knownTools: Set<string> | null, options: { hideCodeBlocks?: boolean } = {}) {
    this.knownTools = knownTools;
    this.hideCodeBlocks = options.hideCodeBlocks === true;
  }

  /** Feed one streaming token; returns the safe text to display in Chat. */
  push(token: string): string {
    if (this.finished || !token) return '';
    this.buffer += token;

    // Process complete lines only — fences and JSON need whole lines.
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    let emit = '';
    for (const line of lines) {
      emit += this.handleLine(line);
    }
    return emit;
  }

  /** Call when the model stream ends. Flushes anything still held back. */
  flush(): string {
    if (this.finished) return '';
    this.finished = true;
    let emit = '';
    if (this.buffer) {
      emit += this.handleLine(this.buffer);
      this.buffer = '';
    }
    if (this.inFence) {
      // Model never closed the fence — treat it as hidden code.
      emit += this.hideCodeBlocks ? '_[Code block withheld from Agent chat.]_' : HIDDEN_CODE_NOTE(this.fenceLines.length, this.fenceLang);
      this.inFence = false;
    }
    if (this.rawCodeLines.length) {
      const raw = this.rawCodeLines.join('\n');
      const source = findUnfencedSourceSpan(raw);
      emit += source
        ? `${raw.slice(0, source.start)}_[Unfenced source withheld from Agent chat.]_${raw.slice(source.end)}`
        : raw;
      if (emit && !emit.endsWith('\n')) emit += '\n';
      this.rawCodeLines = [];
    }
    return emit;
  }

  private handleLine(line: string): string {
    if (this.inFence) {
      if (/^\s*```/.test(line)) {
        // Fence closed
        this.inFence = false;
        const code = this.fenceLines.join('\n');
        // A fence whose whole content is a tool call is suppressed entirely.
        const trimmedCode = code.trim();
        if (
          trimmedCode.startsWith('{') ||
          trimmedCode.startsWith('[') ||
          this.fenceLang === 'tool' ||
          this.fenceLang === 'tools'
        ) {
          const parsed = tryParseJson(trimmedCode);
          if (parsed.ok && looksLikeToolCallOnly(parsed.value, this.knownTools)) {
            return '';
          }
        }
        if (this.hideCodeBlocks) return '_[Code block withheld from Agent chat.]_\n';
        if (this.fenceLines.length <= MAX_CHAT_CODE_LINES) {
          return '```' + this.fenceLang + '\n' + code + '\n```\n';
        }
        return HIDDEN_CODE_NOTE(this.fenceLines.length, this.fenceLang) + '\n';
      }
      this.fenceLines.push(line);
      return '';
    }

    if (this.rawCodeLines.length) {
      const raw = this.rawCodeLines.join('\n');
      if (isLikelyUnfencedSource(raw) && isNarrativeLine(line)) {
        this.rawCodeLines = [];
        return '_[Unfenced source withheld from Agent chat.]_\n' + line + '\n';
      }
      this.rawCodeLines.push(line);
      return '';
    }

    // Hold back legacy XML-shaped tool calls while the provider is streaming.
    // Without this state, a call that starts after prose on the same line can
    // leak its entire source file into Chat before the final parser runs.
    if (this.inXmlToolCall) {
      if (/<\/tool_call>/i.test(line)) this.inXmlToolCall = false;
      return '';
    }
    const xmlStart = line.search(/<tool_call>/i);
    if (xmlStart >= 0) {
      this.inXmlToolCall = !/<\/tool_call>/i.test(line.slice(xmlStart));
      const prefix = line.slice(0, xmlStart).trimEnd();
      return prefix ? prefix + '\n' : '';
    }

    if (/^\s*```/.test(line)) {
      this.inFence = true;
      this.fenceLang = line.replace(/^\s*```/, '').trim();
      this.fenceLines = [];
      return '';
    }

    if (this.hideCodeBlocks && isLikelyUnfencedSource(line)) {
      this.rawCodeLines = [line];
      return '';
    }

    // Suppress lines that are raw tool-call JSON.
    const trimmed = line.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = tryParseJson(trimmed);
      if (parsed.ok && looksLikeToolCallOnly(parsed.value, this.knownTools)) {
        return '';
      }
    }

    // <tool_call> lines are never chat content.
    if (/^\s*<tool_call>/.test(line)) return '';

    return line + '\n';
  }
}
