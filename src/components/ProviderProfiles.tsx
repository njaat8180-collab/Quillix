import React,{useState} from 'react';
import type {QuillixSettings} from '../shared/types.js';
import type {ProviderProfile} from '../server/providerProfiles.js';
import {api} from '../services/apiBridge.js';
import {createProviderProfileId} from '../shared/providerIdentity.js';
import {parseProviderSnippet} from '../shared/providerSnippet.js';
import {getEffectiveProviderIntervalMs} from '../shared/providerPacing.js';
import {formatProviderModelLabel, type ProviderModelEntry} from '../shared/providerModels.js';
export function ProviderProfiles({settings,onChange}:{settings:QuillixSettings;onChange:(s:QuillixSettings)=>void}) {
  const [name,setName]=useState(''),[endpoint,setEndpoint]=useState(''),[model,setModel]=useState(''),[secret,setSecret]=useState('');
  const [protocol,setProtocol]=useState<ProviderProfile['protocol']>('openai');
  const [auth,setAuth]=useState<'bearer'|'header'|'basic'|'none'>('bearer'),[header,setHeader]=useState('x-api-key');
  const [tools,setTools]=useState(false),[streaming,setStreaming]=useState(true),[reasoning,setReasoning]=useState(false);
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [catalog,setCatalog]=useState<ProviderModelEntry[]>([]),[catalogModel,setCatalogModel]=useState(''),[catalogBusy,setCatalogBusy]=useState(false),[catalogMessage,setCatalogMessage]=useState('');
  const [inputPrice,setInputPrice]=useState(''),[outputPrice,setOutputPrice]=useState(''),[usage,setUsage]=useState<any[]>([]);
  const [maxInputChars,setMaxInputChars]=useState(''),[maxOutputTokens,setMaxOutputTokens]=useState(''),[minRequestIntervalMs,setMinRequestIntervalMs]=useState('');
  const [efficiency,setEfficiency]=useState<Awaited<ReturnType<typeof api.getTokenEfficiency>>|null>(null);
  const [mcpURL,setMcpURL]=useState(''),[mcpID,setMcpID]=useState(''),[mcpKey,setMcpKey]=useState('');
  const [stdioCommand,setStdioCommand]=useState(''),[stdioArgs,setStdioArgs]=useState('[]');
  const [lspID,setLspID]=useState(''),[lspCommand,setLspCommand]=useState(''),[lspArgs,setLspArgs]=useState('[]');
  const [builtinPlugins,setBuiltinPlugins]=useState<any[]>([]);
  const [snippet,setSnippet]=useState(''),[snippetMessage,setSnippetMessage]=useState('');
  const [editMaxInputChars,setEditMaxInputChars]=useState(''),[editMaxOutputTokens,setEditMaxOutputTokens]=useState(''),[editMinIntervalMs,setEditMinIntervalMs]=useState('');
  const [editInputPrice,setEditInputPrice]=useState(''),[editOutputPrice,setEditOutputPrice]=useState('');
  React.useEffect(()=>{fetch('/api/extensions/catalog').then(r=>r.json()).then(d=>setBuiltinPlugins(d.plugins||[])).catch(()=>{});},[]);
  React.useEffect(()=>{api.getTokenEfficiency(20).then(setEfficiency).catch(()=>{});},[]);
  // Populate the limits editor from the selected saved provider. Blank fields
  // mean "use the provider-documented default" (server merges endpoint defaults).
  React.useEffect(()=>{
    const profile=(settings.providerProfiles||[]).find(p=>p.id===settings.activeProviderProfile);
    setEditMaxInputChars(profile?.requestBudget?.maxInputChars!=null?String(profile.requestBudget.maxInputChars):'');
    setEditMaxOutputTokens(profile?.requestBudget?.maxOutputTokens!=null?String(profile.requestBudget.maxOutputTokens):'');
    setEditMinIntervalMs(profile?.requestBudget?.minRequestIntervalMs!=null?String(profile.requestBudget.minRequestIntervalMs):'');
    setEditInputPrice(profile?.inputCostPerMillion!=null?String(profile.inputCostPerMillion):'');
    setEditOutputPrice(profile?.outputCostPerMillion!=null?String(profile.outputCostPerMillion):'');
  },[settings.activeProviderProfile,settings.providerProfiles]);
  async function select(id:string) {setBusy(true);try {const r=await api.updateSettings({aiProvider:'universal',activeProviderProfile:id,offlineMode:false});if(!r.success||!r.settings)throw new Error(r.error);onChange(r.settings);setMessage('Provider selected. Conversation context is retained.');}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}
  async function removeSelected() {
    const id=settings.activeProviderProfile;
    const profile=settings.providerProfiles?.find(p=>p.id===id);
    if(!id||!profile) return;
    if(!window.confirm(`Remove saved provider “${profile.name}” and its stored credential?`)) return;
    setBusy(true);
    try {
      const remaining=(settings.providerProfiles||[]).filter(p=>p.id!==id);
      const credential=await fetch('/api/providers/universal/key',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({profileId:id})});
      const credentialResult=await credential.json().catch(()=>({}));
      if(!credential.ok||!credentialResult.success) throw new Error(credentialResult.error||'Could not remove the stored provider credential.');
      const r=await api.updateSettings({providerProfiles:remaining,activeProviderProfile:'',aiProvider:'universal'});
      if(!r.success||!r.settings) throw new Error(r.error||'Provider removal failed.');
      onChange({...r.settings,universalKeyConfigured:false});
      setMessage('Saved provider and its encrypted credential removed.');
    } catch(e:any) { setMessage(e?.message||'Provider removal failed.'); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try {
      const profile:ProviderProfile={id:createProviderProfileId(),name,endpoint,model,protocol,auth:{type:auth,...(auth==='header'?{header}:{})},capabilities:{tools,streaming,reasoning},...(reasoning?{reasoningEffort:'low' as const}:{})};
      if(inputPrice!==''&&outputPrice!=='') {profile.inputCostPerMillion=Number(inputPrice);profile.outputCostPerMillion=Number(outputPrice);}
      const requestBudget={
        ...(maxInputChars!==''?{maxInputChars:Number(maxInputChars)}:{}),
        ...(maxOutputTokens!==''?{maxOutputTokens:Number(maxOutputTokens)}:{}),
        ...(minRequestIntervalMs!==''?{minRequestIntervalMs:Number(minRequestIntervalMs)}:{}),
      };
      if(Object.keys(requestBudget).length) profile.requestBudget=requestBudget;
      const r=await api.updateSettings({providerProfiles:[...(settings.providerProfiles||[]),profile],activeProviderProfile:profile.id,aiProvider:'universal',offlineMode:false});
      if(!r.success||!r.settings)throw new Error(r.error||'Provider save failed.');
      let savedSettings=r.settings;
      if(auth!=='none'&&secret) {const response=await fetch('/api/providers/universal/key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:secret})});const result=await response.json();if(!response.ok||!result.success)throw new Error(result.error||'Credential save failed.');setSecret('');savedSettings={...savedSettings,universalKeyConfigured:true};}
      // The settings response is initially generated before the credential is
      // saved. Publish the post-key state too, otherwise the UI immediately
      // forgets that the key was stored and leaves Test/Remove disabled.
      onChange(savedSettings);
      setMessage(auth==='none'?'Provider saved. Use the connection test to verify access.':'Provider and encrypted API credential saved. Use the connection test to verify access.');
    }catch(e:any){setMessage(e.message);}finally{setBusy(false);}
  }
  function importSnippet() {
    try {
      const parsed=parseProviderSnippet(snippet);
      const host=new URL(parsed.endpoint).hostname.replace(/^www\./,'');
      setName(host || 'Imported provider'); setEndpoint(parsed.endpoint); setModel(parsed.model);
      setProtocol(parsed.protocol); setAuth(parsed.auth); setHeader(parsed.header || 'x-api-key');
      setSecret(parsed.secret || ''); setStreaming(parsed.streaming !== false);
      setSnippetMessage('Imported endpoint, model and authentication locally. Review the fields, enable tools if supported, then Add provider.');
    } catch (error: any) { setSnippetMessage(error?.message || 'Could not read this snippet.'); }
  }
  // M6.5: saved providers are editable. Limit/pacing overrides ride the
  // existing settings contract (server validates the profile array), so no
  // backend change is needed. Blank = provider-documented default.
  async function saveLimits() {
    const id=settings.activeProviderProfile;
    const profile=(settings.providerProfiles||[]).find(p=>p.id===id);
    if(!id||!profile){setMessage('Select a saved provider before editing its limits.');return;}
    const readNumber=(value:string)=>{const trimmed=value.trim();return trimmed===''?undefined:Number(trimmed);};
    const maxInputChars=readNumber(editMaxInputChars),maxOutputTokens=readNumber(editMaxOutputTokens),minRequestIntervalMs=readNumber(editMinIntervalMs);
    const inputPrice=readNumber(editInputPrice),outputPrice=readNumber(editOutputPrice);
    const numericEntries:[string,number|undefined][]=[['Maximum input characters',maxInputChars],['Maximum output tokens',maxOutputTokens],['Minimum request spacing (ms)',minRequestIntervalMs],['Input price per million tokens',inputPrice],['Output price per million tokens',outputPrice]];
    for(const [label,value] of numericEntries){
      if(value!==undefined&&(!Number.isFinite(value)||value<0)){setMessage(`${label} must be a number of 0 or more.`);return;}
    }
    const budget:NonNullable<ProviderProfile['requestBudget']>={};
    if(maxInputChars!==undefined)budget.maxInputChars=Math.round(maxInputChars);
    if(maxOutputTokens!==undefined)budget.maxOutputTokens=Math.round(maxOutputTokens);
    if(minRequestIntervalMs!==undefined)budget.minRequestIntervalMs=Math.round(minRequestIntervalMs);
    const updated:ProviderProfile={...profile};
    if(Object.keys(budget).length)updated.requestBudget=budget;
    else delete updated.requestBudget;
    if(inputPrice!==undefined)updated.inputCostPerMillion=inputPrice;
    if(outputPrice!==undefined)updated.outputCostPerMillion=outputPrice;
    setBusy(true);
    try{
      const profiles=(settings.providerProfiles||[]).map(p=>p.id===id?updated:p);
      const r=await api.updateSettings({providerProfiles:profiles,activeProviderProfile:id,aiProvider:'universal'});
      if(!r.success||!r.settings)throw new Error(r.error||'Could not save provider limits.');
      onChange(r.settings);
      setMessage('Provider limits saved. Pacing and budget guards apply to the next request; blank fields use provider-documented defaults.');
    }catch(e:any){setMessage(e?.message||'Could not save provider limits.');}finally{setBusy(false);}
  }
  async function discoverModels() {
    setCatalogBusy(true);setCatalogMessage('Reading the model catalog from this provider…');
    try {
      const response=await fetch('/api/providers/universal/models?refresh=1',{cache:'no-store'});
      const data=await response.json();
      if(!response.ok||!data.success)throw new Error(data.error||'Model discovery failed.');
      const models=Array.isArray(data.models)?data.models:[];
      setCatalog(models);setCatalogModel(models[0]?.id||'');
      setCatalogMessage(`${models.length} model${models.length===1?'':'s'} returned by this provider.`);
    } catch(error:any) {setCatalogMessage(error?.message||'Model discovery failed.');}
    finally {setCatalogBusy(false);}
  }
  async function useCatalogModel() {
    if(!catalogModel)return;
    setBusy(true);
    try {
      let update;
      if(activeProfile) {
        const profiles=(settings.providerProfiles||[]).map(profile=>profile.id===activeProfile.id?{...profile,model:catalogModel}:profile);
        update=await api.updateSettings({providerProfiles:profiles,activeProviderProfile:activeProfile.id,aiProvider:'universal'});
      } else update=await api.updateSettings({universalModel:catalogModel,aiProvider:'universal'});
      if(!update.success||!update.settings)throw new Error(update.error||'Could not select this model.');
      onChange(update.settings);setMessage(`Selected ${catalogModel}.`);
    } catch(error:any) {setMessage(error?.message||'Could not select this model.');}
    finally {setBusy(false);}
  }
  const field='q-settings-field w-full rounded-xl border bg-[var(--input)] px-3 py-2 text-[13px]';
  const activeProfile=(settings.providerProfiles||[]).find(p=>p.id===settings.activeProviderProfile)||null;
  return <div className="space-y-2 mt-3">
    <div className="border border-[var(--border)] rounded-xl p-3 space-y-2 bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3"><div><p className="font-medium">Models from this API</p><p className="text-[11px] text-[var(--text-muted)]">Load the catalog exposed by the saved endpoint and choose an available model.</p></div><button type="button" className="q-button-outline px-3 py-2 rounded-xl text-[12px] disabled:opacity-50" disabled={catalogBusy||busy} onClick={discoverModels}>{catalogBusy?'Loading…':'Discover models'}</button></div>
      {catalog.length>0&&<div className="flex gap-2"><select aria-label="Discovered provider models" className={field} value={catalogModel} onChange={event=>setCatalogModel(event.target.value)}>{catalog.map(item=><option key={item.id} value={item.id}>{formatProviderModelLabel(item)}</option>)}</select><button type="button" className="q-button-primary px-3 py-2 rounded-xl text-[12px] shrink-0 disabled:opacity-50" disabled={busy||!catalogModel} onClick={useCatalogModel}>Use model</button></div>}
      {catalogMessage&&<p role="status" className="text-[11px] text-[var(--text-muted)]">{catalogMessage}</p>}
    </div>
    <div className="border border-[var(--border)] rounded-xl p-3 space-y-2">
      <p className="font-medium">Import provider code</p>
      <p className="text-[11px] text-[var(--text-muted)]">Paste a Python <code>requests.post</code> example from the provider docs. NUVRO AI reads literal endpoint/model/auth fields in this window only; it never executes or uploads the pasted code.</p>
      <textarea aria-label="Provider API code snippet" className={field+' min-h-24 font-mono text-[11px]'} value={snippet} onChange={e=>setSnippet(e.target.value)} placeholder={'invoke_url = "https://api.example.com/v1/chat/completions"\npayload = {"model": "your-model", ...}\nrequests.post(invoke_url, headers=headers, json=payload, stream=False)'} />
      <button type="button" className="q-button-outline px-3 py-2 rounded-xl" disabled={busy||!snippet.trim()} onClick={importSnippet}>Read snippet</button>
      {snippetMessage&&<p role="status" className="text-[11px] text-[var(--text-muted)]">{snippetMessage}</p>}
    </div>
    <label>Saved providers<select aria-label="Saved providers" className={field} value={settings.activeProviderProfile||''} disabled={busy} onChange={e=>select(e.target.value)}><option value="">Custom connection</option>{settings.providerProfiles?.map(p=><option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label>
    <button type="button" disabled={busy||!settings.activeProviderProfile} className="q-button-outline px-3 py-2 rounded-xl text-[12px]" onClick={removeSelected}>Remove selected provider</button>
    {activeProfile && <div className="border border-[var(--border)] rounded-xl p-3 space-y-2" aria-label="Selected provider limits">
      <p className="font-medium">Request limits &amp; pacing — {activeProfile.name}</p>
      <p className="text-[11px] text-[var(--text-muted)]">Per-provider overrides. Maximum input characters compacts older context before a request; output tokens cap completion size; minimum spacing serializes requests to this endpoint. Turbo overrides saved spacing while active. Provider RPM/TPM quotas and 429 cooldowns stay enforced server-side.</p>
      <p className="text-[11px] text-[var(--text-muted)]">Effective cloud spacing: <span className="font-mono text-[var(--text)]">{Math.round(getEffectiveProviderIntervalMs(settings)/1000)}s</span> ({(settings.turboSpeedMode===true?'Turbo Speed':settings.performanceMode||'balanced')} profile){activeProfile.requestBudget?.minRequestIntervalMs!=null?` · saved interval ${Math.round(activeProfile.requestBudget.minRequestIntervalMs/1000)}s when Turbo is off`:' · provider floor not set'}</p>
      <label>Maximum input characters<input aria-label="Maximum provider input characters" type="number" min="12000" className={field} value={editMaxInputChars} onChange={e=>setEditMaxInputChars(e.target.value)} placeholder="60000"/></label>
      <label>Maximum output tokens<input aria-label="Maximum provider output tokens" type="number" min="256" className={field} value={editMaxOutputTokens} onChange={e=>setEditMaxOutputTokens(e.target.value)} placeholder="4096"/></label>
      <label>Minimum request spacing (ms)<input aria-label="Minimum provider request spacing" type="number" min="0" className={field} value={editMinIntervalMs} onChange={e=>setEditMinIntervalMs(e.target.value)} placeholder="0"/></label>
      <label>Input price per million tokens (optional)<input aria-label="Provider input price per million tokens" type="number" min="0" className={field} value={editInputPrice} onChange={e=>setEditInputPrice(e.target.value)} placeholder="e.g. 0.15"/></label>
      <label>Output price per million tokens (optional)<input aria-label="Provider output price per million tokens" type="number" min="0" className={field} value={editOutputPrice} onChange={e=>setEditOutputPrice(e.target.value)} placeholder="e.g. 0.60"/></label>
      <button type="button" className="q-button-outline px-3 py-2 rounded-xl text-[12px]" disabled={busy} onClick={saveLimits}>Save limits &amp; pricing</button>
    </div>}
    <label>Provider name<input className={field} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>API format<select className={field} value={protocol} onChange={e=>setProtocol(e.target.value as any)}>{['openai','responses','anthropic','gemini'].map(p=><option key={p}>{p}</option>)}</select></label>
    <label>API base URL<input className={field} value={endpoint} onChange={e=>setEndpoint(e.target.value)}/></label>
    <label>Exact model ID<input className={field} value={model} onChange={e=>setModel(e.target.value)}/></label>
    <label>Authentication<select className={field} value={auth} onChange={e=>setAuth(e.target.value as any)}>{['bearer','header','basic','none'].map(p=><option key={p}>{p}</option>)}</select></label>
    {auth==='header'&&<label>Authentication header<input className={field} value={header} onChange={e=>setHeader(e.target.value)}/></label>}
    {auth!=='none'&&<label>{auth==='basic'?'Username:password':'API credential'}<input type="password" autoComplete="off" className={field} value={secret} onChange={e=>setSecret(e.target.value)}/></label>}
    <label className="block"><input type="checkbox" checked={tools} onChange={e=>setTools(e.target.checked)}/> Model supports function calling</label>
    <label className="block"><input type="checkbox" checked={streaming} onChange={e=>setStreaming(e.target.checked)}/> Model supports streaming</label>
    <label className="block"><input type="checkbox" checked={reasoning} onChange={e=>setReasoning(e.target.checked)}/> Model supports reasoning options</label>
    <label>Input price per million tokens (optional)<input type="number" min="0" className={field} value={inputPrice} onChange={e=>setInputPrice(e.target.value)}/></label>
    <label>Output price per million tokens (optional)<input type="number" min="0" className={field} value={outputPrice} onChange={e=>setOutputPrice(e.target.value)}/></label>
    <div className="border border-[var(--border)] rounded-xl p-3 space-y-2">
      <p className="font-medium">Request budget guard (optional)</p>
      <p className="text-[11px] text-[var(--text-muted)]">Use the limits documented by your provider. Older context is compacted before requests; quotas are respected, not bypassed. Blank fields use NUVRO AI defaults.</p>
      <label>Maximum input characters<input aria-label="Maximum provider input characters" type="number" min="12000" className={field} value={maxInputChars} onChange={e=>setMaxInputChars(e.target.value)} placeholder="60000"/></label>
      <label>Maximum output tokens<input aria-label="Maximum provider output tokens" type="number" min="256" className={field} value={maxOutputTokens} onChange={e=>setMaxOutputTokens(e.target.value)} placeholder="4096"/></label>
      <label>Minimum request spacing (ms)<input aria-label="Minimum provider request spacing" type="number" min="0" className={field} value={minRequestIntervalMs} onChange={e=>setMinRequestIntervalMs(e.target.value)} placeholder="0"/></label>
    </div>
    <button type="button" className="q-button-outline px-3 py-2 rounded-xl" disabled={busy||!name||!endpoint||!model} onClick={save}>Add provider</button>
    <button type="button" disabled={busy||!settings.activeProviderProfile} className="q-button-outline px-3 py-2 rounded-xl" onClick={async()=>{setBusy(true);try {const r=await fetch('/api/providers/universal/test',{method:'POST'});const data=await r.json();if(!r.ok||!data.success)throw new Error(data.error);setMessage(`Connected to ${data.model}${data.capabilities?.tools?' · native tools verified':''}.`);}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}}>Test saved provider</button>
    <button type="button" className="q-button-outline px-3 py-2 rounded-xl" onClick={async()=>{try {const r=await fetch('/api/providers/usage');const data=await r.json();setUsage(data.usage||[]);}catch {setMessage('Unable to load usage.');}}}>Refresh usage</button>
    {usage.length>0&&<p>Session usage: {usage.reduce((n,u)=>n+u.inputTokens,0)} input / {usage.reduce((n,u)=>n+u.outputTokens,0)} output tokens. {usage.some(u=>u.estimatedCost!==undefined)&&`Estimated cost: ${usage.reduce((n,u)=>n+(u.estimatedCost||0),0).toFixed(6)} in your configured price currency.`}</p>}
    <div className="border border-[var(--border)] rounded-xl p-3 space-y-2" aria-label="Token efficiency">
      <div className="flex items-center justify-between gap-2"><p className="font-medium">Coding-agent efficiency</p><button type="button" className="q-button-outline px-3 py-1 rounded-xl text-[12px]" onClick={async()=>{try {setEfficiency(await api.getTokenEfficiency(20));}catch(e:any){setMessage(e.message||'Unable to load token-efficiency telemetry.');}}}>Refresh efficiency</button></div>
      {efficiency ? <p className="text-[11px] text-[var(--text-muted)]">{efficiency.sampleSize} recent tasks · {efficiency.totalTokens.toLocaleString()} tokens · median/p95 tokens {efficiency.medianTokens?.toLocaleString() ?? '—'}/{efficiency.p95Tokens?.toLocaleString() ?? '—'} · latency {efficiency.medianDurationMs===null?'—':`${Math.round(efficiency.medianDurationMs/1000)}s`}/{efficiency.p95DurationMs===null?'—':`${Math.round(efficiency.p95DurationMs/1000)}s`} · {efficiency.passRatePercent}% verified completion · {efficiency.totalModelCalls} model calls · {efficiency.totalToolCalls} tool calls · {efficiency.totalVerificationRuns} verifications · {efficiency.averageTokensPerVerifiedFile===null?'No verified files yet':`${efficiency.averageTokensPerVerifiedFile.toLocaleString()} tokens / verified file`}</p> : <p className="text-[11px] text-[var(--text-muted)]">Load persisted task telemetry to measure tokens per verified file.</p>}
    </div>
    <label>MCP server name<input className={field} value={mcpID} onChange={e=>setMcpID(e.target.value)}/></label>
    <label>MCP server URL<input className={field} value={mcpURL} onChange={e=>setMcpURL(e.target.value)}/></label>
    <label>MCP bearer token (optional)<input type="password" className={field} value={mcpKey} onChange={e=>setMcpKey(e.target.value)}/></label>
    <button type="button" disabled={busy||!mcpID||!mcpURL} className="q-button-outline px-3 py-2 rounded-xl" onClick={async()=>{setBusy(true);try {const r=await fetch('/api/extensions/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:mcpID,endpoint:mcpURL,key:mcpKey||undefined,authenticated:!!mcpKey})});const data=await r.json();if(!r.ok||!data.success)throw new Error(data.error);setMcpKey('');setMessage(`MCP connected: ${data.tools.length} tools available to compatible providers.`);}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}}>Connect MCP</button>
    <div className="border border-[var(--border)] rounded-xl p-3 space-y-2">
      <p className="font-medium">Local MCP server (stdio)</p>
      <p className="text-[11px] text-[var(--text-muted)]">Runs locally in Offline Mode without a shell. Example command: <code>node</code>; arguments must be a JSON array such as <code>[&quot;server.mjs&quot;]</code>.</p>
      <label>Command<input className={field} value={stdioCommand} onChange={e=>setStdioCommand(e.target.value)} placeholder="node"/></label>
      <label>Arguments (JSON array)<input className={field} value={stdioArgs} onChange={e=>setStdioArgs(e.target.value)} placeholder='["server.mjs"]'/></label>
      <button type="button" disabled={busy||!mcpID||!stdioCommand} className="q-button-outline px-3 py-2 rounded-xl" onClick={async()=>{setBusy(true);try {let parsed:any;try {parsed=JSON.parse(stdioArgs||'[]');}catch {throw new Error('Arguments must be a valid JSON array.');}if(!Array.isArray(parsed)||parsed.some(v=>typeof v!=='string'))throw new Error('Arguments must be a JSON array of strings.');const r=await fetch('/api/extensions/mcp-stdio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:mcpID,command:stdioCommand,args:parsed})});const data=await r.json();if(!r.ok||!data.success)throw new Error(data.error);setMessage(`Local MCP connected: ${data.tools.length} tools available. Offline Mode remains safe.`);}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}}>Connect local MCP</button>
    </div>
    <div className="border border-[var(--border)] rounded-xl p-3 space-y-2">
      <p className="font-medium">Local language server (LSP)</p>
      <p className="text-[11px] text-[var(--text-muted)]">Connect a workspace-local language server such as <code>typescript-language-server</code>, <code>pyright-langserver</code> or <code>gopls</code>. It runs over stdio, without a shell or network, and adds definition, references and diagnostics tools.</p>
      <label>Server name<input className={field} value={lspID} onChange={e=>setLspID(e.target.value)} placeholder="typescript"/></label>
      <label>Command<input className={field} value={lspCommand} onChange={e=>setLspCommand(e.target.value)} placeholder="typescript-language-server"/></label>
      <label>Arguments (JSON array)<input className={field} value={lspArgs} onChange={e=>setLspArgs(e.target.value)} placeholder='["--stdio"]'/></label>
      <button type="button" disabled={busy||!lspID||!lspCommand} className="q-button-outline px-3 py-2 rounded-xl" onClick={async()=>{setBusy(true);try {let parsed:any;try {parsed=JSON.parse(lspArgs||'[]');}catch {throw new Error('Arguments must be a valid JSON array.');}if(!Array.isArray(parsed)||parsed.some(v=>typeof v!=='string'))throw new Error('Arguments must be a JSON array of strings.');const r=await fetch('/api/extensions/lsp-stdio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:lspID,command:lspCommand,args:parsed})});const data=await r.json();if(!r.ok||!data.success)throw new Error(data.error);setMessage(`Local LSP connected: definition, references and diagnostics tools are ready.`);}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}}>Connect local LSP</button>
    </div>
    <label className="block">Add HTTP plugin manifest<input type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);try {const manifest=JSON.parse(await file.text());const r=await fetch('/api/extensions/plugin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:manifest.id,endpoint:manifest.endpoint,tools:manifest.tools})});const data=await r.json();if(!r.ok||!data.success)throw new Error(data.error);setMessage(`Plugin registered: ${data.tools.length} extension tools available.`);}catch(e:any){setMessage(e.message);}finally{setBusy(false);e.target.value='';}}}/></label>
    {builtinPlugins.length>0&&<div className="border border-[var(--border)] rounded-xl p-3 space-y-1"><p className="font-medium">Built-in coding plugins</p>{builtinPlugins.map(p=><p key={p.id} className="text-[11px]"><strong>{p.name}</strong> — {p.description}</p>)}</div>}
    <p role="status">{message}</p>
  </div>;
}
