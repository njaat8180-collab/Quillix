import type { AIProvider, AICompletionOptions, ProviderCapabilities, ProviderFallbackMetadata } from './qwen.js';
import type { QuillixSettings, ToolCall, ToolDefinition } from '../shared/types.js';
import type { SettingsStore } from './settings.js';
import { BrainRegistry, type BrainDefinition } from './brainRegistry.js';
import { selectedProviderConfig } from './providerProfiles.js';
import { ResourceGuard } from './resourceGuard.js';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {readEncryptedKeyPool, saveEncryptedKeyToPool, clearEncryptedKeyPool, encryptedKeyPoolCount} from './encryptedKeyPool.js';
import { DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS, getEffectiveProviderConcurrency, getEffectiveProviderIntervalMs } from '../shared/providerPacing.js';
import { readEnvNumber } from '../shared/envNumbers.js';

export function parseSarvamRetryAfterMs(value: string | null | undefined, now = Date.now()): number {
  const header = value?.trim();
  if (!header) return 0;
  if (/^\d+(?:\.\d+)?$/.test(header)) return Math.max(0, Math.round(Number(header) * 1000));
  const retryAt = Date.parse(header);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : 0;
}

// Never write the Sarvam key as plaintext. On Windows, DPAPI encrypts it for
// the current Windows user (other Windows accounts cannot decrypt it).
// On other platforms, a SARVAM_API_KEY environment variable is supported;
// saving through the UI fails closed rather than pretending chmod is encryption.
const keyDir = path.join(os.homedir(), '.quillix');
const keyFile = path.join(keyDir, 'sarvam-key.dpapi.json');
const legacyKeyFile = path.join(keyDir, 'sarvam-key.json');

// PowerShell is used only as a narrow Windows DPAPI bridge. Secrets travel
// over stdin; -EncodedCommand contains ONLY static script source, never keys.
// An absolute Windows PowerShell path is tried first because Electron/Node
// processes can inherit a PATH that does not contain the system directory.
type DpapiRuntime = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (file: string) => boolean;
  spawn?: typeof spawnSync;
};

function powershellCandidates(env: NodeJS.ProcessEnv, exists: (file: string) => boolean): string[] {
  const candidates: string[] = [];
  for (const root of [env.SystemRoot, env.WINDIR]) {
    if (!root) continue;
    for (const directory of ['System32', 'Sysnative']) {
      const absolute = path.win32.join(root, directory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      if (exists(absolute)) candidates.push(absolute);
    }
  }
  candidates.push('powershell.exe', 'pwsh.exe');
  return [...new Set(candidates.map(s => s.toLowerCase()))].map(lower => candidates.find(s => s.toLowerCase() === lower)!);
}

// PowerShell 5.1 does not always auto-load System.Security.dll, even though
// ProtectedData is part of Windows .NET Framework. PowerShell 7 resolves the
// same type from System.Security.Cryptography.ProtectedData. Load either
// assembly before invoking DPAPI, without touching the secret or logging it.
const dpapiAssemblyBootstrap = [
  "  if (-not ('System.Security.Cryptography.ProtectedData' -as [type])) {",
  '    try { Add-Type -AssemblyName System.Security -ErrorAction Stop | Out-Null } catch { }',
  '  }',
  "  if (-not ('System.Security.Cryptography.ProtectedData' -as [type])) {",
  '    try { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData -ErrorAction Stop | Out-Null } catch { }',
  '  }',
  "  if (-not ('System.Security.Cryptography.ProtectedData' -as [type])) {",
  '    [Console]::Error.Write("DPAPI_ERROR:ProtectedDataTypeUnavailable")',
  '    exit 10',
  '  }',
];

const dpapiPowerShell = {
  protect: [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    ...dpapiAssemblyBootstrap,
    '  $raw = [Console]::In.ReadToEnd().Trim()',
    '  $bytes = [Convert]::FromBase64String($raw)',
    '  $protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '  [Console]::Out.Write([Convert]::ToBase64String($protected))',
    '} catch {',
    '  [Console]::Error.Write("DPAPI_ERROR:" + $_.Exception.GetType().Name)',
    '  exit 10',
    '}',
  ].join('\n'),
  unprotect: [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    ...dpapiAssemblyBootstrap,
    '  $raw = [Console]::In.ReadToEnd().Trim()',
    '  $bytes = [Convert]::FromBase64String($raw)',
    '  $unprotected = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '  [Console]::Out.Write([Convert]::ToBase64String($unprotected))',
    '} catch {',
    '  [Console]::Error.Write("DPAPI_ERROR:" + $_.Exception.GetType().Name)',
    '  exit 10',
    '}',
  ].join('\n'),
};

export function dpapi(operation: 'protect' | 'unprotect', input: string, runtime: DpapiRuntime = {}): string {
  if ((runtime.platform ?? process.platform) !== 'win32') {
    throw new Error('Secure API key storage is supported on Windows. On this OS, set SARVAM_API_KEY in the server environment.');
  }
  const runner = runtime.spawn ?? spawnSync;
  const env = runtime.env ?? process.env;
  const exists = runtime.exists ?? fs.existsSync;
  const encodedCommand = Buffer.from(dpapiPowerShell[operation], 'utf16le').toString('base64');
  const inputBase64 = operation === 'protect' ? Buffer.from(input, 'utf8').toString('base64') : input;
  let foundPowerShell = false;
  let timedOut = false;
  let lastDpapiType: string | undefined;
  for (const binary of powershellCandidates(env, exists)) {
    const result = runner(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
      input: inputBase64, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8192,
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') continue;
    foundPowerShell = true;
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') timedOut = true;
    if (result.status === 0) {
      const output = String(result.stdout ?? '').trim();
      if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(output) && output.length > 0) {
        const bytes = Buffer.from(output, 'base64');
        if (bytes.length > 0) return operation === 'protect' ? output : bytes.toString('utf8');
      }
    }
    // Never surface raw stderr: even command errors can expose input context.
    const errorType = /DPAPI_ERROR:([A-Za-z][A-Za-z0-9]{0,80})/.exec(String(result.stderr ?? ''))?.[1];
    if (errorType) lastDpapiType = errorType;
  }
  if (!foundPowerShell) throw new Error('Windows PowerShell was not found. Check System32\\WindowsPowerShell\\v1.0 or install PowerShell, then restart NUVRO AI. No API key was saved.');
  if (timedOut) throw new Error('Windows secure storage timed out. Restart NUVRO AI under your normal signed-in Windows account and try again. No API key was saved.');
  if (lastDpapiType === 'ProtectedDataTypeUnavailable') {
    throw new Error('Windows DPAPI libraries could not be loaded by PowerShell. Check your Windows .NET/PowerShell installation. No API key was saved.');
  }
  const hint = lastDpapiType ? ` (Windows error type: ${lastDpapiType})` : '';
  throw new Error(`Windows DPAPI secure storage failed${hint}. Check your signed-in Windows user profile and PowerShell permissions. No API key was saved.`);
}

// Runs only with a synthetic value; safe to report to the user for diagnosis.
export function checkWindowsSarvamStorage(): {ok: boolean; message: string} {
  try {
    const sample = 'quillix-dpapi-roundtrip-self-test';
    const encrypted = dpapi('protect', sample);
    const decrypted = dpapi('unprotect', encrypted);
    if (decrypted !== sample) return {ok: false, message: 'Windows DPAPI round-trip did not match.'};
    return {ok: true, message: 'Windows DPAPI CurrentUser encryption and decryption work.'};
  } catch (error: any) {
    return {ok: false, message: String(error?.message || 'Windows DPAPI test failed.')};
  }
}

export function saveSarvamKey(key: string): void {
  const cleaned = typeof key === 'string' ? key.trim() : '';
  if (!cleaned || cleaned.length > 1024 || /[\r\n]/.test(cleaned)) throw new Error('Invalid Sarvam API key.');
  const encrypted = dpapi('protect', cleaned);
  if (dpapi('unprotect', encrypted) !== cleaned) {
    throw new Error('Windows DPAPI verification failed; your previous saved key was not changed.');
  }
  fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const temp = `${keyFile}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ format: 'dpapi-current-user-v1', data: encrypted }), { mode: 0o600, flag: 'wx' });
    // Windows rename replaces a regular file atomically on the same volume.
    fs.renameSync(temp, keyFile);
  } finally {
    try { fs.unlinkSync(temp); } catch (e: any) { if (e?.code !== 'ENOENT') throw e; }
  }
  // Once encrypted successfully, remove the legacy plaintext copy.
  try { fs.unlinkSync(legacyKeyFile); } catch (e: any) { if (e?.code !== 'ENOENT') throw e; }
}

function loadKey(): string {
  // Vitest and other isolated test runners use an explicit environment key so
  // provider tests remain deterministic even when the developer machine has a
  // real encrypted desktop credential configured.
  if (process.env.NODE_ENV === 'test' && process.env.SARVAM_API_KEY?.trim()) {
    return process.env.SARVAM_API_KEY.trim();
  }
  // A key entered in NUVRO AI takes precedence over an old environment key.
  // Otherwise Save & Connect can succeed while the agent still uses another key.
  if (fs.existsSync(keyFile)) {
    const record = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    if (record?.format !== 'dpapi-current-user-v1' || typeof record.data !== 'string') {
      throw new Error('Unrecognized Sarvam key format. Clear and re-enter the key.');
    }
    return dpapi('unprotect', record.data);
  }
  // Transparently migrate from the previous plaintext key file on Windows.
  if (process.platform === 'win32' && fs.existsSync(legacyKeyFile)) {
    const key = String(JSON.parse(fs.readFileSync(legacyKeyFile, 'utf8'))?.key || '').trim();
    if (!key) return '';
    saveSarvamKey(key);
    return key;
  }
  return process.env.SARVAM_API_KEY?.trim() || '';
}
export function loadSarvamKeys(): string[] {
  const sarvamCrypto = (operation: 'protect'|'unprotect', value: string) => dpapi(operation, value);
  const values = [loadKey(), ...readEncryptedKeyPool('sarvam', sarvamCrypto), ...(process.env.SARVAM_API_KEYS || '').split(/[\r\n,;]+/g)]
    .map(value => value.trim()).filter(Boolean);
  return [...new Set(values)].slice(0, 20);
}
const sarvamPoolCrypto = (operation: 'protect'|'unprotect', value: string) => dpapi(operation, value);
export function saveSarvamFailoverKey(value: string): number { return saveEncryptedKeyToPool('sarvam', value, sarvamPoolCrypto); }
export function clearSarvamFailoverKeys(): void { clearEncryptedKeyPool('sarvam'); }
export function sarvamFailoverKeyCount(): number { return encryptedKeyPoolCount('sarvam', sarvamPoolCrypto); }
export function hasSarvamKey(): boolean {
  try { return !!loadKey(); } catch { return false; }
}
export function clearSarvamKey(): void {
  for (const file of [keyFile, legacyKeyFile]) {
    try { fs.unlinkSync(file); } catch (e: any) { if (e?.code !== 'ENOENT') throw e; }
  }
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  // Never silently convert malformed provider tool-call arguments to {}.
  // Doing so can turn an invalid AI response into a real filesystem action.
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Sarvam returned a tool call without valid JSON arguments; no tool was executed.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Sarvam returned malformed tool-call JSON; no tool was executed.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Sarvam tool-call arguments must be a JSON object; no tool was executed.');
  }
  return parsed as Record<string, unknown>;
}

function parseNativeToolCalls(raw: unknown, availableTools: ToolDefinition[]): ToolCall[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('Sarvam returned invalid tool_calls; no tool was executed.');
  }
  // Validate all calls before returning any actionable operations. Unknown
  // functions and duplicate IDs must never be dispatched to the filesystem.
  const allowed = new Set(availableTools.map(tool => tool.name));
  const ids = new Set<string>();
  return raw.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Sarvam returned an incomplete tool call; no tool was executed.');
    }
    const candidate = item as Record<string, any>;
    const fn = candidate.function;
    if (!fn || typeof fn.name !== 'string' || !fn.name.trim()) {
      throw new Error('Sarvam returned an unnamed tool call; no tool was executed.');
    }
    const name = fn.name.trim();
    if (!allowed.has(name)) throw new Error(`Sarvam returned unavailable tool ${name.slice(0, 60)}; no tool was executed.`);
    const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : randomUUID();
    if (ids.has(id)) throw new Error('Sarvam returned duplicate tool-call IDs; no tool was executed.');
    ids.add(id);
    return {id, name, args: parseToolArguments(fn.arguments)};
  });
}

type Message = { role:'user'|'assistant'|'system'|'tool'; content:string; toolCallId?:string; name?:string; toolCalls?:ToolCall[] };
const SARVAM_MAX_INPUT_CHARS = 60_000;

function compactSarvamMessages(messages: Message[], maxChars: number): { messages: Message[]; changed: boolean; tooLarge: boolean } {
  const size = (items: Message[]) => JSON.stringify(items).length;
  if (size(messages) <= maxChars) return { messages, changed: false, tooLarge: false };
  const preserved = messages.filter(message => message.role === 'system');
  const mutable = messages.filter(message => message.role !== 'system');
  let changed = false;
  // Keep the newest conversation turns and tool result; older context is the
  // least useful input on small/free-tier Sarvam plans.
  while (mutable.length > 1 && size([...preserved, ...mutable]) > maxChars) {
    mutable.shift();
    changed = true;
  }
  if (size([...preserved, ...mutable]) <= maxChars) return { messages: [...preserved, ...mutable], changed, tooLarge: false };
  const latest = mutable[mutable.length - 1];
  if (!latest || size([...preserved, latest]) > maxChars) return { messages: [...preserved, ...mutable], changed, tooLarge: true };
  const available = Math.max(0, maxChars - size([...preserved, { ...latest, content: '' }]));
  const trimmed = { ...latest, content: latest.content.slice(-available) };
  return { messages: [...preserved, trimmed], changed: true, tooLarge: size([...preserved, trimmed]) > maxChars };
}

export class SarvamProvider implements AIProvider {
  public getSelectedModel(): string { return 'sarvam-105b'; }

  public readonly capabilities: ProviderCapabilities = { tools: true, streaming: false, reasoning: true };

  /** Overdrive Mode is read from live settings so a rate limit is served to
   *  the provider's advertised window instead of a bounded local retry. */
  public constructor(private readonly settings?: () => QuillixSettings) {}

  private async completion(messages:Message[], tools:ToolDefinition[], opts:AICompletionOptions = {}) {
    if (opts.signal?.aborted) throw new Error('Sarvam request cancelled.');
    // Overdrive removes every app-imposed delay: retry through several
    // provider windows with the exact advertised wait, and never fall back
    // to a local model just because a cloud quota was spent.
    const overdrive = this.settings?.().overdriveMode === true;
    const keys = loadSarvamKeys(); let keyIndex = 0; let key = keys[0] || '';
    if (!key) throw new Error('Sarvam API key missing. Add it in Settings.');
    // Keep long requests bounded, but honor explicit short health-check
    // timeouts. Quick Connect must not inherit the old 180s floor; normal
    // coding calls still use the 120s default and may opt into longer work.
    const timeoutMs = opts.timeoutSeconds !== undefined
      ? Math.min(600000, Math.max(5000, opts.timeoutSeconds * 1000))
      : 120000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const controller = new AbortController();
    const abort = () => controller.abort();
    opts.signal?.addEventListener('abort', abort, {once:true});
    timeout.addEventListener('abort', abort, {once:true});
    try {
      // The coding agent supplies its full safety and file-creation instructions
      // through opts.systemInstruction, not through the chat history.
      const inputMessages: Message[] = opts.systemInstruction && !messages.some(m => m.role === 'system' && m.content === opts.systemInstruction)
        ? [{role: 'system', content: opts.systemInstruction}, ...messages]
        : messages;
      if (opts.requiredToolName && !tools.some(t => t.name === opts.requiredToolName)) {
        throw new Error('Requested Sarvam tool is unavailable; no tool was executed.');
      }
      // Starter keys are capped at 4096 output tokens. Higher limits need
      // an explicit account-tier override; 8192 was causing HTTP 400.
      const configuredCap = readEnvNumber('SARVAM_MAX_TOKENS', 4096);
      const planCap = Number.isInteger(configuredCap) && configuredCap >= 1 && configuredCap <= 128000
        ? configuredCap : 4096;
      const desired = opts.maxOutputTokens === undefined ? planCap : opts.maxOutputTokens;
      const tokenLimit = Number.isFinite(desired) ? Math.max(1, Math.min(planCap, Math.floor(desired))) : planCap;
      // Keep the combined messages + tool schema within the adapter ceiling.
      // A large schema must reduce the message budget instead of allowing the
      // previous 12k floor to push the serialized request over 60k.
      const messageBudget = Math.max(1_000, SARVAM_MAX_INPUT_CHARS - JSON.stringify(tools).length);
      const compacted = compactSarvamMessages(inputMessages, messageBudget);
      if (compacted.tooLarge) throw new Error('Sarvam context budget is smaller than the protected instructions and latest request. Select fewer files or use a larger-context model.');
      const boundedMessages = compacted.messages;
      const payload = {
        model: 'sarvam-105b',
        // Sarvam follows the OpenAI tool conversation contract. When a model
        // response consists solely of tool calls, content should be null;
        // synthesized agent status strings are not the model's message.
        messages: boundedMessages.map(m => ({
          role: m.role,
          content: m.toolCalls?.length && (!m.content || /^Executing \d+ tool\(s\)$/.test(m.content)) ? null : m.content,
          ...(m.toolCallId ? {tool_call_id:m.toolCallId} : {}),
          ...(m.toolCalls?.length ? {tool_calls:m.toolCalls.map(t=>({id:t.id,type:'function',function:{name:t.name,arguments:JSON.stringify(t.args)}}))} : {}),
        })),
        ...(tools.length ? {
          tools: tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}})),
          tool_choice: opts.requiredToolName
            ? {type:'function',function:{name:opts.requiredToolName}}
            : 'auto',
          // Website generation is split into one file per agent turn. Keep
          // Sarvam from spending the same turn on parallel file arguments;
          // a partial JSON tool call must never reach the filesystem.
          parallel_tool_calls: false,
        } : {}),
        max_tokens: tokenLimit,
        // Tool calls compete with visible JSON/code for the provider's output
        // budget. Sarvam's reasoning tokens are invisible and can consume the
        // whole Starter 4096-token cap before a write_file/edit_file call is
        // complete, which safely yields "finish_reason: length" and no tool
        // execution. Keep ordinary text generation at low reasoning, but make
        // tool turns deterministic by default; callers can still explicitly
        // request a reasoning level when the account/model supports it.
        reasoning_effort: opts.reasoningEffort === 'none' || tools.length > 0
          ? null
          : (opts.reasoningEffort || 'low'),
        ...(opts.temperature !== undefined && Number.isFinite(opts.temperature) ? {temperature: Math.max(0, Math.min(2, opts.temperature))} : {}),
        ...(!tools.length && opts.format ? {response_format:{type:'json_schema',json_schema:{name:'quillix_file_tool',schema:opts.format,strict:false}}} : {}),
      };
      let res: Response;
      try {
        // Retry only transient HTTP responses. Once tool calls have been
        // received they are NEVER replayed; filesystem actions happen later.
        const transient = new Set([429, 500, 502, 503, 504]);
        let transientRetries = 0;
        const maxTransientRetries = overdrive ? 5 : 2;
        for (;;) {
          res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
            method: 'POST', signal: controller.signal, redirect: 'error',
            headers: {'Content-Type':'application/json','api-subscription-key':key},
            body: JSON.stringify(payload),
          });
          if ((res.status === 401 || res.status === 403) && keyIndex + 1 < keys.length) {
            await res.body?.cancel?.().catch(() => {});
            key = keys[++keyIndex];
            continue;
          }
          if (!transient.has(res.status) || transientRetries >= maxTransientRetries) break;
          const retryAfterMs = parseSarvamRetryAfterMs(res.headers?.get?.('retry-after'));
          // Large Retry-After means quota throttling, not a momentary glitch.
          // Overdrive serves exactly that window and retries when it reopens;
          // normal modes surface the quota immediately.
          if (retryAfterMs > 3_000 && !overdrive) break;
          const waitMs = overdrive && retryAfterMs > 0
            ? retryAfterMs
            : Math.max(250 * (2 ** transientRetries), retryAfterMs);
          if (overdrive && res.status === 429) opts.onRateLimit?.({ retryAt: Date.now() + waitMs, detail: 'Sarvam quota window', attempt: transientRetries });
          transientRetries += 1;
          await res.body?.cancel?.().catch(() => {});
          await new Promise<void>((resolve, reject) => {
            if (controller.signal.aborted) { reject(new Error('Sarvam request cancelled or timed out.')); return; }
            const onAbort = () => { clearTimeout(id); reject(new Error('Sarvam request cancelled or timed out.')); };
            const id = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, waitMs);
            controller.signal.addEventListener('abort', onAbort, {once: true});
          });
        }
      } catch (error: any) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          throw new Error(opts.signal?.aborted ? 'Sarvam request cancelled.' : 'Sarvam connection timed out; check network access and retry.');
        }
        if (error instanceof TypeError) throw new Error('Sarvam network connection failed. Check internet, DNS and firewall.');
        throw error;
      }
      if (!res!.ok) {
        // Never reflect raw remote error bodies; they may contain user input.
        const hint = res!.status === 400 ? 'Invalid API request or unsupported parameters.'
          : res!.status === 401 || res!.status === 403 ? 'API key rejected or not authorized.'
          : res!.status === 404 ? 'Model or endpoint not found. Use sarvam-105b with V1.'
          : res!.status === 422 ? 'Request format rejected.'
          : res!.status === 429 ? 'Rate limit or quota exceeded; try later.'
          : res!.status === 500 || res!.status === 502 || res!.status === 503 || res!.status === 504 ? 'Sarvam service is temporarily unavailable; try later.'
          : 'Check connectivity, account credits and model access.';
        const requestError = new Error(`Sarvam request failed (HTTP ${res!.status}). ${hint}`);
        Object.assign(requestError, {
          status: res!.status,
          retryAfterMs: parseSarvamRetryAfterMs(res!.headers?.get?.('retry-after')),
        });
        throw requestError;
      }
      let json: any;
      try { json = await res!.json(); }
      catch { throw new Error('Sarvam returned invalid JSON; no tool was executed.'); }
      const result = json?.choices?.[0]?.message;
      if (!result) throw new Error('Sarvam returned an empty response.');
      if (json?.choices?.[0]?.finish_reason === 'length') {
        throw new Error(`Sarvam output was truncated before a complete tool call (max_tokens=${tokenLimit}, reasoning disabled); no tool was executed. NUVRO AI will retry the current file with a compact single-tool request. Increase SARVAM_MAX_TOKENS only if your Sarvam plan permits.`);
      }
      const toolCalls = parseNativeToolCalls(result.tool_calls, tools);
      // Some providers return content as typed text parts. Empty content is
      // valid ONLY alongside real tool calls, never as successful text.
      const text = typeof result.content === 'string' ? result.content
        : Array.isArray(result.content) ? result.content
          .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
          .map((part: any) => part.text).join('') : '';
      if (!text.trim() && toolCalls.length === 0) {
        throw new Error('Sarvam returned no text or tool calls. Try a smaller task or adjust the output-token budget.');
      }
      return {text, toolCalls};
    } finally { opts.signal?.removeEventListener('abort', abort); timeout.removeEventListener('abort', abort); }
  }
  async generateText(prompt:string,opts:AICompletionOptions={}) { return (await this.completion([...(opts.systemInstruction?[{role:'system' as const,content:opts.systemInstruction}]:[]),{role:'user' as const,content:prompt}],[],opts)).text; }
  async generateStream(prompt:string,opts:AICompletionOptions,onChunk:(s:string)=>void) {const text=await this.generateText(prompt,opts);onChunk(text);return text;}
  async chatWithTools(messages:Message[],tools:ToolDefinition[],opts:AICompletionOptions={}) {return this.completion(messages,tools,opts);}
  async chatWithToolsStream(messages:Message[],tools:ToolDefinition[],opts:AICompletionOptions,onChunk:(s:string)=>void) {const r=await this.completion(messages,tools,opts);if(r.text)onChunk(r.text);return r;}
}
type OnlineSlotWaiter = {
  priority: 'high' | 'low';
  sequence: number;
  intervalMs: number;
  maxConcurrentRequests: number;
  signal?: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  onAbort?: () => void;
};

export class ProviderRouter implements AIProvider {
  public async getSelectedModel(requestedModel?: string): Promise<string | undefined> {
    const settings = this.settings.get();
    if (!settings.aiProvider || settings.aiProvider === 'ollama') return requestedModel || settings.model;
    const provider = await this.provider();
    return provider.getSelectedModel ? provider.getSelectedModel(requestedModel) : requestedModel;
  }
  private ollama: AIProvider;
  private settings: SettingsStore;
  private brains: BrainRegistry;
  private readonly workspaceRoot: () => string;
  private readonly resourceGuardFactory: () => ResourceGuard;
  /**
   * Cloud requests are serialized per brain. This is deliberately outside
   * individual adapters so Sarvam, OpenAI-compatible, NVIDIA and plugins all
   * share the same pacing policy while Ollama remains latency-free.
   */
  private static readonly onlineQueueDepth = new Map<string, number>();
  private static readonly onlineActiveCount = new Map<string, number>();
  private static readonly onlineWaiters = new Map<string, OnlineSlotWaiter[]>();
  private static readonly onlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static onlineQueueSequence = 0;
  private static readonly onlineLastRequest = new Map<string, number>();
  private static readonly onlineCooldownUntil = new Map<string, number>();
  constructor(
    ollama: AIProvider,
    settings: SettingsStore,
    workspaceRoot: () => string = () => process.cwd(),
    resourceGuardFactory: () => ResourceGuard = () => new ResourceGuard(),
  ) {
    this.ollama = ollama;
    this.settings = settings;
    this.workspaceRoot = workspaceRoot;
    this.resourceGuardFactory = resourceGuardFactory;
    this.brains = new BrainRegistry();
    this.registerBuiltInBrains();
  }
  private registerBuiltInBrains(): void {
    const register = (definition: BrainDefinition) => this.brains.register(definition);
    const online = (id: string, label: string, create: BrainDefinition['create']): BrainDefinition => ({
      id, label, mode: 'online', capabilities: { tools: true, streaming: true, reasoning: true }, create,
    });
    register({ id: 'ollama', label: 'Ollama', mode: 'offline', capabilities: { tools: true, streaming: true, reasoning: false }, create: () => this.ollama });
    const sarvam = new SarvamProvider(() => this.settings.get());
    register({ id: 'sarvam', label: 'Sarvam AI', mode: 'online', capabilities: { tools: true, streaming: false, reasoning: true }, create: () => sarvam });
    let openai: AIProvider | undefined;
    register(online('openai', 'OpenAI', async get => {
      if (!openai) {
        const [api, failover] = await Promise.all([import('./openai.js'), import('./providerModelFailover.js')]);
        const delegate = api.createOpenAIProvider(get);
        openai = new failover.ProviderModelFailover(delegate, {
          config: () => ({ protocol: 'responses', endpoint: api.OPENAI_API_ENDPOINT, model: api.normalizeOpenAIModel(get().openaiModel || 'gpt-6-astra'), offlineMode: get().offlineMode, auth: { type: 'bearer' }, capabilities: delegate.capabilities, overdriveMode: get().overdriveMode === true }),
          credential: () => api.readOpenAIKeys(),
        });
      }
      return openai!;
    }));
    let grok: AIProvider | undefined;
    register(online('grok', 'Grok', async get => {
      if (!grok) {
        const [api, failover] = await Promise.all([import('./grok.js'), import('./providerModelFailover.js')]);
        const delegate = api.createGrokProvider(get);
        grok = new failover.ProviderModelFailover(delegate, {
          config: () => ({ protocol: 'openai', endpoint: api.GROK_API_ENDPOINT, model: get().grokModel || 'grok-4', offlineMode: get().offlineMode, auth: { type: 'bearer' }, capabilities: delegate.capabilities, overdriveMode: get().overdriveMode === true }),
          credential: () => api.readGrokKeys(),
        });
      }
      return grok!;
    }));
    let groq: AIProvider | undefined;
    register(online('groq', 'Groq', async get => {
      if (!groq) {
        const [api, failover] = await Promise.all([import('./groq.js'), import('./providerModelFailover.js')]);
        const delegate = api.createGroqProvider(get);
        groq = new failover.ProviderModelFailover(delegate, {
          config: () => ({ protocol: 'openai', endpoint: api.GROQ_API_ENDPOINT, model: get().groqModel || 'openai/gpt-oss-120b', offlineMode: get().offlineMode, auth: { type: 'bearer' }, capabilities: delegate.capabilities, overdriveMode: get().overdriveMode === true }),
          credential: () => api.readGroqKeys(),
        });
      }
      return groq!;
    }));
    let nvidia: AIProvider | undefined;
    register(online('nvidia', 'NVIDIA NIM', async get => nvidia ||= (await import('./nvidia.js')).createNimProvider(get)));
    let universal: AIProvider | undefined;
    register(online('universal', 'Universal API', async get => {
      if (!universal) {
        const [transport, profiles, failover] = await Promise.all([
          import('./universal.js'), import('./providerProfiles.js'), import('./providerModelFailover.js'),
        ]);
        const delegate = new transport.UniversalProvider(() => profiles.selectedProviderConfig(get()));
        universal = new failover.ProviderModelFailover(delegate, {
          config: () => profiles.selectedProviderConfig(get()),
          credential: () => {
            const config = profiles.selectedProviderConfig(get());
            return transport.readUniversalKeys(config);
          },
        });
      }
      return universal!;
    }));
  }
  public registerBrain(definition: BrainDefinition): () => boolean {
    const dispose = this.brains.register(definition);
    return () => {
      // Never leave persisted settings pointing at a brain that was just
      // unloaded. Switch the active provider first, then dispose the plugin.
      if (this.settings.get().aiProvider === definition.id) return false;
      return dispose();
    };
  }
  public brainCatalog() {
    return this.brains.list().map((brain) => ({
      ...brain,
      capabilities: this.effectiveCapabilities(brain.id),
    }));
  }
  private effectiveCapabilities(id: string): ProviderCapabilities {
    if (id === 'universal') {
      const configured = selectedProviderConfig(this.settings.get()).capabilities;
      return {
        tools: configured?.tools !== false,
        streaming: configured?.streaming !== false,
        reasoning: configured?.reasoning === true,
      };
    }
    return this.brains.get(id)?.capabilities || { tools: true, streaming: true, reasoning: false };
  }
  public get capabilities(): ProviderCapabilities {
    return this.effectiveCapabilities(this.settings.get().aiProvider || 'ollama');
  }
  public async getFallbackModel(currentModel?: string, reason?: unknown): Promise<string | undefined> {
    const provider = await this.provider();
    return provider.getFallbackModel?.(currentModel, reason);
  }
  public async releaseModel(model?: string): Promise<void> {
    const provider = await this.provider();
    await provider.releaseModel?.(model);
  }
  public async warmUp(model?: string, options?: { timeoutSeconds?: number; retries?: number; backoffMs?: number; signal?: AbortSignal }): Promise<void> {
    const provider = await this.provider();
    const providerId = this.settings.get().aiProvider || 'ollama';
    if (providerId === 'ollama' && provider === this.ollama) {
      const targetModel = model?.trim() || this.settings.get().model?.trim() || '';
      const gate = await this.resourceGuardFactory().waitUntilSafe(this.workspaceRoot(), {
        maxWaitMs: 0,
        signal: options?.signal,
      });
      if (!gate.allowed) throw new Error(`Resource guard prevented Ollama warm-up: ${gate.reason || 'system resources are constrained'}`);
    }
    await provider.warmUp?.(model, options);
  }
  private async provider(): Promise<AIProvider> {
    const id = this.settings.get().aiProvider || 'ollama';
    return this.brains.create(id, () => this.settings.get());
  }
  private isRateLimitFailure(error: unknown): boolean {
    return /(?:rate limit|too many requests|quota|\b429\b)/i.test(String((error as any)?.message || error || ''));
  }
  private recordProviderCooldown(providerId: string, error: unknown): void {
    if (!this.isRateLimitFailure(error)) return;
    const hintedMs = Number((error as any)?.retryAfterMs);
    // Overdrive Mode removes app-imposed cooldowns: only a provider's own
    // Retry-After value may gate the next request. NUVRO AI's 5s/15s
    // fallback would otherwise stall every following turn after one exhausted
    // quota window, which looks exactly like a hang.
    if (this.settings.get().overdriveMode === true && !Number.isFinite(hintedMs)) return;
    const fallbackMs = providerId === 'nvidia' ? 15_000 : 5_000;
    const delayMs = Math.min(60_000, Math.max(fallbackMs, Number.isFinite(hintedMs) ? hintedMs : 0));
    ProviderRouter.onlineCooldownUntil.set(providerId, Math.max(
      ProviderRouter.onlineCooldownUntil.get(providerId) || 0,
      Date.now() + delayMs,
    ));
  }
  private localOptions(options?: AICompletionOptions, modelOverride?: string): AICompletionOptions {
    const model = modelOverride?.trim() || this.settings.get().model?.trim();
    return { ...(options || {}), ...(model ? { model } : {}) };
  }
  private isNvidiaCloudRoute(providerId: string): boolean {
    if (providerId === 'nvidia') return true;
    if (providerId !== 'universal') return false;
    try {
      const endpoint = selectedProviderConfig(this.settings.get()).endpoint;
      return new URL(endpoint).hostname.toLowerCase() === 'integrate.api.nvidia.com';
    } catch { return false; }
  }
  private async warmLocalFallback(options?: AICompletionOptions): Promise<string | undefined> {
    const model = this.settings.get().model?.trim() || undefined;
    const gate = await this.resourceGuardFactory().waitUntilSafe(this.workspaceRoot(), {
      maxWaitMs: 0,
      signal: options?.signal,
    });
    if (!gate.allowed) throw new Error(`Resource guard prevented local fallback: ${gate.reason || 'system resources are constrained'}`);
    await this.ollama.warmUp?.(model, { retries: 0, timeoutSeconds: 20, signal: options?.signal });
    return model;
  }
  private rateLimitFallbackError(providerError: unknown, fallbackError: unknown): Error {
    const original = String((providerError as any)?.message || providerError || 'Cloud provider rate limit');
    const fallback = String((fallbackError as any)?.message || fallbackError || 'local fallback failed');
    return new Error(`${original}. Local fallback could not proceed: ${fallback}`);
  }
  private async acquireOnlineSlot(providerId: string, signal?: AbortSignal, intervalOverride?: number, priority: 'high' | 'low' = 'high'): Promise<() => void> {
    const envOverride = process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
    const intervalRaw = intervalOverride ?? (envOverride ? Number(envOverride) : this.effectiveOnlineIntervalMs());
    const intervalMs = Number.isFinite(intervalRaw) ? Math.max(0, Math.min(60000, Math.round(intervalRaw))) : DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS;
    const currentSettings = this.settings.get();
    const maxConcurrentRequests = getEffectiveProviderConcurrency({ turboSpeedMode: currentSettings.turboSpeedMode, performanceMode: currentSettings.performanceMode, overdriveMode: currentSettings.overdriveMode });
    ProviderRouter.onlineQueueDepth.set(providerId, (ProviderRouter.onlineQueueDepth.get(providerId) || 0) + 1);
    const waiters = ProviderRouter.onlineWaiters.get(providerId) || [];
    ProviderRouter.onlineWaiters.set(providerId, waiters);
    return new Promise<() => void>((resolve, reject) => {
      const waiter: OnlineSlotWaiter = {
        priority, sequence: ProviderRouter.onlineQueueSequence++, intervalMs, maxConcurrentRequests, signal, resolve, reject,
      };
      waiter.onAbort = () => {
        const index = waiters.indexOf(waiter);
        if (index < 0) return;
        waiters.splice(index, 1);
        signal?.removeEventListener('abort', waiter.onAbort!);
        const remaining = Math.max(0, (ProviderRouter.onlineQueueDepth.get(providerId) || 1) - 1);
        if (remaining) ProviderRouter.onlineQueueDepth.set(providerId, remaining);
        else ProviderRouter.onlineQueueDepth.delete(providerId);
        const timer = ProviderRouter.onlineTimers.get(providerId);
        if (timer) { clearTimeout(timer); ProviderRouter.onlineTimers.delete(providerId); }
        if (!waiters.length && (ProviderRouter.onlineActiveCount.get(providerId) || 0) === 0) ProviderRouter.onlineWaiters.delete(providerId);
        reject(new Error('Request cancelled while waiting for provider pacing.'));
        ProviderRouter.pumpOnlineQueue(providerId);
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      if (signal?.aborted) { waiter.onAbort(); return; }
      waiters.push(waiter);
      const timer = ProviderRouter.onlineTimers.get(providerId);
      if (timer) { clearTimeout(timer); ProviderRouter.onlineTimers.delete(providerId); }
      ProviderRouter.pumpOnlineQueue(providerId);
    });
  }

  private static pumpOnlineQueue(providerId: string): void {
    const waiters = ProviderRouter.onlineWaiters.get(providerId);
    if (!waiters?.length || ProviderRouter.onlineTimers.has(providerId)) return;
    waiters.sort((a, b) => a.priority === b.priority ? a.sequence - b.sequence : a.priority === 'high' ? -1 : 1);
    const next = waiters[0];
    if ((ProviderRouter.onlineActiveCount.get(providerId) || 0) >= next.maxConcurrentRequests) return;
    if (next.signal?.aborted) { next.onAbort?.(); return; }
    const now = Date.now();
    const last = ProviderRouter.onlineLastRequest.get(providerId) || 0;
    const cooldownUntil = ProviderRouter.onlineCooldownUntil.get(providerId) || 0;
    const waitMs = Math.max(0, last + next.intervalMs - now, cooldownUntil - now);
    if (waitMs > 0) {
      ProviderRouter.onlineTimers.set(providerId, setTimeout(() => {
        ProviderRouter.onlineTimers.delete(providerId);
        ProviderRouter.pumpOnlineQueue(providerId);
      }, waitMs));
      return;
    }
    waiters.shift();
    next.signal?.removeEventListener('abort', next.onAbort!);
    ProviderRouter.onlineActiveCount.set(providerId, (ProviderRouter.onlineActiveCount.get(providerId) || 0) + 1);
    ProviderRouter.onlineLastRequest.set(providerId, Date.now());
    let released = false;
    next.resolve(() => {
      if (released) return;
      released = true;
      const active = Math.max(0, (ProviderRouter.onlineActiveCount.get(providerId) || 1) - 1);
      if (active) ProviderRouter.onlineActiveCount.set(providerId, active);
      else ProviderRouter.onlineActiveCount.delete(providerId);
      const remaining = Math.max(0, (ProviderRouter.onlineQueueDepth.get(providerId) || 1) - 1);
      if (remaining) ProviderRouter.onlineQueueDepth.set(providerId, remaining);
      else ProviderRouter.onlineQueueDepth.delete(providerId);
      if (!waiters.length && active === 0) ProviderRouter.onlineWaiters.delete(providerId);
      else ProviderRouter.pumpOnlineQueue(providerId);
    });
    ProviderRouter.pumpOnlineQueue(providerId);
  }
  /**
   * Effective minimum interval between online requests, derived from the
   * persisted settings. Turbo Speed Mode drops the artificial floor to 1000ms
   * so queued turns can run back-to-back while the adaptive scheduler still
   * respects provider RPM/TPM/concurrency limits and Retry-After cooldowns.
   * Overdrive Mode removes the floor entirely (0ms) — provider Retry-After
   * cooldowns and per-response rate limits still pace the traffic.
   */
  private effectiveOnlineIntervalMs(): number {
    const s = this.settings.get();
    if (s.offlineMode || s.aiProvider === 'ollama') return 0;
    return getEffectiveProviderIntervalMs({ turboSpeedMode: s.turboSpeedMode, performanceMode: s.performanceMode, overdriveMode: s.overdriveMode });
  }
  /** Non-secret telemetry for the Settings health center. */
  public rateLimitStatus() {
    const providerId = this.settings.get().aiProvider || 'ollama';
    const envOverride = process.env.QUILLIX_ONLINE_MIN_INTERVAL_MS;
    const intervalRaw = envOverride ? Number(envOverride) : this.effectiveOnlineIntervalMs();
    const providerManagedPacing = this.isNvidiaCloudRoute(providerId);
    const minIntervalMs = providerManagedPacing ? 0 : Number.isFinite(intervalRaw) ? Math.max(0, Math.min(60000, Math.round(intervalRaw))) : DEFAULT_ONLINE_PROVIDER_MIN_INTERVAL_MS;
    const lastRequestAt = ProviderRouter.onlineLastRequest.get(providerId) || 0;
    const offline = providerId === 'ollama' || !!this.settings.get().offlineMode;
    const cooldownUntil = ProviderRouter.onlineCooldownUntil.get(providerId) || 0;
    const nextRequestAt = offline ? 0 : Math.max(lastRequestAt + minIntervalMs, cooldownUntil);
    return {
      providerId,
      offline,
      minIntervalMs: offline ? 0 : minIntervalMs,
      providerManagedPacing,
      queuedRequests: ProviderRouter.onlineQueueDepth.get(providerId) || 0,
      activeRequests: ProviderRouter.onlineActiveCount.get(providerId) || 0,
      maxConcurrentRequests: getEffectiveProviderConcurrency({ turboSpeedMode: this.settings.get().turboSpeedMode, performanceMode: this.settings.get().performanceMode, overdriveMode: this.settings.get().overdriveMode }),
      lastRequestAt: lastRequestAt || null,
      nextRequestAt: nextRequestAt || null,
      cooldownUntil: !offline && cooldownUntil > Date.now() ? cooldownUntil : null,
      waitingMs: nextRequestAt ? Math.max(0, nextRequestAt - Date.now()) : 0,
    };
  }
  private delayWithAbort(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return new Promise(resolve => setTimeout(resolve, milliseconds));
    if (signal.aborted) return Promise.reject(new Error('Request cancelled while waiting for provider cooldown.'));
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
      const onAbort = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error('Request cancelled while waiting for provider cooldown.'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }
  private waitWithAbort(wait: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) return wait;
    if (signal.aborted) return Promise.reject(new Error('Request cancelled while waiting for provider pacing.'));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      const finish = (callback: (value?: any) => void, value?: any) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onAbort = () => finish(reject, new Error('Request cancelled while waiting for provider pacing.'));
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(wait).then(
        () => finish(resolve),
        error => finish(reject, error),
      );
    });
  }
  private async withOnlineSlot<T>(operation: () => Promise<T>, signal?: AbortSignal, priority: 'high' | 'low' = 'high'): Promise<T> {
    const providerId = this.settings.get().aiProvider || 'ollama';
    if (providerId === 'ollama' || this.settings.get().offlineMode || this.isNvidiaCloudRoute(providerId)) return operation();
    // NVIDIA requests pass directly into UniversalProvider's shared priority
    // queue; another FIFO gate here would prevent an interactive request from
    // moving ahead of queued background completions.
    const release = await this.acquireOnlineSlot(providerId, signal, undefined, priority);
    try {
      return await operation();
    } catch (error) {
      // Record before releasing the slot so already-queued requests see the
      // quota window instead of racing straight into another provider call.
      this.recordProviderCooldown(providerId, error);
      throw error;
    } finally { release(); }
  }
  private async withLocalRateLimitFallback<T>(operation: (provider: AIProvider, options?: AICompletionOptions) => Promise<T>, options?: AICompletionOptions, streamed = false): Promise<T> {
    const selectedId = this.settings.get().aiProvider || 'ollama';
    const selected = await this.provider();
    try {
      return await this.withOnlineSlot(() => operation(selected, options), options?.signal, options?.priority);
    } catch (error) {
      // Do not silently change an explicitly offline request or recurse when
      // Ollama itself is selected. Cloud credentials/context never enter the
      // local fallback call; only normalized coding messages do.
      // Overdrive Mode serves the provider's rate-limit window instead: the
      // request retries the moment it reopens rather than quietly switching
      // to a local model.
      if (selectedId === 'ollama' || this.isNvidiaCloudRoute(selectedId) || this.settings.get().offlineMode || this.settings.get().overdriveMode === true || !this.isRateLimitFailure(error) || streamed) throw error;
      try {
        const model = await this.warmLocalFallback(options);
        const localResult = await operation(this.ollama, this.localOptions(options, model));
        if (localResult && typeof localResult === 'object') {
          return { ...(localResult as any), providerFallback: { from: selectedId, to: 'ollama', reason: 'rate_limit' } satisfies ProviderFallbackMetadata } as T;
        }
        return localResult;
      } catch (fallbackError) {
        throw this.rateLimitFallbackError(error, fallbackError);
      }
    }
  }
  async generateText(p:string,o?:AICompletionOptions){return this.withLocalRateLimitFallback((provider,options)=>provider.generateText(p,options),o);}
  async usageSnapshot(){const provider=await this.provider();return 'usage' in provider ? (provider as any).usage.slice() : [];}
  public async diagnosticsSnapshot() {
    const provider = await this.provider();
    const diagnostics = typeof (provider as any).diagnosticsSnapshot === 'function'
      ? (provider as any).diagnosticsSnapshot()
      : null;
    return { ...this.rateLimitStatus(), providerDiagnostics: diagnostics };
  }
  private async withLocalStreamFallback<T>(operation: (provider: AIProvider, options: AICompletionOptions | undefined, onChunk: (chunk: string) => void) => Promise<T>, options: AICompletionOptions | undefined, onChunk: (chunk: string) => void): Promise<T> {
    const selectedId = this.settings.get().aiProvider || 'ollama';
    const selected = await this.provider();
    let emitted = false;
    const guardedChunk = (chunk: string) => { emitted = true; onChunk(chunk); };
    try {
      return await this.withOnlineSlot(() => operation(selected, options, guardedChunk), options?.signal);
    } catch (error) {
      if (emitted || selectedId === 'ollama' || this.isNvidiaCloudRoute(selectedId) || this.settings.get().offlineMode || !this.isRateLimitFailure(error)) throw error;
      try {
        const model = await this.warmLocalFallback(options);
        const localResult = await operation(this.ollama, this.localOptions(options, model), onChunk);
        if (localResult && typeof localResult === 'object') {
          return { ...(localResult as any), providerFallback: { from: selectedId, to: 'ollama', reason: 'rate_limit' } satisfies ProviderFallbackMetadata } as T;
        }
        return localResult;
      } catch (fallbackError) {
        throw this.rateLimitFallbackError(error, fallbackError);
      }
    }
  }
  async generateStream(p:string,o:AICompletionOptions,cb:(s:string)=>void){return this.withLocalStreamFallback((provider,options,onChunk)=>provider.generateStream(p,options || {},onChunk),o,cb);}
  async chatWithTools(m:Message[],t:ToolDefinition[],o?:AICompletionOptions){return this.withLocalRateLimitFallback((provider,options)=>provider.chatWithTools(m,t,options),o);}
  async chatWithToolsStream(m:Message[],t:ToolDefinition[],o:AICompletionOptions,cb:(s:string)=>void){return this.withLocalStreamFallback((provider,options,onChunk)=>provider.chatWithToolsStream(m,t,options || {},onChunk),o,cb);}
}
