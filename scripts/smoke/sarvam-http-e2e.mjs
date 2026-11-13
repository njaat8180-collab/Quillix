/** Real Quillix server + mock Sarvam API + real workspace file write. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'quillix-sarvam-mock-e2e-'));
const workspace = path.join(tmp,'workspace'); fs.mkdirSync(workspace);
let child;
let stderr = '';
async function port(){return new Promise((res,rej)=>{const s=net.createServer();s.once('error',rej);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p));});});}
function api(base,route,method='GET',body){return fetch(base+route,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(35000)});}
async function valid(response){const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;}
try {
  const p=await port(), base=`http://127.0.0.1:${p}`;
  // Keep this deterministic even when the developer machine has a real
  // encrypted Sarvam credential: production correctly prefers that credential
  // over an environment fallback, so the mock gets an isolated profile.
  child=spawn(process.execPath,['scripts/smoke/launchSarvamMockBackend.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'production',PORT:String(p),SARVAM_API_KEY:'test-only-sarvam-key',QUILLIX_SETTINGS_PATH:path.join(tmp,'settings.json'),HOME:tmp,USERPROFILE:tmp},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',buf=>{stderr+=buf.toString();});
  let ready=false;
  for(let i=0;i<65;i++){try{if((await api(base,'/api/health')).ok){ready=true;break;}}catch{}await delay(200);}
  assert.ok(ready,`Quillix server could not start: ${stderr.slice(-500)}`);
  await valid(await api(base,'/api/settings','PUT',{aiProvider:'sarvam',offlineMode:false,autoApplyDiffs:true,terminalApproval:true,maxAutonomousTurns:10}));
  await valid(await api(base,'/api/workspace/set-root','POST',{targetPath:workspace}));
  const test=await valid(await api(base,'/api/providers/sarvam/test','POST'));
  assert.equal(test.status,'connected');
  const r=await api(base,'/api/agent/run','POST',{userPrompt:'Create a index.html page with hello world heading and animated temples in background',mode:'agent',conversationMode:'agent',conversationHistory:[]});
  if (r.status !== 200) throw new Error(`Agent endpoint HTTP ${r.status}: ${await r.text()}`);
  const events=(await r.text()).split('\n\n').filter(x=>x.startsWith('data: ')).map(x=>{try{return JSON.parse(x.slice(6));}catch{return null;}}).filter(Boolean);
  const done=events.find(x=>x.event==='done');
  assert.ok(done,JSON.stringify(events.slice(-3)));
  const file=path.join(workspace,'index.html');
  assert.ok(fs.existsSync(file),`Sarvam mock completed without index.html; workspace: ${fs.readdirSync(workspace).join(',')}`);
  const html=fs.readFileSync(file,'utf8');
  assert.match(html, /Hello World/);assert.match(html,/animation/);
  assert.ok(done.result.toolCalls.some(c=>c.name==='write_file'));
  console.log('PASS - real backend Sarvam health endpoint via mock API');
  console.log('PASS - Sarvam native tool call executed and index.html written to workspace');
} catch(e){console.error('SARVAM HTTP E2E FAIL:',e);console.error(stderr.slice(-2000));process.exitCode=1;}
finally{try{child?.kill();}catch{}fs.rmSync(tmp,{recursive:true,force:true});}
