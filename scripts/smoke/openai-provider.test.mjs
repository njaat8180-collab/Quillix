import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';

// Self-contained contract test: uses no real API credits and never stores a
// plaintext key. The Windows DPAPI round-trip must be checked on Windows.
const root = path.resolve(import.meta.dirname, '../..');
const smokeTemp = path.join(root, '.quillix-smoke');
fs.mkdirSync(smokeTemp, { recursive: true });
const temp = fs.mkdtempSync(path.join(smokeTemp, 'openai-test-'));
fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({type:'module'}));
// settings.ts normally resolves this shared runtime module from src/server.
// The contract test intentionally copies only the provider graph into an
// isolated fixture, so preserve that dependency beside the copied modules.
fs.mkdirSync(path.join(temp, 'shared'), { recursive: true });
const modelDefaults = fs.readFileSync(path.join(root, 'src/shared/modelDefaults.ts'), 'utf8');
fs.writeFileSync(path.join(temp, 'shared', 'modelDefaults.js'), stripTypeScriptTypes(modelDefaults, { mode: 'transform' }));
const providerPresets = fs.readFileSync(path.join(root, 'src/shared/providerPresets.ts'), 'utf8');
fs.writeFileSync(path.join(temp, 'shared', 'providerPresets.js'), stripTypeScriptTypes(providerPresets, { mode: 'transform' }));
const providerPacing = fs.readFileSync(path.join(root, 'src/shared/providerPacing.ts'), 'utf8');
fs.writeFileSync(path.join(temp, 'shared', 'providerPacing.js'), stripTypeScriptTypes(providerPacing, { mode: 'transform' }));
// universal.ts reads the shared Overdrive flag so its pacing/cooldown bypasses
// follow live settings; keep that dependency beside the copied modules too.
const overdriveState = fs.readFileSync(path.join(root, 'src/shared/overdriveState.ts'), 'utf8');
fs.writeFileSync(path.join(temp, 'shared', 'overdriveState.js'), stripTypeScriptTypes(overdriveState, { mode: 'transform' }));
// providerKeyRotation is imported by universal.ts for multi-key failover and
// must be present in this isolated fixture as well.
for (const filename of ['sarvam', 'resourceGuard', 'brainRegistry', 'universal', 'openai', 'settings', 'providerStream', 'providerProfiles', 'rateLimitService', 'promptCache', 'providerKeyRotation']) {
  let source = fs.readFileSync(path.join(root, 'src/server', `${filename}.ts`), 'utf8');
  source = source.replaceAll("../shared/providerPacing.js", "./shared/providerPacing.js").replaceAll("../shared/overdriveState.js", "./shared/overdriveState.js");
  if (filename === 'settings') {
    source = source
      .replaceAll("../shared/modelDefaults.js", "./shared/modelDefaults.js")
      .replaceAll("../shared/providerPresets.js", "./shared/providerPresets.js");
  }
  // Never read a user's real stored credential in a mocked API test.
  if(filename==='openai') source=source.replace("path.join(os.homedir(), '.quillix', 'openai-key.dpapi.json')",JSON.stringify(path.join(temp,'openai-key.dpapi.json')));
  fs.writeFileSync(path.join(temp, `${filename}.js`), stripTypeScriptTypes(source, {mode:'transform'}));
}
// ProviderRouter's dedicated-provider path lazily imports model failover. Keep
// that complete lazy import graph in this isolated fixture as well.
for (const filename of ['providerModelFailover', 'nimModels', 'providerModelCatalog']) {
  const source = fs.readFileSync(path.join(root, 'src/server', `${filename}.ts`), 'utf8');
  fs.writeFileSync(path.join(temp, `${filename}.js`), stripTypeScriptTypes(source, { mode: 'transform' }));
}
const providerModels = fs.readFileSync(path.join(root, 'src/shared/providerModels.ts'), 'utf8');
fs.writeFileSync(path.join(temp, 'shared', 'providerModels.js'), stripTypeScriptTypes(providerModels, { mode: 'transform' }));
// Dedicated providers share the encrypted failover-pool helper. Keep the
// isolated fixture dependency-complete so this contract test exercises the
// same import graph as the production bundle.
const encryptedPoolSource = fs.readFileSync(path.join(root, 'src/server/encryptedKeyPool.ts'), 'utf8');
fs.writeFileSync(path.join(temp, 'encryptedKeyPool.js'), stripTypeScriptTypes(encryptedPoolSource, {mode:'transform'}));
const { createOpenAIProvider, normalizeOpenAIModel, readOpenAIKey, hasOpenAIKey, saveOpenAIKey, OPENAI_API_ENDPOINT } = await import(pathToFileURL(path.join(temp,'openai.js')).href);
const { ProviderRouter } = await import(pathToFileURL(path.join(temp,'sarvam.js')).href);
const { SettingsStore } = await import(pathToFileURL(path.join(temp,'settings.js')).href);
const originalFetch = globalThis.fetch;
const oldOpenAI = process.env.OPENAI_API_KEY;
const oldUniversal = process.env.QUILLIX_UNIVERSAL_API_KEY;
const settings = {openaiModel:'gpt-6-astra',aiProvider:'openai',offlineMode:false};
const create = () => createOpenAIProvider(() => settings);
const calls = [];
const setFetch = response => {
  globalThis.fetch = async (url, init) => {
    calls.push({url:String(url), method:init.method, headers:init.headers, redirect:init.redirect, body:JSON.parse(init.body)});
    return {ok:true,json:async()=>response};
  };
};
const tool = [{name:'write_file',description:'Create a file',parameters:{type:'object',properties:{filePath:{type:'string'},content:{type:'string'}},required:['filePath','content']}}];
const user = [{role:'user',content:'Create index.html and verify it.'}];

// Override any externally inherited developer key for deterministic tests.
process.env.OPENAI_API_KEY='openai-test-secret-not-real';
process.env.QUILLIX_UNIVERSAL_API_KEY='universal-test-secret-not-real';
test.after(() => {
  globalThis.fetch = originalFetch;
  if (oldOpenAI===undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY=oldOpenAI;
  if (oldUniversal===undefined) delete process.env.QUILLIX_UNIVERSAL_API_KEY;
  else process.env.QUILLIX_UNIVERSAL_API_KEY=oldUniversal;
  fs.rmSync(temp,{recursive:true,force:true});
});

test('Dedicated OpenAI uses official Responses endpoint and its own secret',async()=>{
  setFetch({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'OK'}]}]});
  assert.equal(OPENAI_API_ENDPOINT,'https://api.openai.com/v1');
  assert.equal(await create().generateText('Ping',{maxOutputTokens:512}),'OK');
  const req=calls.at(-1);
  assert.equal(req.url,'https://api.openai.com/v1/responses');
  assert.equal(req.headers.Authorization,'Bearer openai-test-secret-not-real');
  assert.notEqual(req.headers.Authorization,'Bearer '+process.env.QUILLIX_UNIVERSAL_API_KEY);
  assert.equal(req.redirect,'error');
  assert.equal(req.body.model,'gpt-6-astra');
  assert.equal(req.body.max_output_tokens,512);
  assert.equal(req.body.input[0].content,'Ping');
});

test('OpenAI strips an accidental provider prefix from the model ID',()=>{
  assert.equal(normalizeOpenAIModel(' openai/gpt-6-astra '),'gpt-6-astra');
  assert.equal(normalizeOpenAIModel('gpt-6-astra'),'gpt-6-astra');
});

test('OpenAI tool call and tool output roundtrip uses correct Responses schema',async()=>{
  setFetch({status:'completed',output:[{type:'function_call',call_id:'call_1',name:'write_file',arguments:'{"filePath":"index.html","content":"Hello World"}'}]});
  const first=await create().chatWithTools(user,tool);
  assert.equal(first.toolCalls[0].name,'write_file');
  assert.equal(first.toolCalls[0].args.filePath,'index.html');
  assert.equal(calls.at(-1).body.tools[0].name,'write_file');
  assert.equal(calls.at(-1).body.tools[0].type,'function');
  setFetch({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Verified'}]}]});
  const result=await create().chatWithTools([...user,{role:'assistant',content:'',toolCalls:first.toolCalls},{role:'tool',toolCallId:'call_1',name:'write_file',content:'File created'}],tool);
  assert.equal(result.text,'Verified');
  assert.equal(calls.at(-1).body.input.at(-1).type,'function_call_output');
  assert.equal(calls.at(-1).body.input.at(-1).call_id,'call_1');
});

test('ProviderRouter dispatches agent text requests to selected OpenAI provider',async()=>{
  setFetch({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'OpenAI answered'}]}]});
  const noop={generateText:async()=>{throw new Error('Ollama must not be called');}};
  const router=new ProviderRouter(noop,{get:()=>settings});
  assert.equal(await router.generateText('Test router'),'OpenAI answered');
  assert.equal(calls.at(-1).url,'https://api.openai.com/v1/responses');
});

test('OpenAI model ID is saved and survives settings reload without secrets',()=>{
  const file=path.join(temp,'model-settings.json');
  const store=new SettingsStore(file);
  const saved=store.update({aiProvider:'openai',openaiModel:'gpt-6-luna',offlineMode:false});
  assert.equal(saved.success,true,saved.error);
  const loaded=new SettingsStore(file).get();
  assert.equal(loaded.aiProvider,'openai');
  assert.equal(loaded.openaiModel,'gpt-6-luna');
  assert.ok(!fs.readFileSync(file,'utf8').includes('openai-test-secret'));
  const invalid=store.update({openaiModel:'bad\r\nheader'});
  assert.equal(invalid.success,false);
  assert.equal(store.get().openaiModel,'gpt-6-luna');
});

test('Offline Mode blocks OpenAI even with a configured key',async()=>{
  const count=calls.length;
  const blocked=createOpenAIProvider(()=>({...settings,offlineMode:true}));
  await assert.rejects(blocked.generateText('Ping'),/Offline Mode/);
  assert.equal(calls.length,count);
});

test('Missing OpenAI key blocks without borrowing Universal credentials',async()=>{
  delete process.env.OPENAI_API_KEY;
  const count=calls.length;
  assert.equal(hasOpenAIKey(),false);
  await assert.rejects(create().generateText('Ping'),/API key/);
  assert.equal(calls.length,count);
  process.env.OPENAI_API_KEY='openai-test-secret-not-real';
  assert.equal(readOpenAIKey(),'openai-test-secret-not-real');
});

test('Empty, incomplete and invalid tool responses are rejected',async()=>{
  setFetch({status:'incomplete',output:[{type:'function_call',call_id:'call_1',name:'write_file',arguments:'{}'}]});
  await assert.rejects(create().chatWithTools(user,tool),/did not complete/);
  setFetch({status:'completed',output:[]});
  await assert.rejects(create().generateText('Ping'),/no text or tool calls/);
  setFetch({status:'completed',output:[{type:'function_call',call_id:'call_1',name:'write_file',arguments:'{bad JSON'}]});
  await assert.rejects(create().chatWithTools(user,tool),/invalid tool-call JSON/);
});

test('OpenAI error does not echo HTTP response body or API key',async()=>{
  globalThis.fetch=async()=>({ok:false,status:401,json:async()=>({error:{message:'server reflection openai-test-secret-not-real'}})});
  await assert.rejects(create().generateText('Ping'),e=> e.message.includes('HTTP 401') && !e.message.includes('openai-test-secret-not-real'));
});

test('Non-Windows builds refuse insecure plaintext key saving',()=>{
  if (process.platform==='win32') return;
  assert.throws(()=>saveOpenAIKey('fake-key-not-real'),/Windows|DPAPI|secure/i);
  assert.equal(hasOpenAIKey(),true); // environment override remains usable for mock testing
});
