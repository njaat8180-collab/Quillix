import { ToolCall, ToolDefinition } from '../shared/types.js';
import { DEFAULT_LOCAL_OLLAMA_MODEL } from '../shared/modelDefaults.js';
import { debugLog } from './debugLog.js';

export interface AICompletionOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Local Ollama context window; cloud providers may ignore this. */
  contextWindow?: number;
  /** Sarvam V1 thinking budget: none is useful for tiny connection pings. */
  reasoningEffort?: 'none' | 'low' | 'high' | 'max';
  systemInstruction?: string;
  timeoutSeconds?: number;
  /** Optional hard wall-clock limit for a streaming generation. */
  totalTimeoutSeconds?: number;
  signal?: AbortSignal;
  format?: Record<string, unknown>;
  /** Request a particular native function during missing-file recovery, when the provider supports it. */
  requiredToolName?: string;
  /** Queue priority shared by compatible cloud providers; interactive turns default to high. */
  priority?: 'high' | 'low';
  /** Internal callback used to report same-provider model failover immediately. */
  onProviderModelSwitch?: (event: { from: string; to: string; reason: string }) => void;
  /** Internal callback fired when the provider reports a rate limit. `retryAt`
   *  is the exact epoch time this request will be retried (the provider's own
   *  advertised window), so the UI can show the wait honestly. */
  onRateLimit?: (event: { retryAt: number; detail: string; attempt: number }) => void;
  /** Internal failover hints: surface model-specific transient failures without retries and let the first alternate model bypass that model's endpoint cooldown. */
  providerModelFailover?: boolean;
  /** M5.6: opt a specific call out of the prompt dedup cache (e.g. connection checks). */
  promptCache?: boolean;
  providerModelFailoverCooldownBypass?: boolean;
}

/** Runtime capabilities exposed by the selected brain to NUVRO AI's body. */
export interface ProviderCapabilities {
  tools: boolean;
  streaming: boolean;
  reasoning: boolean;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderFallbackMetadata {
  from: string;
  to: string;
  reason: 'rate_limit' | 'stream_transport' | 'model_failover';
}

export interface AIProvider {
  /** Actual configured model, used for budgeting and truthful run telemetry. */
  getSelectedModel?: (requestedModel?: string) => string | undefined | Promise<string | undefined>;
  /** Optional so third-party brain plugins remain source-compatible. */
  capabilities?: ProviderCapabilities;
  /** Some small Ollama models confuse tool JSON schema with file content. */
  supportsToolJsonSchema?: boolean;
  /** Model-specific schema capability for providers whose selected model changes at runtime. */
  supportsToolJsonSchemaForModel?: (model?: string) => boolean;
  /** Optional brain-level fallback for a bounded provider failure. */
  getFallbackModel?: (currentModel?: string, reason?: unknown) => Promise<string | undefined>;
  /** Best-effort release of a previous local brain before a model switch. */
  releaseModel?: (model?: string) => Promise<void>;
  /** Optional bounded model-load hook used before an offline fallback turn. */
  warmUp?: (model?: string, options?: {
    timeoutSeconds?: number;
    retries?: number;
    backoffMs?: number;
    signal?: AbortSignal;
  }) => Promise<void>;
  generateText(prompt: string, options?: AICompletionOptions): Promise<string>;
  generateStream(
    prompt: string,
    options: AICompletionOptions,
    onChunk: (chunk: string) => void
  ): Promise<string>;
  chatWithTools(
    messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; toolCallId?: string; name?: string; toolCalls?: ToolCall[] }>,
    tools: ToolDefinition[],
    options?: AICompletionOptions
  ): Promise<{ text: string; toolCalls?: ToolCall[]; usage?: ProviderUsage; providerFallback?: ProviderFallbackMetadata }>;
  chatWithToolsStream(
    messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; toolCallId?: string; name?: string; toolCalls?: ToolCall[] }>,
    tools: ToolDefinition[],
    options: AICompletionOptions,
    onToken: (token: string) => void
  ): Promise<{ text: string; toolCalls?: ToolCall[]; usage?: ProviderUsage; providerFallback?: ProviderFallbackMetadata }>;
}

interface OllamaMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown> | string;
    };
  }>;
  tool_name?: string;
}

interface OllamaResponse {
  message?: OllamaMessage;
  response?: string;
  done?: boolean;
  done_reason?: string;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaStatus {
  connected: boolean;
  modelAvailable: boolean;
  model: string;
  baseUrl: string;
  details: string;
  availableModels?: string[];
}

export interface OllamaWarmUpOptions {
  /** Maximum seconds to allow one model-load request to run. */
  timeoutSeconds?: number;
  /** Number of bounded retries after a timeout/transport failure. */
  retries?: number;
  /** Initial delay before retrying, doubled for each subsequent retry. */
  backoffMs?: number;
  signal?: AbortSignal;
}

export interface ProviderConfig {
  baseUrl?: string;
  model?: string;
  offlineMode?: boolean;
}

const CANNOT_CONNECT_MESSAGE =
  'NUVRO AI cannot connect to Ollama.\nStart Ollama and make sure your local Qwen model is installed.';

export class OllamaQwenProvider implements AIProvider {
  public getSelectedModel(requestedModel?: string): string { return requestedModel || this.defaultModel; }
  public readonly capabilities: ProviderCapabilities = { tools: true, streaming: true, reasoning: false };
  public readonly supportsToolJsonSchema = false;
  private baseUrl: string;
  private defaultModel: string;
  private offlineMode: boolean;
  private checkedModels = new Map<string, number>();
  private modelSizes: Array<{ name: string; size: number }> = [];
  private modelSizesCheckedAt = 0;

  constructor(config: ProviderConfig = {}) {
    this.offlineMode = config.offlineMode !== false;
    this.baseUrl = this.validateBaseUrl(config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434', this.offlineMode);
    this.defaultModel = config.model || process.env.OLLAMA_MODEL || DEFAULT_LOCAL_OLLAMA_MODEL;
  }

  /**
   * Reconfigures the provider at runtime (from Settings).
   * Throws a user-friendly error when the new configuration is invalid.
   */
  public configure(config: ProviderConfig): void {
    if ((config.baseUrl !== undefined && config.baseUrl.replace(/\/+$/, '') !== this.baseUrl) || (config.model !== undefined && config.model.trim() !== this.defaultModel)) {
      this.checkedModels.clear();
      this.modelSizes = [];
      this.modelSizesCheckedAt = 0;
    }
    if (config.offlineMode !== undefined) this.offlineMode = config.offlineMode !== false;
    if (config.baseUrl !== undefined) {
      this.baseUrl = this.validateBaseUrl(config.baseUrl, this.offlineMode);
    }
    if (config.model !== undefined) {
      const model = config.model.trim();
      if (!model) throw new Error('Model name must not be empty.');
      this.defaultModel = model;
    }
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getDefaultModel(): string {
    return this.defaultModel;
  }

  public isOfflineMode(): boolean {
    return this.offlineMode;
  }

  public isConfigured(): boolean {
    return true;
  }

  /**
   * Qwen3's Ollama chat template can spend the entire native-tool turn in
   * visible reasoning unless a response schema constrains the envelope. The
   * older Qwen coder models are more reliable with native tools alone, so this
   * capability must be selected per model rather than enabled globally.
   */
  public supportsToolJsonSchemaForModel(model = this.defaultModel): boolean {
    return /^qwen3(?:[.:-]|$)/i.test(model.trim());
  }

  /**
   * Pick only an installed local coding brain after a transport/timeout or a
   * bounded failed-validation escalation. This never crosses the offline
   * boundary and never guesses a model that Ollama did not report as installed.
   */
  public async getFallbackModel(currentModel = this.defaultModel, reason?: unknown): Promise<string | undefined> {
    const reasonText = String((reason as any)?.message || reason || '');
    if (!/timed out|timeout|deadline|cannot connect|connection reset|fetch failed|network|validation repair quality escalation|does not support tools|support(?:s)? tools|without the required .* tool call|no write_file call|resource guard|RAM \d+%|CPU \d+%|resources remain constrained/i.test(reasonText)) return undefined;
    const status = await this.getStatus();
    const current = currentModel.trim().toLowerCase();
    const installed = (status.availableModels || []).map(name => name.trim()).filter(Boolean);
    const configuredFallback = process.env.QUILLIX_OLLAMA_FALLBACK_MODEL?.trim();
    const resourceConstrained = /resource guard|RAM \d+%|CPU \d+%|resources remain constrained/i.test(reasonText);
    // Never escalate from the smallest installed coding brain while memory
    // is already constrained. A configured or quality-oriented fallback may
    // be larger, so it is unsafe in this specific state; let the resource
    // gate wait for capacity and resume from the same checkpoint instead.
    if (resourceConstrained && /^qwen2\.5-coder:1\.5b$/i.test(currentModel)) return undefined;
    const preferred = configuredFallback
      ? [configuredFallback]
      : /^qwen3(?:[.:-]|$)/i.test(currentModel)
      ? (resourceConstrained ? ['qwen2.5-coder:1.5b', 'qwen2.5-coder:3b'] : ['qwen2.5-coder:3b', 'qwen2.5-coder:1.5b'])
      : /^qwen2\.5-coder:1\.5b$/i.test(currentModel)
        ? ['qwen2.5-coder:3b']
          : /^qwen2\.5-coder:3b$/i.test(currentModel)
            ? (resourceConstrained ? ['qwen2.5-coder:1.5b', 'qwen3:4b'] : ['qwen3:4b', 'qwen2.5-coder:1.5b'])
        : ['qwen2.5-coder:3b', 'qwen3:4b', 'qwen2.5-coder:1.5b'];
    return preferred.find(candidate => candidate.toLowerCase() !== current && installed.some(name => name.toLowerCase() === candidate.toLowerCase()));
  }

  /** Ask Ollama to unload a previous local brain without crossing Offline Mode. */
  public async releaseModel(model = this.defaultModel): Promise<void> {
    if (!model.trim()) return;
    debugLog('OLLAMA_RELEASE', `requesting unload for ${model}`);
    try {
      await this.request('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: 0, options: { num_predict: 1 } }),
      }, 15);
      this.checkedModels.delete(model);
      debugLog('OLLAMA_RELEASED', `unloaded ${model}`);
    } catch {
      debugLog('OLLAMA_RELEASE_SKIPPED', `unload unavailable for ${model}`);
      // Unloading is an optimization. A crashed/older Ollama must not block
      // fallback selection or make the coding task fail.
    }
  }

  /**
   * Validates the Ollama base URL. While Offline Mode is enabled, only
   * loopback addresses are accepted; there is never a cloud fallback.
   */
  private validateBaseUrl(value: string, offlineMode: boolean): string {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('Invalid Ollama URL. Use a localhost URL such as http://localhost:11434.');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Ollama URL must use HTTP or HTTPS.');
    }

    const host = parsed.hostname.toLowerCase();
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    if (offlineMode && !isLoopback) {
      throw new Error(
        'Offline Mode requires Ollama to run on localhost (localhost, 127.0.0.1, or ::1). NUVRO AI never falls back to a cloud AI provider.'
      );
    }

    return value.replace(/\/+$/, '');
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutSeconds = 60): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutSeconds) * 1000);
    const externalSignal = init.signal;

    const abortFromExternal = () => controller.abort();
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
    if (externalSignal?.aborted) controller.abort();

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });

      const text = await response.text();
      let data: T;
      try {
        data = text ? (JSON.parse(text) as T) : ({} as T);
      } catch {
        throw new Error(`Ollama returned an invalid response (HTTP ${response.status}).`);
      }

      if (!response.ok) {
        const message = (data as any)?.error || `Ollama request failed with HTTP ${response.status}.`;
        throw new Error(message);
      }
      return data;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        if (externalSignal?.aborted) throw new Error('Ollama generation was cancelled.');
        throw new Error(`Ollama request timed out after ${timeoutSeconds} seconds.`);
      }
      if (error instanceof TypeError) {
        const detail = String(error.message || '').trim();
        throw new Error(`${CANNOT_CONNECT_MESSAGE}${detail ? ` (${detail})` : ''}`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }

  public async getStatus(model = this.defaultModel): Promise<OllamaStatus> {
    try {
      const tags = await this.request<{ models?: Array<{ name?: string; model?: string; size?: number }> }>('/api/tags', {}, 5);
      const models = tags.models || [];
      // Ollama can return aliases with different casing, whitespace, or an
      // implicit :latest tag. Compare canonical names so a valid installed
      // model does not appear as missing in NUVRO AI.
      const canonicalModel = (value: string) => value.trim().toLowerCase().replace(/:latest$/, '');
      const normalizedModel = canonicalModel(model);
      const availableModels = models
        .map((entry) => entry.name || entry.model)
        .filter((name): name is string => !!name)
        .map((name) => name.trim());
      this.modelSizes = models.flatMap(entry => {
        const name = (entry.name || entry.model || '').trim();
        const size = Number(entry.size);
        return name && Number.isFinite(size) && size > 0 ? [{ name, size }] : [];
      });
      this.modelSizesCheckedAt = Date.now();
      const modelAvailable = availableModels.some((name) => canonicalModel(name) === normalizedModel);
      return {
        connected: true,
        modelAvailable,
        model,
        baseUrl: this.baseUrl,
        availableModels,
        details: modelAvailable
          ? `Ollama is connected at ${this.baseUrl}; the selected local model is installed.`
          : `Ollama is connected at ${this.baseUrl}, but model "${model}" was not found in this instance. Installed models: ${availableModels.join(', ') || 'none'}.`,
      };
    } catch (error: any) {
      return {
        connected: false,
        modelAvailable: false,
        model,
        baseUrl: this.baseUrl,
        details: error?.message || CANNOT_CONNECT_MESSAGE,
      };
    }
  }

  private async ensureModel(model: string): Promise<void> {
    if (Date.now() - (this.checkedModels.get(model) || 0) < 30000) return;
    const status = await this.getStatus(model);
    if (!status.connected) throw new Error(CANNOT_CONNECT_MESSAGE);
    if (!status.modelAvailable) {
      throw new Error(
        `Model not found: ${model}. Install it locally with: ollama pull ${model}`
      );
    }
    this.checkedModels.set(model, Date.now());
  }

  private buildOptions(options?: AICompletionOptions, model = this.defaultModel): Record<string, unknown> {
    // Qwen Coder is more reliable when sampling is conservative but not fully
    // greedy: it reduces repeated tool JSON and unfinished code without the
    // latency/memory cost of another model or a fine-tune.
    const isCoder = /qwen.*coder/i.test(model);
    const opts: Record<string, unknown> = {
      num_ctx: 8192,
      num_predict: 2048,
      ...(isCoder ? { top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.05 } : {}),
    };
    if (options?.temperature !== undefined) opts.temperature = options.temperature;
    if (options?.maxOutputTokens !== undefined) opts.num_predict = options.maxOutputTokens;
    if (options?.contextWindow !== undefined && Number.isFinite(options.contextWindow)) opts.num_ctx = Math.min(32768, Math.max(2048, Math.round(options.contextWindow)));
    return opts;
  }

  private runtimeOptions(model: string): Record<string, unknown> {
    // Keep the selected model warm between coding turns. This removes the
    // repeated cold-load delay while still allowing users to override it.
    // Keep one local brain warm for responsive turns, but avoid retaining
    // multiple large models for half an hour after a fallback/model switch.
    // Users with ample memory can still override this explicitly.
    const keepAlive = process.env.OLLAMA_KEEP_ALIVE?.trim() || '10m';
    return { keep_alive: keepAlive, ...(/^qwen3(?:[.:-]|$)/i.test(model) ? { think: false } : {}) };
  }

  /**
   * Load the selected model once before the first real task. Model loading on
   * CPU-only machines can exceed a normal request timeout, so this is a
   * bounded retry loop rather than one opaque 45-second failure. Cancellation
   * always wins over a retry and the final error preserves attempt/timeout
   * evidence for honest acceptance reporting.
   */
  public async warmUp(model = this.defaultModel, options: OllamaWarmUpOptions = {}): Promise<void> {
    await this.ensureModel(model);
    const timeoutSeconds = Math.min(300, Math.max(5, Math.floor(options.timeoutSeconds ?? Number(process.env.OLLAMA_WARMUP_TIMEOUT_SECONDS || 90))));
    const retries = Math.min(2, Math.max(0, Math.floor(options.retries ?? Number(process.env.OLLAMA_WARMUP_RETRIES || 1))));
    const backoffMs = Math.min(5000, Math.max(50, Math.floor(options.backoffMs ?? Number(process.env.OLLAMA_WARMUP_BACKOFF_MS || 500))));
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (options.signal?.aborted) throw new Error('Ollama warm-up was cancelled.');
      try {
        debugLog('OLLAMA_WARMUP', `attempt ${attempt + 1}/${retries + 1}`, { model, timeoutSeconds });
        await this.request<OllamaResponse>(
          '/api/chat',
          {
            method: 'POST',
            signal: options.signal,
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'Reply with OK.' }],
              stream: false,
              ...this.runtimeOptions(model),
              options: { num_ctx: 2048, num_predict: 1, temperature: 0 },
            }),
          },
          timeoutSeconds,
        );
        debugLog('OLLAMA_WARMUP_READY', `model ready after ${attempt + 1} attempt(s)`, { model });
        return;
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) throw new Error('Ollama warm-up was cancelled.');
        if (attempt >= retries) break;
        const delay = Math.min(5000, backoffMs * 2 ** attempt);
        debugLog('OLLAMA_WARMUP_RETRY', `retrying after ${delay}ms`, { model, error: String(error) });
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            settled = true;
            options.signal?.removeEventListener('abort', cancel);
            resolve();
          }, delay);
          const cancel = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', cancel);
            reject(new Error('Ollama warm-up was cancelled.'));
          };
          options.signal?.addEventListener('abort', cancel, { once: true });
          if (options.signal?.aborted) cancel();
        });
      }
    }
    throw new Error(`Ollama warm-up failed after ${retries + 1} attempt(s) with a ${timeoutSeconds}s timeout: ${String((lastError as any)?.message || lastError || 'unknown error')}`);
  }

  private buildOllamaMessages(
    messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; toolCallId?: string; name?: string; toolCalls?: ToolCall[] }>,
    systemInstruction?: string
  ): OllamaMessage[] {
    const ollamaMessages: OllamaMessage[] = [];
    if (systemInstruction) {
      ollamaMessages.push({ role: 'system', content: systemInstruction });
    }
    ollamaMessages.push(
      ...messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.role === 'tool' && message.name ? { tool_name: message.name } : {}),
        ...(message.role === 'assistant' && message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                function: { name: call.name, arguments: call.args },
              })),
            }
          : {}),
      }))
    );
    return ollamaMessages;
  }

  private buildOllamaTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /** Converts accumulated raw Ollama tool calls into ToolCall records. */
  private finalizeToolCalls(rawCalls: Array<{ name: string; args: string }>): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    rawCalls.forEach((raw, index) => {
      if (!raw.name) return; // malformed fragment without a name — ignore
      let args: Record<string, any> = {};
      const trimmed = raw.args.trim();
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            args = parsed as Record<string, any>;
          }
        } catch {
          // Malformed JSON arguments — fall back to empty args; the agent
          // loop will surface a readable tool error instead of crashing.
          args = {};
        }
      }
      toolCalls.push({
        id: `call_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
        name: raw.name,
        args,
      });
    });
    return toolCalls;
  }

  public async generateText(prompt: string, options?: AICompletionOptions): Promise<string> {
    const model = options?.model || this.defaultModel;
    await this.ensureModel(model);
    const messages = this.buildOllamaMessages([{ role: 'user', content: prompt }], options?.systemInstruction);

    const data = await this.request<OllamaResponse>(
      '/api/chat',
      {
        method: 'POST',
        body: JSON.stringify({ model, messages, stream: false, ...this.runtimeOptions(model), options: this.buildOptions(options, model) }),
        signal: options?.signal,
      },
      options?.timeoutSeconds || 120
    );
    return data.message?.content || data.response || '';
  }

  public async generateStream(
    prompt: string,
    options: AICompletionOptions,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    const model = options?.model || this.defaultModel;
    await this.ensureModel(model);
    const messages = this.buildOllamaMessages([{ role: 'user', content: prompt }], options?.systemInstruction);

    const controller = new AbortController();
    // Activity-based timeout: rearmed on every chunk (see chatWithToolsStream).
    const inactivitySeconds = Math.max(1, options?.timeoutSeconds || 120);
    let timeout: NodeJS.Timeout | undefined;
    let timedOut = false;
    const armTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, inactivitySeconds * 1000);
    };
    armTimeout();
    const abortFromExternal = () => controller.abort();
    options?.signal?.addEventListener('abort', abortFromExternal, { once: true });
    if (options?.signal?.aborted) controller.abort();

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, ...this.runtimeOptions(model), options: this.buildOptions(options, model) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(text || `Ollama streaming request failed with HTTP ${response.status}.`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        armTimeout(); // active stream — restart the inactivity window
        debugLog('OLLAMA_CHUNK', `+${value?.length || 0}B`);
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = JSON.parse(line) as OllamaResponse;
          if (chunk.error) throw new Error(chunk.error);
          const text = chunk.message?.content || chunk.response || '';
          if (text) {
            fullText += text;
            onChunk(text);
          }
        }
      }
      if (buffer.trim()) {
        const chunk = JSON.parse(buffer) as OllamaResponse;
        if (chunk.error) throw new Error(chunk.error);
        const text = chunk.message?.content || chunk.response || '';
        if (text) {
          fullText += text;
          onChunk(text);
        }
      }
      return fullText;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        if (options?.signal?.aborted) throw new Error('Ollama generation was cancelled.');
        throw new Error('Ollama streaming request timed out.');
      }
      if (error instanceof TypeError) {
        throw new Error(CANNOT_CONNECT_MESSAGE);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener('abort', abortFromExternal);
    }
  }

  public async chatWithTools(
    messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; toolCallId?: string; name?: string; toolCalls?: ToolCall[] }>,
    tools: ToolDefinition[],
    options?: AICompletionOptions
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    const model = options?.model || this.defaultModel;
    await this.ensureModel(model);

    const data = await this.request<OllamaResponse>(
      '/api/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          model,
          messages: this.buildOllamaMessages(messages, options?.systemInstruction),
          tools: this.buildOllamaTools(tools),
          stream: false,
          ...this.runtimeOptions(model),
          format: options?.format,
          options: this.buildOptions(options, model),
        }),
        signal: options?.signal,
      },
      options?.timeoutSeconds || 120
    );

    const message = data.message;
    const toolCalls: ToolCall[] = (message?.tool_calls || []).map((call, index) => {
      const rawArgs = call.function.arguments;
      let args: Record<string, any> = {};
      if (typeof rawArgs === 'string') {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          args = {};
        }
      } else if (rawArgs && typeof rawArgs === 'object') {
        args = rawArgs as Record<string, any>;
      }
      return {
        id: `call_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
        name: call.function.name,
        args,
      };
    });

    return {
      text: message?.content || data.response || '',
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
  }

  /**
   * Streaming tool-calling chat against the local Ollama /api/chat endpoint.
   * Text tokens are surfaced through onToken as they arrive; tool calls are
   * accumulated from the stream (Ollama may deliver arguments in fragments).
   */
  public async chatWithToolsStream(
    messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; toolCallId?: string; name?: string; toolCalls?: ToolCall[] }>,
    tools: ToolDefinition[],
    options: AICompletionOptions,
    onToken: (token: string) => void
  ): Promise<{ text: string; toolCalls?: ToolCall[]; usage?: ProviderUsage }> {
    const model = options?.model || this.defaultModel;
    await this.ensureModel(model);

    const controller = new AbortController();
    // INACTIVITY timeout, not a total-duration timeout: the timer is rearmed
    // on every received chunk, so a slow local model that is actively
    // generating a large file is never cut off mid-stream. Only a stream
    // that goes silent for the full window aborts.
    const inactivitySeconds = Math.max(1, options?.timeoutSeconds || 600);
    let timeout: NodeJS.Timeout | undefined;
    let totalTimeout: NodeJS.Timeout | undefined;
    let totalTimedOut = false;
    let timedOut = false;
    const armTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, inactivitySeconds * 1000);
    };
    armTimeout();
    if (options?.totalTimeoutSeconds && options.totalTimeoutSeconds > 0) {
      totalTimeout = setTimeout(() => {
        timedOut = true;
        totalTimedOut = true;
        controller.abort();
      }, options.totalTimeoutSeconds * 1000);
    }
    const abortFromExternal = () => controller.abort();
    options?.signal?.addEventListener('abort', abortFromExternal, { once: true });
    if (options?.signal?.aborted) controller.abort();

    // Accumulated state across the stream
    let fullText = '';
    let usage: ProviderUsage | undefined;
    const rawToolCalls: Array<{ name: string; args: string; lastFragment: string }> = [];

    try {
      debugLog('OLLAMA_REQUEST', `POST /api/chat (stream) model=${model}`, {
        messages: messages.length,
        tools: tools.length,
        inactivityTimeoutSec: inactivitySeconds,
      });
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: this.buildOllamaMessages(messages, options?.systemInstruction),
          tools: this.buildOllamaTools(tools),
          stream: true,
          ...this.runtimeOptions(model),
          format: options?.format,
          options: this.buildOptions(options, model),
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(text || `Ollama streaming request failed with HTTP ${response.status}.`);
      }
      debugLog('OLLAMA_STREAM_START', 'connected');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let stoppedAfterRequiredTool = false;

      const handleChunk = (chunk: OllamaResponse) => {
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.prompt_eval_count !== undefined || chunk.eval_count !== undefined) {
          usage = {
            inputTokens: Number(chunk.prompt_eval_count || 0),
            outputTokens: Number(chunk.eval_count || 0),
          };
        }
        if (chunk.done && chunk.done_reason === 'length') throw new Error('Ollama output token limit reached; truncated output was not executed. Request a smaller edit or split this task.');
        const text = chunk.message?.content;
        if (typeof text === 'string' && text) {
          fullText += text;
          onToken(text);
        }
        if (chunk.message?.tool_calls?.length) {
          for (const tc of chunk.message.tool_calls) {
            const name = tc.function?.name || '';
            const frag = tc.function?.arguments;
            let entry = rawToolCalls[rawToolCalls.length - 1];
            // A named fragment starts a NEW call only when the previous call
            // with the same name looks complete (args end with '}'), otherwise
            // it is a continuation of the same call. Unnamed fragments always
            // continue the previous call.
            const isNewCall = !entry || (entry.name !== name && !!name) || (name !== '' && entry.name === name && /}\s*$/.test(entry.args));
            if (isNewCall && name) {
              rawToolCalls.push({ name, args: '', lastFragment: '' });
              entry = rawToolCalls[rawToolCalls.length - 1];
            } else if (!entry) {
              // Fragment without any prior named call — malformed, skip.
              continue;
            }

            if (typeof frag === 'string') {
              entry.args += frag;
              entry.lastFragment = frag;
            } else if (frag && typeof frag === 'object') {
              // Some builds deliver complete objects instead of string fragments.
              entry.args = JSON.stringify(frag);
              entry.lastFragment = entry.args;
            }
          }
        }
      };

      const hasCompleteRequiredTool = () => {
        if (!options?.requiredToolName || rawToolCalls.length === 0) return false;
        return rawToolCalls.some(call => {
          if (call.name !== options.requiredToolName) return false;
          try {
            const parsed = JSON.parse(call.args.trim());
            return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
          } catch {
            return false;
          }
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        armTimeout();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleChunk(JSON.parse(line) as OllamaResponse);
          } catch (err: any) {
            if (err instanceof SyntaxError) throw new Error('Ollama returned malformed streaming JSON; no tools were executed.');
            throw err;
          }
          // Once the provider has delivered a complete required tool call,
          // trailing model prose cannot improve the filesystem operation. Stop
          // reading early so slow local models do not spend another generation
          // window on explanation or duplicate calls.
          if (hasCompleteRequiredTool()) {
            stoppedAfterRequiredTool = true;
            break;
          }
        }
        if (stoppedAfterRequiredTool) break;
      }
      if (!stoppedAfterRequiredTool && buffer.trim()) {
        try {
          handleChunk(JSON.parse(buffer) as OllamaResponse);
        } catch (err: any) {
          if (err instanceof SyntaxError) throw new Error('Ollama returned truncated streaming JSON; no tools were executed.');
          throw err;
        }
      }
      if (stoppedAfterRequiredTool) {
        try { await reader.cancel(); } catch { /* the tool payload is already complete */ }
      }

      debugLog('OLLAMA_STREAM_END', 'stream finished', {
        textChars: fullText.length,
        toolCalls: rawToolCalls.length,
        stoppedAfterRequiredTool,
      });
      return {
        text: fullText,
        toolCalls: rawToolCalls.length ? this.finalizeToolCalls(rawToolCalls) : undefined,
        ...(usage ? { usage } : {}),
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        if (options?.signal?.aborted) throw new Error('Ollama generation was cancelled.');
        if (timedOut) {
          if (totalTimedOut) {
            throw new Error(
              `Ollama request timed out after ${options?.totalTimeoutSeconds} seconds of total generation time.`
            );
          }
          throw new Error(
            `Ollama request timed out after ${inactivitySeconds} seconds of NO STREAMED DATA. ` +
              `The model connection went silent — run with QUILLIX_DEBUG=1 to trace ` +
              `[OLLAMA_REQUEST]/[OLLAMA_STREAM_START]/[OLLAMA_CHUNK] before the failure.`
          );
        }
        throw new Error('Ollama streaming request timed out.');
      }
      if (error instanceof TypeError) {
        throw new Error(CANNOT_CONNECT_MESSAGE);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (totalTimeout) clearTimeout(totalTimeout);
      options?.signal?.removeEventListener('abort', abortFromExternal);
    }
  }
}
