import fs from 'node:fs';
import path from 'node:path';
import {AgentEngine} from '../../src/server/agentEngine.js';
import {OllamaQwenProvider} from '../../src/server/qwen.js';
import {ProviderRouter} from '../../src/server/sarvam.js';
import {WorkspaceManager} from '../../src/server/workspace.js';
import {TerminalService} from '../../src/server/terminal.js';
import {GitService} from '../../src/server/git.js';
import {CodebaseIndexer} from '../../src/server/indexer.js';
import {SettingsStore} from '../../src/server/settings.js';
import {ToolRegistry} from '../../src/server/toolRegistry.js';
import {WorkspaceVerifier} from '../../src/server/verifier.js';
import {TaskStateStore} from '../../src/server/taskState.js';
import {ProjectMemory} from '../../src/server/projectMemory.js';
import {HTML_STAGE_APPROVAL_MESSAGE} from '../../src/server/projectContract.js';
import {safeProviderError} from '../../src/server/providerErrors.js';

const settings = new SettingsStore();
const saved = settings.get();
const parent = path.resolve('.quillix-smoke');
fs.mkdirSync(parent, {recursive:true});
const root = fs.mkdtempSync(path.join(parent,'selected-provider-stage-'));
const calculator = process.argv.includes('--calculator');
const memory = new ProjectMemory(root);
const parentPackage = '{"name":"chatbot","scripts":{"dev":"node server.js"}}';
if (calculator) {
  fs.mkdirSync(path.join(root,'ChatbotApi'));
  fs.writeFileSync(path.join(root,'ChatbotApi/package.json'),parentPackage);
  fs.writeFileSync(path.join(root,'ChatbotApi/server.js'),"throw new Error('Parent backend must not run during calculator work');");
  memory.setActive('ChatbotApi',path.join(root,'ChatbotApi'));
}
const ai = new ProviderRouter(new OllamaQwenProvider({model:saved.model}), settings);
const model = await ai.getSelectedModel(saved.model);
const workspace = new WorkspaceManager(root);
const terminal = new TerminalService();
const git = new GitService(terminal);
const indexer = new CodebaseIndexer(workspace,git);
const engine = new AgentEngine(ai,new ToolRegistry(workspace,terminal,git,indexer,settings),indexer,
  new WorkspaceVerifier(workspace,terminal),memory,undefined,new TaskStateStore(root));
const started = Date.now();
let result: Awaited<ReturnType<AgentEngine['run']>> | undefined;
let error: string | undefined;
let followup: typeof result;
let cssChanged = false;
const prompt = calculator ? 'create a calculater using html css js and uuse high css and animations'
  : 'create a youtube clone using html css js only frantand first write html file and when i approve than work on other langvage';
try {
  result = await engine.run({
    userPrompt:prompt,
    provider:saved.aiProvider,model,mode:'agent',conversationHistory:[],
    settings:{maxAutonomousTurns:calculator?8:4,temperature:0.1,autoApplyDiffs:true},
    signal:AbortSignal.timeout(240000),requestApproval:async()=>false,
    onActivity:activity=>console.log(`[${Math.round((Date.now()-started)/1000)}s] ${activity.message}`),
  });
  if (calculator && result.verified) {
    const currentFile = result.verifiedFiles.find(file=>/index\.html$/i.test(file));
    const style = result.verifiedFiles.find(file=>/\.css$/i.test(file)) || currentFile;
    if (!currentFile || !style) throw new Error('Calculator source files missing');
    const before = fs.readFileSync(path.join(root,style),'utf8');
    followup = await engine.run({
      userPrompt:'add more css and animations',provider:saved.aiProvider,model,mode:'agent',currentFile,
      conversationHistory:[{id:'u1',role:'user',content:prompt,timestamp:started},{id:'a1',role:'assistant',content:result.finalText,timestamp:Date.now()}],
      settings:{maxAutonomousTurns:6,temperature:0.1,autoApplyDiffs:true},signal:AbortSignal.timeout(180000),requestApproval:async()=>false,
      onActivity:activity=>console.log(`[follow-up] ${activity.message}`),
    });
    cssChanged = fs.readFileSync(path.join(root,style),'utf8') !== before;
  }
} catch(cause:any) { error = safeProviderError(cause?.message,saved.aiProvider || 'Provider'); }
const htmlFile = path.join(root,calculator ? (result?.verifiedFiles.find(file=>/index\.html$/i.test(file)) || 'index.html') : 'index.html');
const html = fs.existsSync(htmlFile) ? fs.readFileSync(htmlFile,'utf8') : '';
const noLaterStageFiles = !fs.readdirSync(root,{recursive:true}).some(file=>/\.(?:css|[cm]?js)$/i.test(String(file)));
const parentUntouched = !calculator || fs.readFileSync(path.join(root,'ChatbotApi/package.json'),'utf8') === parentPackage;
const correctProject = !calculator || !!result?.verifiedFiles.length && result.verifiedFiles.every(file=>!file.startsWith('ChatbotApi/')) &&
  !!followup?.verified && cssChanged && followup.verifiedFiles.every(file=>!file.startsWith('ChatbotApi/'));
const passed = !!result?.verified && /<html\b/i.test(html) && parentUntouched && correctProject &&
  (calculator || noLaterStageFiles && result.finalText.includes(HTML_STAGE_APPROVAL_MESSAGE));
const report = {status:passed?'PASS':'FAIL',provider:saved.aiProvider,model,durationMs:Date.now()-started,root,
  htmlBytes:Buffer.byteLength(html),noLaterStageFiles,verified:result?.verified,observability:result?.observability,error,
  scenario:calculator?'new-calculator-and-css-follow-up':'html-approval-stage',parentUntouched,correctProject,cssChanged,
  finalText:result?.finalText,phases:result?.phases,followup};
fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,provider:report.provider,model,durationMs:report.durationMs,htmlBytes:report.htmlBytes,noLaterStageFiles,root,error}));
if(!passed) process.exitCode=1;
