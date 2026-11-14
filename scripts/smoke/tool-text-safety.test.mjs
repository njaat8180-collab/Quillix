/** Dependency-free text-tool parser regression for Node >=22.16. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = fs.mkdtempSync(path.join(tmpdir(), 'quillix-text-calls-'));
fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
for (const mod of ['toolAliases', 'toolCallParser']) {
  const ts = fs.readFileSync(path.join(root, 'src', 'server', `${mod}.ts`), 'utf8');
  fs.writeFileSync(path.join(temp, `${mod}.js`), stripTypeScriptTypes(ts, {mode:'strip'}));
}
after(() => fs.rmSync(temp,{recursive:true,force:true}));
const { extractToolCallsFromText } = await import(pathToFileURL(path.join(temp, 'toolCallParser.js')).href);
const toolNames = new Set(['write_file','read_file','run_command']);

test('model-emitted tool JSON makes a validated write-file call with normalized aliases', () => {
  const r = extractToolCallsFromText('<tool_call>{"name":"file_write","arguments":{"path":"index.html","content":"hello"}}</tool_call>',toolNames);
  assert.equal(r.calls.length,1);
  assert.equal(r.calls[0].name,'write_file');
  assert.deepEqual(r.calls[0].args,{filePath:'index.html',content:'hello'});
  assert.equal(r.cleanedText,'');
});

test('reject malformed nested JSON instead of generating tool calls with empty args', () => {
  const raw = '{"name":"write_file","arguments":"{broken json}"}';
  assert.throws(() => extractToolCallsFromText(raw,toolNames), /Invalid JSON arguments/);
});

test('reject missing args, arrays, and scalar tool arguments', () => {
  for (const raw of [
    '{"name":"write_file"}',
    '{"name":"write_file","arguments":[]}',
    '{"name":"write_file","arguments":"null"}',
    '{"name":"write_file","arguments":"5"}',
    '{"name":"write_file","arguments":"oops"}',
  ]) assert.throws(() => extractToolCallsFromText(raw,toolNames), /(Invalid|Missing).*arguments/,raw);
});

test('nested function tool call validates arguments and canonicalizes aliases', () => {
  // Normal JSON encoding avoids double-escape errors in test fixtures.
  const raw = JSON.stringify({function:{name:'file_write',arguments:JSON.stringify({path:'style.css',content:'body{}'})}});
  const parsed=extractToolCallsFromText(raw,toolNames);
  assert.equal(parsed.calls.length,1);
  assert.deepEqual(parsed.calls[0].args,{filePath:'style.css',content:'body{}'});
  const malformed=JSON.stringify({function:{name:'write_file',arguments:'[1,2]'}});
  assert.throws(() => extractToolCallsFromText(malformed,toolNames), /Invalid object arguments/);
});

test('ordinary JSON documents must not be mistaken for actions', () => {
  const raw='{"name":"project","version":"1.0.0"}';
  const r=extractToolCallsFromText(raw,toolNames);
  assert.equal(r.calls.length,0);
  assert.equal(r.cleanedText,raw);
});


test('tool-key format with malformed nested arguments never falls back to an empty action', () => {
  for (const raw of [
    JSON.stringify({tool:'write_file',arguments:'{bad json'}),
    JSON.stringify({tool:'write_file',arguments:'[]'}),
    JSON.stringify({tool:'write_file',args:3}),
    JSON.stringify({tool:'write_file'}),
  ]) {
    assert.throws(() => extractToolCallsFromText(raw,toolNames), /(Invalid|Missing).*arguments/,raw);
  }
});

test('tool-key shorthand still works with explicit file arguments', () => {
  const raw=JSON.stringify({tool:'file_write',filePath:'app.js',content:'console.log(1)'});
  const r=extractToolCallsFromText(raw,toolNames);
  assert.equal(r.calls.length,1);
  assert.deepEqual(r.calls[0].args,{filePath:'app.js',content:'console.log(1)'});
});

test('mixed valid and invalid wrapped tool calls are rejected atomically', () => {
  const inner=JSON.stringify([
    {name:'write_file',arguments:{filePath:'a.js',content:'ok'}},
    {name:'write_file',arguments:'{broken'},
  ]);
  for (const raw of [`<tool_call>${inner}</tool_call>`,`\`\`\`json\n${inner}\n\`\`\``]) {
    assert.throws(() => extractToolCallsFromText(raw,toolNames), /Invalid JSON arguments/,raw);
  }
});
