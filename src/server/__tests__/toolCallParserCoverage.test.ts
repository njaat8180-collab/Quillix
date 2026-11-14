import { describe, expect, it } from 'vitest';
import {
  ChatStreamFilter,
  classifyProviderText,
  extractCodeForKnownFile,
  extractExplicitCodeFileCalls,
  extractToolCallsFromText,
  sanitizeChatText,
} from '../toolCallParser.js';

const KNOWN_TOOLS = new Set([
  'read_file',
  'write_file',
  'create_file',
  'list_directory',
  'search_files',
]);

describe('toolCallParser text extraction', () => {
  it('leaves plain text unchanged', () => {
    const result = extractToolCallsFromText('Hello, no tools here.', KNOWN_TOOLS);
    expect(result.calls).toEqual([]);
    expect(result.cleanedText).toBe('Hello, no tools here.');
  });

  it('extracts a fenced JSON tool call', () => {
    const result = extractToolCallsFromText(
      'Working now.\n```json\n{"name":"write_file","arguments":{"filePath":"a.txt","content":"hello"}}\n```\nDone.',
      KNOWN_TOOLS,
    );
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({
      name: 'write_file',
      args: { filePath: 'a.txt', content: 'hello' },
    });
    expect(result.calls[0].id).toMatch(/^call_text_/);
    expect(result.cleanedText).toContain('Working now.');
    expect(result.cleanedText).toContain('Done.');
    expect(result.cleanedText).not.toContain('filePath');
  });

  it('extracts multiple calls from a JSON array', () => {
    const result = extractToolCallsFromText(
      '[{"name":"read_file","arguments":{"filePath":"a.txt"}},{"tool":"list_directory","dirPath":"src"}]',
      KNOWN_TOOLS,
    );
    expect(result.calls.map(call => call.name)).toEqual(['read_file', 'list_directory']);
    expect(result.calls[1].args).toEqual({ dirPath: 'src' });
    expect(result.cleanedText).toBe('');
  });

  it('extracts a native function envelope', () => {
    const result = extractToolCallsFromText(
      '{"function":{"name":"search_files","arguments":{"query":"needle"}}}',
      KNOWN_TOOLS,
    );
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].name).toBe('search_files');
    expect(result.calls[0].args).toEqual({ query: 'needle' });
  });

  it('accepts JSON-encoded argument strings', () => {
    const result = extractToolCallsFromText(
      '{"name":"read_file","arguments":"{\\"filePath\\":\\"a.txt\\"}"}',
      KNOWN_TOOLS,
    );
    expect(result.calls[0].args).toEqual({ filePath: 'a.txt' });
  });

  it('rejects malformed JSON in a tool-tag wrapper', () => {
    expect(() => extractToolCallsFromText(
      '<tool_call>{"name":"read_file",}</tool_call>',
      KNOWN_TOOLS,
    )).toThrow(/Malformed <tool_call> JSON/);
  });

  it('rejects malformed JSON in a tool code fence', () => {
    expect(() => extractToolCallsFromText(
      '```tool\n{"name":"read_file",}\n```',
      KNOWN_TOOLS,
    )).toThrow(/Malformed tool block JSON/);
  });

  it('fails closed on a malformed tool envelope written inside a json fence', () => {
    // A small local model can emit a tool call whose JSON string contains raw
    // newlines. The envelope is unparseable, and it must never reach the
    // code-file routing that would write the raw JSON into the workspace.
    const malformed = '```json\n{"name": "write_file", "arguments": {"content": "body {\n  color: red;\n}", "filePath": "style.css"}}\n```';
    expect(() => extractToolCallsFromText(malformed, KNOWN_TOOLS)).toThrow(/Malformed tool-call JSON/);
  });

  it('never routes a fenced tool-call envelope into a workspace file write', () => {
    const envelope = '```json\n{"name": "write_file", "arguments": {"filePath": "style.css", "content": "body {}"}}\n```';
    const routed = extractExplicitCodeFileCalls(`style.css:\n${envelope}`);
    expect(routed.calls).toEqual([]);
    expect(routed.cleanedText).toContain('write_file');
  });

  it('still routes ordinary labelled source code into a file', () => {
    const routed = extractExplicitCodeFileCalls('style.css:\n```css\nbody { color: red; }\n```');
    expect(routed.calls).toHaveLength(1);
    expect(routed.calls[0].args.filePath).toBe('style.css');
    expect(routed.calls[0].args.content).toContain('color: red');
  });

  it('ignores unknown tool names', () => {
    const result = extractToolCallsFromText(
      '{"name":"not_registered","arguments":{"filePath":"a.txt"}}',
      KNOWN_TOOLS,
    );
    expect(result.calls).toEqual([]);
    expect(result.cleanedText).toContain('not_registered');
  });

  it('rejects a known tool with missing arguments', () => {
    expect(() => extractToolCallsFromText(
      '{"name":"read_file"}',
      KNOWN_TOOLS,
    )).toThrow(/Missing arguments for tool read_file/);
  });

  it('rejects non-object arguments', () => {
    expect(() => extractToolCallsFromText(
      '{"name":"read_file","arguments":42}',
      KNOWN_TOOLS,
    )).toThrow(/Invalid object arguments for tool read_file/);
  });

  it('normalizes aliases without coercing argument value types', () => {
    const result = extractToolCallsFromText(
      '{"tool":"file_write","arguments":{"path":"a.txt","count":3,"enabled":false,"items":[1,2],"options":{"mode":"fast"}}}',
      KNOWN_TOOLS,
    );
    expect(result.calls[0].name).toBe('write_file');
    expect(result.calls[0].args).toEqual({
      filePath: 'a.txt',
      count: 3,
      enabled: false,
      items: [1, 2],
      options: { mode: 'fast' },
    });
    expect(typeof result.calls[0].args.count).toBe('number');
    expect(typeof result.calls[0].args.enabled).toBe('boolean');
    expect(Array.isArray(result.calls[0].args.items)).toBe(true);
  });

  it('supports legacy XML-style calls', () => {
    const result = extractToolCallsFromText(
      '<tool_call>write_file<arg_key>filePath</arg_key><arg_value>a.txt</arg_value><arg_key>content</arg_key><arg_value>hello</arg_value></tool_call>',
      KNOWN_TOOLS,
    );
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].args).toEqual({ filePath: 'a.txt', content: 'hello' });
  });

  it('detects a truncated known tool envelope', () => {
    expect(() => extractToolCallsFromText(
      '{"name":"read_file","arguments":',
      KNOWN_TOOLS,
    )).toThrow(/Malformed or truncated tool-call JSON/);
  });
});

describe('toolCallParser provider text helpers', () => {
  it('classifies plain, error, and tool-call text', () => {
    expect(classifyProviderText('')).toEqual([]);
    expect(classifyProviderText('The build failed')).toEqual([{ kind: 'error', content: 'The build failed' }]);
    expect(classifyProviderText('{"name":"read_file"}')[0].kind).toBe('tool_call');
  });

  it('extracts an explicitly labelled source file', () => {
    const result = extractExplicitCodeFileCalls(
      'src/app.ts:\n```ts\nexport const value = 1;\n```',
    );
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].args).toEqual({
      filePath: 'src/app.ts',
      content: 'export const value = 1;\n',
    });
    expect(result.cleanedText).not.toContain('export const');
  });

  it('routes a single known-file code block and rejects ambiguous blocks', () => {
    const routed = extractCodeForKnownFile('```html\n<main>Hello</main>\n```', 'index.html');
    expect(routed.calls).toHaveLength(1);
    expect(routed.calls[0].args.filePath).toBe('index.html');
    expect(extractCodeForKnownFile('```html\none</html>\n```\n```css\ntwo</css>\n```', 'index.html').calls).toEqual([]);
    expect(extractCodeForKnownFile('```js\nconst a = 1;\n```', 'invalid.txt').calls).toEqual([]);
  });

  it('sanitizes tool calls and hides code blocks', () => {
    const sanitized = sanitizeChatText(
      'Visible\n{"name":"read_file","arguments":{"filePath":"a.txt"}}\n```js\nconst secret = 1;\n```',
      KNOWN_TOOLS,
      { hideCodeBlocks: true },
    );
    expect(sanitized).toContain('Visible');
    expect(sanitized).not.toContain('filePath');
    expect(sanitized).not.toContain('const secret');
    expect(sanitized).toContain('withheld');
  });

  it('filters streamed tool calls and code fences', () => {
    const filter = new ChatStreamFilter(KNOWN_TOOLS, { hideCodeBlocks: true });
    const output = filter.push('Visible\n') +
      filter.push('{"name":"read_file","arguments":{"filePath":"a.txt"}}\n') +
      filter.push('```js\nconst secret = 1;\n```\n');
    expect(output).toContain('Visible');
    expect(output).not.toContain('filePath');
    expect(output).not.toContain('const secret');
    expect(filter.flush()).toContain('withheld');
  });
});
