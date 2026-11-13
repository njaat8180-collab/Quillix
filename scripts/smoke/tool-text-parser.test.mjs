/** Tool calls embedded in LLM text: reject unsafe arguments before executing anything. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// Dependency-free Node smoke test: strip TS in a disposable directory, and
// preserve ordinary compiled .js imports without changing production source.
const sourceDir = resolve(fileURLToPath(new URL('../../src/server/', import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'quillix-text-tools-'));
const alias = stripTypeScriptTypes(readFileSync(join(sourceDir, 'toolAliases.ts'), 'utf8'), { mode: 'strip' });
const parser = stripTypeScriptTypes(readFileSync(join(sourceDir, 'toolCallParser.ts'), 'utf8'), { mode: 'strip' })
  .replace("from './toolAliases.js'", "from './toolAliases.mjs'");
writeFileSync(join(dir, 'toolAliases.mjs'), alias);
writeFileSync(join(dir, 'toolCallParser.mjs'), parser);
process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
const { extractToolCallsFromText, ChatStreamFilter } = await import(pathToFileURL(join(dir, 'toolCallParser.mjs')).href);

const known = new Set(['write_file', 'read_file']);

test('text tool call with object arguments is extracted', () => {
  const parsed = extractToolCallsFromText('<tool_call>{"name":"write_file","arguments":{"filePath":"index.html","content":"ok"}}</tool_call>', known);
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].args.filePath, 'index.html');
  assert.equal(parsed.cleanedText, '');
});

test('text tool call with JSON-string arguments is extracted', () => {
  const src = JSON.stringify({name:'write_file',arguments:JSON.stringify({filePath:'x.js',content:'ok'})});
  assert.equal(extractToolCallsFromText(src,known).calls[0].args.filePath,'x.js');
});

test('legacy XML arg_key/arg_value tool calls are extracted safely', () => {
  const raw = 'I will create the file. <tool_call>write_file<arg_key>filePath</arg_key><arg_value>index.html</arg_value><arg_key>content</arg_key><arg_value><!doctype html>\\n<h1>Hello</h1></arg_value></tool_call>';
  const parsed = extractToolCallsFromText(raw, known);
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0].name, 'write_file');
  assert.equal(parsed.calls[0].args.filePath, 'index.html');
  assert.match(parsed.calls[0].args.content, /Hello/);
  assert.equal(parsed.cleanedText, 'I will create the file.');
});

test('truncated legacy XML tool calls fail closed and remain visible for a retry nudge', () => {
  const raw = '<tool_call>write_file<arg_key>filePath</arg_key><arg_value>index.html</arg_value><arg_key>content</arg_key><arg_value><main>';
  const parsed = extractToolCallsFromText(raw, known);
  assert.equal(parsed.calls.length, 0);
  assert.equal(parsed.cleanedText, raw);
});

test('streaming sanitizer hides XML tool-call source after same-line prose', () => {
  const filter = new ChatStreamFilter(known);
  const visible = filter.push('I will create it. <tool_call>write_file<arg_key>filePath</arg_key>\n') +
    filter.push('<arg_value>index.html</arg_value><arg_key>content</arg_key>\n') +
    filter.push('<arg_value><h1>secret source</h1></arg_value></tool_call>');
  assert.equal(visible, 'I will create it.\n');
  assert.equal(filter.flush(), '');
});

test('text tool call rejects malformed string arguments rather than default {}', () => {
  const src = JSON.stringify({name:'write_file',arguments:'{"filePath":"x",'});
  assert.throws(() => extractToolCallsFromText(src,known), /Invalid JSON arguments/);
});

test('text tool call rejects array, null and scalar arguments', () => {
  for (const argumentsValue of [[],null,42,true]) {
    const src = JSON.stringify({name:'write_file',arguments:argumentsValue});
    assert.throws(() => extractToolCallsFromText(src,known), /Invalid object arguments/);
  }
});

test('text tool call rejects malformed nested function arguments', () => {
  const src = JSON.stringify({function:{name:'write_file',arguments:'no-json'}});
  assert.throws(() => extractToolCallsFromText(src,known), /Invalid JSON arguments/);
});

test('invalid call in a list prevents returning the preceding valid write', () => {
  const src = JSON.stringify([
    {name:'write_file',arguments:{filePath:'index.html',content:'ok'}},
    {name:'write_file',arguments:'bad-json'},
  ]);
  assert.throws(() => extractToolCallsFromText('```json\n'+src+'\n```',known), /Invalid JSON arguments/);
});

test('ordinary JSON and unknown tools are not executed', () => {
  const src = '{"name":"unrecognized_tool","arguments":{"value":"x"}}';
  assert.equal(extractToolCallsFromText(src,known).calls.length, 0);
  assert.equal(extractToolCallsFromText('{"message":"hello"}',known).calls.length, 0);
});


test('bare JSON array of valid tools is parsed as one atomic batch', () => {
  const src = JSON.stringify([
    {name:'write_file',arguments:{filePath:'a.txt',content:'A'}},
    {name:'write_file',arguments:{filePath:'b.txt',content:'B'}},
  ]);
  const result = extractToolCallsFromText(src,known);
  assert.deepEqual(result.calls.map(c => c.args.filePath), ['a.txt','b.txt']);
  assert.equal(result.cleanedText,'');
});

test('mixed valid and unknown tool calls in bare or fenced arrays execute nothing', () => {
  const src = JSON.stringify([
    {name:'write_file',arguments:{filePath:'a.txt',content:'A'}},
    {name:'unregistered',arguments:{filePath:'b.txt',content:'B'}},
  ]);
  for (const raw of [src,'```json\n'+src+'\n```','<tool_call>'+src+'</tool_call>']) {
    const result = extractToolCallsFromText(raw,known);
    assert.equal(result.calls.length, 0,raw);
    assert.equal(result.cleanedText,raw);
  }
});

test('JSON in unrelated JavaScript fence is not treated as an executable tool call', () => {
  const raw = '```js\nconst example = '+JSON.stringify({name:'write_file',arguments:{filePath:'a.txt',content:'A'}})+';\n```';
  const result = extractToolCallsFromText(raw,known);
  assert.equal(result.calls.length,0);
});

test('malformed explicit tool-call tag aborts before any actions', () => {
  assert.throws(() => extractToolCallsFromText('<tool_call>{invalid}</tool_call>',known),/Malformed <tool_call> JSON/);
});

test('truncated bare registered tool JSON fails closed instead of becoming prose', () => {
  const raw = '{"name":"write_file","arguments":{"filePath":"index.html","content":"<main>"';
  assert.throws(() => extractToolCallsFromText(raw, known), /Malformed or truncated tool-call JSON/);
});

test('truncated ordinary JSON remains prose', () => {
  const raw = '{"name":"example","value":"unfinished"';
  const result = extractToolCallsFromText(raw, known);
  assert.equal(result.calls.length, 0);
  assert.equal(result.cleanedText, raw);
});
