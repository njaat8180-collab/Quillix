import { createHash } from 'node:crypto';
import type { AIProvider, AICompletionOptions, ProviderFallbackMetadata } from './qwen.js';
import type { ToolCall, ToolDefinition } from '../shared/types.js';
import type { ProviderConfig } from './universal.js';
import { classifyNimFailure, isNimFailoverWorthy, nimCooldownMs, type NimFailureKind, type NimTaskRequirements } from './nimModels.js';
import { discoverProviderModels, getCachedProviderModels, type ProviderModelEntry } from './providerModelCatalog.js';

export interface ProviderModelSwitch {
  from: string;
  to: string;
  reason: NimFailureKind;
  at: number;
}

type ModelFailoverOptions = {
  config: () => ProviderConfig;
  credential: () => string | string[];
  maxSwitches?: number;
};

type ModelCatalogCache = { expiresAt: number; models: ProviderModelEntry[] };
const catalogCache = new Map<string, ModelCatalogCache>();
const CATALOG_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_MODEL_SWITCHES = 2;

function messageOf(error: unknown): string {
  return String((error as any)?.message || error || 'Provider request failed.');
}

function retryAfterMs(message: string): number {
  const match = /retry[-_ ]?after[:=\s]+(\d+(?:\.\d+)?)/i.exec(message);
  return match ? Math.max(0, Math.round(Number(match[1]) * 1000)) : 0;
}

function estimateChatInputTokens(
  messages: Array<{ content?: unknown }>,
  tools: ToolDefinition[],
  options: AICompletionOptions,
): number {
  const messageChars = messages.reduce((sum, message) => sum + String(message.content || '').length, 0);
  const toolSchemaChars = tools.length ? JSON.stringify(tools).length : 0;
  const systemChars = options.systemInstruction?.length || 0;
  return Math.ceil((messageChars + toolSchemaChars + systemChars + (options.maxOutputTokens || 0) * 4) / 4);
}

function canRecoverWithAnotherModel(error: unknown): boolean {
  const message = messageOf(error);
  const kind = classifyNimFailure(message);
  if (isNimFailoverWorthy(kind)) return true;
  if (/empty (?:model )?response|returned no text|no response body|empty completion|invalid (?:native )?tool.?call|malformed tool.?call|failed required.?tool contract/i.test(message)) return true;
  if (/\b404\b/i.test(message) && /model/i.test(message)) return true;
  if (/\b(?:400|413|422)\b/i.test(message) && /(?:model|context|tool.?call|function.?call)/i.test(message)) return true;
  // A provider may return HTTP 400 for a model-specific capability or context
  // mismatch. Other malformed requests are not safe to replay elsewhere.
  return kind === 'bad-request' && /(?:model|context|tool.?call|function.?call).*(?:not found|unknown|unavailable|unsupported|not supported|too large|exceed|does not support)|(?:not found|unknown|unavailable|unsupported|not supported).*(?:model|context|tool.?call|function.?call)/i.test(message);
}

/**
 * Retries a failed request with another model advertised by the same provider
 * endpoint. It never changes provider credentials/endpoints or executes tools.
 * Stream retries are allowed only before the first token reaches the caller.
 */
export class ProviderModelFailover implements AIProvider {
  private readonly switches: ProviderModelSwitch[] = [];
  private readonly failedUntil = new Map<string, number>();
  private activeModel = '';
  private readonly maxSwitches: number;

  constructor(private readonly delegate: AIProvider, private readonly options: ModelFailoverOptions) {
    this.maxSwitches = Math.max(0, options.maxSwitches ?? DEFAULT_MAX_MODEL_SWITCHES);
    this.activeModel = options.config().model;
  }

  get capabilities() { return this.delegate.capabilities; }
  get supportsToolJsonSchema() { return this.delegate.supportsToolJsonSchema; }
  supportsToolJsonSchemaForModel(model?: string) { return this.delegate.supportsToolJsonSchemaForModel?.(model) ?? false; }
  getSelectedModel(requestedModel?: string) {
    return requestedModel || this.options.config().model || this.activeModel || this.delegate.getSelectedModel?.();
  }
  getFallbackModel(model?: string, reason?: unknown) { return this.delegate.getFallbackModel?.(model, reason) ?? Promise.resolve(undefined); }
  releaseModel(model?: string) { return this.delegate.releaseModel?.(model) ?? Promise.resolve(); }
  warmUp(model?: string, options?: Parameters<NonNullable<AIProvider['warmUp']>>[1]) { return this.delegate.warmUp?.(model, options) ?? Promise.resolve(); }

  diagnosticsSnapshot() {
    const snapshot = typeof (this.delegate as any).diagnosticsSnapshot === 'function'
      ? (this.delegate as any).diagnosticsSnapshot()
      : {};
    return { ...snapshot, modelFailover: { active: this.activeModel, switches: this.switches.slice(-25) } };
  }

  private async getCandidates(currentModel: string, requirements: NimTaskRequirements): Promise<ProviderModelEntry[]> {
    const config = this.options.config();
    if (!config.endpoint || config.offlineMode) return [];
    const credential = this.options.credential();
    const credentialScope = Array.isArray(credential) ? credential.join('\n') : credential;
    const cacheKey = createHash('sha256')
      .update(`${config.protocol}\n${config.endpoint}\n${credentialScope}`)
      .digest('hex');
    let cached = catalogCache.get(cacheKey);
    if (!cached || cached.expiresAt <= Date.now()) {
      const discoveryCredentials = config.auth?.type === 'none' ? '' : credential;
      const models = getCachedProviderModels(config, discoveryCredentials) || await discoverProviderModels(config, discoveryCredentials);
      cached = { models, expiresAt: Date.now() + CATALOG_TTL_MS };
      catalogCache.set(cacheKey, cached);
      if (catalogCache.size > 40) {
        for (const [key, entry] of catalogCache) if (entry.expiresAt <= Date.now()) catalogCache.delete(key);
        while (catalogCache.size > 40) catalogCache.delete(catalogCache.keys().next().value!);
      }
    }
    return cached.models.filter(model => model.id !== currentModel &&
      (this.failedUntil.get(model.id.toLowerCase()) || 0) <= Date.now() &&
      !(requirements.requiresTools && model.tools === false) &&
      !(requirements.requiresStreaming && model.streaming === false) &&
      !(model.contextLength && requirements.estimatedInputTokens && model.contextLength < requirements.estimatedInputTokens));
  }

  private async run<T>(
    options: AICompletionOptions | undefined,
    operation: (model: string, attemptOptions: AICompletionOptions) => Promise<T>,
    requirements: NimTaskRequirements = {},
    canRetry?: () => boolean,
  ): Promise<T> {
    const requested = options?.model?.trim() || this.options.config().model || this.activeModel;
    let configured = requested;
    const requestedCooldown = this.failedUntil.get(requested.toLowerCase()) || 0;
    if (requestedCooldown > Date.now()) {
      try {
        const alternative = (await this.getCandidates(requested, requirements)).find(candidate =>
          (this.failedUntil.get(candidate.id.toLowerCase()) || 0) <= Date.now());
        if (alternative) {
          configured = alternative.id;
          options?.onProviderModelSwitch?.({ from: requested, to: configured, reason: 'rate-limit cooldown' });
        }
      } catch { /* Start with the configured model if the cached catalog cannot be refreshed. */ }
    }
    let model = configured;
    let switches = 0;
    const tried = new Set<string>(model ? [model.toLowerCase()] : []);
    for (;;) {
      const attemptOptions = {
        ...(options || {}), model,
        providerModelFailover: true,
        providerModelFailoverCooldownBypass: (configured !== requested && switches === 0) || switches === 1,
      };
      try {
        const result = await operation(model, attemptOptions);
        this.activeModel = model;
        if (model !== configured && result && typeof result === 'object') {
          return { ...(result as any), providerFallback: { from: configured, to: model, reason: 'model_failover' } satisfies ProviderFallbackMetadata } as T;
        }
        return result;
      } catch (error) {
        const failureMessage = messageOf(error);
        const failureKind = classifyNimFailure(failureMessage);
        if (!canRecoverWithAnotherModel(error) || switches >= this.maxSwitches || options?.signal?.aborted || (canRetry && !canRetry())) throw error;
        const cooldown = nimCooldownMs(failureKind, switches, retryAfterMs(failureMessage)) || 15_000;
        this.failedUntil.set(model.toLowerCase(), Date.now() + cooldown);
        let candidates: ProviderModelEntry[];
        try { candidates = await this.getCandidates(model, requirements); }
        catch { throw error; }
        const next = candidates.find(candidate => !tried.has(candidate.id.toLowerCase()));
        if (!next) throw error;
        const reason = classifyNimFailure(messageOf(error));
        this.switches.push({ from: model, to: next.id, reason, at: Date.now() });
        if (this.switches.length > 100) this.switches.splice(0, this.switches.length - 100);
        options?.onProviderModelSwitch?.({ from: model, to: next.id, reason });
        tried.add(next.id.toLowerCase());
        model = next.id;
        switches += 1;
      }
    }
  }

  generateText(prompt: string, options: AICompletionOptions = {}) {
    return this.run(options, async (_model, attemptOptions) => {
      const text = await this.delegate.generateText(prompt, attemptOptions);
      if (!text.trim()) throw new Error('Provider returned an empty model response.');
      return text;
    }, { estimatedInputTokens: Math.ceil((prompt.length + (options.systemInstruction?.length || 0) + (options.maxOutputTokens || 0) * 4) / 4) });
  }

  generateStream(prompt: string, options: AICompletionOptions, onChunk: (chunk: string) => void) {
    let emitted = false;
    return this.run(options, async (_model, attemptOptions) => {
      const text = await this.delegate.generateStream(prompt, attemptOptions, chunk => {
        if (chunk) emitted = true;
        onChunk(chunk);
      });
      if (!text.trim() && !emitted) throw new Error('Provider returned an empty model response.');
      return text;
    }, { requiresStreaming: true, estimatedInputTokens: Math.ceil((prompt.length + (options.systemInstruction?.length || 0) + (options.maxOutputTokens || 0) * 4) / 4) }, () => !emitted);
  }

  chatWithTools(
    messages: Parameters<AIProvider['chatWithTools']>[0],
    tools: ToolDefinition[],
    options: AICompletionOptions = {},
  ) {
    return this.run(options, async (_model, attemptOptions) => {
      const result = await this.delegate.chatWithTools(messages, tools, attemptOptions);
      if (!result.text?.trim() && !result.toolCalls?.length) throw new Error('Provider returned an empty model response.');
      if (options.requiredToolName && !result.toolCalls?.some(call => call.name === options.requiredToolName)) throw new Error('Model failed required-tool contract.');
      return result;
    }, { requiresTools: true, estimatedInputTokens: estimateChatInputTokens(messages, tools, options) });
  }

  chatWithToolsStream(
    messages: Parameters<AIProvider['chatWithToolsStream']>[0],
    tools: ToolDefinition[],
    options: AICompletionOptions,
    onToken: (token: string) => void,
  ) {
    let emitted = false;
    return this.run(options, async (_model, attemptOptions) => {
      const result = await this.delegate.chatWithToolsStream(messages, tools, attemptOptions, token => {
        if (token) emitted = true;
        onToken(token);
      });
      if (!result.text?.trim() && !result.toolCalls?.length && !emitted) throw new Error('Provider returned an empty model response.');
      if (options.requiredToolName && !result.toolCalls?.some(call => call.name === options.requiredToolName) && !emitted) throw new Error('Model failed required-tool contract.');
      return result;
    }, { requiresTools: true, requiresStreaming: true, estimatedInputTokens: estimateChatInputTokens(messages, tools, options) }, () => !emitted);
  }
}
