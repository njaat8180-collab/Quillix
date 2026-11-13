/**
 * NVIDIA NIM automatic model failover (Part 4).
 *
 * A thin AIProvider wrapper around the existing UniversalProvider: it changes the
 * model id between attempts and retries the SAME request, so the user's task,
 * conversation and tool state are preserved (the wrapper never executes tools
 * itself — the agent loop owns that, which also prevents duplicate actions).
 *
 * Safety rules baked in:
 *   - only transient failures (rate limit, timeout, 5xx, overload, unreachable)
 *     trigger a switch; auth/billing/bad-request fail immediately,
 *   - a model is never chosen while it is cooling down, and the failing model is
 *     never its own replacement,
 *   - only the first alternate-model probe may bypass a newly recorded cooldown;
 *     endpoint pacing, rolling RPM/TPM budgets and circuit breakers remain active,
 *   - switches are bounded and every switch is recorded for the health dashboard.
 */

import type { AIProvider, AICompletionOptions } from './qwen.js';
import type { ToolCall, ToolDefinition } from '../shared/types.js';
import { UniversalProvider } from './universal.js';
import {
  classifyNimFailure,
  isNimFailoverWorthy,
  failoverNimModel,
  noteNimFailure,
  noteNimSuccess,
  selectNimModel,
  type NimModelHealth,
  type NimModelInfo,
  type NimTaskRequirements,
} from './nimModels.js';

export interface NimSwitchEvent {
  from: string;
  to: string;
  reason: string;
  at: number;
}

export interface NimFailoverOptions {
  /** Currently discovered models for the configured account (may be empty). */
  models: () => NimModelInfo[];
  /** Lazy live discovery used after the first recoverable failure when UI has not populated the catalog. */
  discoverModels?: () => Promise<unknown>;
  /** Configured priority list, most preferred first. */
  priority?: () => string[];
  /** Maximum model switches per request (default 3). */
  maxSwitches?: number;
  /**
   * Called before every attempt so the wrapped provider actually uses the
   * selected model. Without this the delegate would keep its own model choice
   * and failover could not take effect.
   */
  onModel?: (model: string) => void;
  /**
   * Re-reads the configured model for every request so a settings change takes
   * effect without a restart. Each new request starts from the configured model
   * and may fail over again from there.
   */
  configuredModel?: () => string;
}

const DEFAULT_MAX_SWITCHES = 3;

/** Retry-After seconds, when the provider echoes them in the error text. */
function retryAfterMs(message: string): number {
  const match = /retry[-_ ]?after[:=\s]+(\d+(?:\.\d+)?)/i.exec(message);
  if (match) return Math.round(Number(match[1]) * 1000);
  return 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error ?? '');
}

function canFailoverModel(kind: ReturnType<typeof classifyNimFailure>, message: string): boolean {
  return isNimFailoverWorthy(kind) ||
    (kind === 'bad-request' && /(?:model|context|tool.?call|function.?call).*(?:not found|unknown|unavailable|unsupported|not supported|too large|exceed|does not support)|(?:not found|unknown|unavailable|unsupported|not supported).*(?:model|context|tool.?call|function.?call)/i.test(message)) ||
    (/\b404\b/i.test(message) && /model/i.test(message)) ||
    (/\b(?:400|413|422)\b/i.test(message) && /(?:model|context|tool.?call|function.?call)/i.test(message)) ||
    /empty (?:model )?response|returned no text|invalid (?:native )?tool.?call|malformed tool.?call|failed required.?tool contract/i.test(message);
}

export interface NimFailoverDelegate {
  generateText(prompt: string, options?: AICompletionOptions): Promise<string>;
  generateStream(prompt: string, options: AICompletionOptions, onChunk: (chunk: string) => void): Promise<string>;
  chatWithTools(
    messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; toolCallId?: string; name?: string; toolCalls?: ToolCall[] }>,
    tools: ToolDefinition[],
    options?: AICompletionOptions
  ): Promise<{ text: string; toolCalls: ToolCall[] }>;
  chatWithToolsStream?(
    messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; toolCallId?: string; name?: string; toolCalls?: ToolCall[] }>,
    tools: ToolDefinition[],
    options: AICompletionOptions,
    onToken: (token: string) => void
  ): Promise<{ text: string; toolCalls: ToolCall[] }>;
  getSelectedModel(): string;
  capabilities?: unknown;
  diagnosticsSnapshot(): unknown;
}

export class NimFailoverProvider implements AIProvider {
  private readonly health = new Map<string, NimModelHealth>();
  private readonly switches: NimSwitchEvent[] = [];
  private currentModel: string;
  private readonly maxSwitches: number;

  constructor(
    private readonly delegate: NimFailoverDelegate,
    private readonly options: NimFailoverOptions,
    configuredModel: string
  ) {
    this.currentModel = configuredModel;
    this.maxSwitches = Math.max(0, options.maxSwitches ?? DEFAULT_MAX_SWITCHES);
    this.options.onModel?.(configuredModel);
  }

  /** Model that the next attempt will use. */
  public activeModel(): string { return this.currentModel; }

  /** Model health dashboard data (Part 4 F). */
  public healthSnapshot(): { models: Array<{ id: string } & NimModelHealth>; switches: NimSwitchEvent[]; active: string } {
    const ids = new Set<string>([this.currentModel, ...this.health.keys(), ...this.options.models().map(model => model.id)]);
    return {
      models: [...ids].map(id => ({ id, ...(this.health.get(id) ?? noteNimSuccess(undefined, 0)) })),
      switches: [...this.switches],
      active: this.currentModel,
    };
  }

  private requirements(estimatedInputTokens: number, complexity: NimTaskRequirements['complexity']): NimTaskRequirements {
    return { estimatedInputTokens, complexity, requiresTools: true, requiresStreaming: true };
  }

  /** Pick the starting model for a request, then run with failover on failure. */
  private async run<T>(
    operation: (model: string, attemptOptions: AICompletionOptions) => Promise<T>,
    requirements: NimTaskRequirements,
    canRetry?: () => boolean,
    onSwitch?: (event: NimSwitchEvent) => void,
  ): Promise<T> {
    const started = Date.now();
    const requestedModel = this.options.configuredModel?.()?.trim() || this.currentModel;
    let model = this.selectStart(requirements);
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxSwitches; attempt += 1) {
      const attemptStarted = Date.now();
      // The delegate must use the model this wrapper selected for this attempt.
      this.currentModel = model;
      this.options.onModel?.(model);
      try {
        const result = await operation(model, {
          model,
          providerModelFailover: true,
          providerModelFailoverCooldownBypass: attempt === 1 || (attempt === 0 && model !== requestedModel),
        });
        this.health.set(model, noteNimSuccess(this.health.get(model), Date.now() - attemptStarted));
        this.currentModel = model;
        return result;
      } catch (error) {
        const message = errorMessage(error);
        const kind = classifyNimFailure(message);
        this.health.set(model, noteNimFailure(this.health.get(model), kind, Date.now(), attempt, retryAfterMs(message)));
        lastError = error;
        // Non-transient failures must surface immediately, never loop across models.
        if (!canFailoverModel(kind, message) || attempt >= this.maxSwitches || (canRetry && !canRetry())) throw error;
        if (!this.options.models().length && this.options.discoverModels) {
          try { await this.options.discoverModels(); } catch { /* Preserve and report the original request failure. */ }
        }
        const next = failoverNimModel(this.options.models(), this.healthMap(), requirements, model, {
          priority: this.options.priority?.(),
          now: Date.now(),
        });
        if (!next) throw error;
        this.switches.push({ from: model, to: next.model.id, reason: kind, at: Date.now() - started });
        onSwitch?.(this.switches[this.switches.length - 1]);
        this.currentModel = next.model.id;
        model = next.model.id;
      }
    }
    throw lastError;
  }

  private healthMap(): Record<string, NimModelHealth> {
    return Object.fromEntries(this.health);
  }

  private selectStart(requirements: NimTaskRequirements): string {
    // Settings can change at runtime: start every request from the configured
    // model again so a model that was switched away from is retried once the
    // user points the provider back at it.
    const configured = this.options.configuredModel?.()?.trim();
    if (configured && configured !== this.currentModel) this.currentModel = configured;
    const selection = selectNimModel(this.options.models(), this.healthMap(), requirements, {
      configured: this.currentModel,
      priority: this.options.priority?.(),
      now: Date.now(),
    });
    if (!selection) return this.currentModel;
    if (selection.reason !== 'priority') {
      this.switches.push({ from: this.currentModel, to: selection.model.id, reason: 'selection', at: 0 });
    }
    this.currentModel = selection.model.id;
    return selection.model.id;
  }

  private static estimateTokens(prompt: string, options?: AICompletionOptions): number {
    const text = `${prompt ?? ''}${options?.systemInstruction ?? ''}`;
    return Math.ceil(text.length / 4);
  }

  private static complexityFor(options?: AICompletionOptions): NimTaskRequirements['complexity'] {
    if (options?.reasoningEffort && options.reasoningEffort !== 'none') return 'complex';
    const budget = options?.maxOutputTokens ?? 0;
    if (budget >= 4096) return 'complex';
    if (budget > 0 && budget <= 1024) return 'simple';
    return 'medium';
  }

  public getSelectedModel(): string { return this.delegate.getSelectedModel() || this.currentModel; }

  public get capabilities() { return this.delegate.capabilities as AIProvider['capabilities']; }

  public diagnosticsSnapshot() {
    const snapshot = (this.delegate.diagnosticsSnapshot() ?? {}) as Record<string, unknown>;
    return { ...snapshot, nim: this.healthSnapshot() };
  }

  public async generateText(prompt: string, options: AICompletionOptions = {}): Promise<string> {
    const requirements = this.requirements(
      NimFailoverProvider.estimateTokens(prompt, options),
      NimFailoverProvider.complexityFor(options)
    );
    return this.run((_model, attemptOptions) => this.delegate.generateText(prompt, { ...options, ...attemptOptions }), requirements, undefined,
      event => options.onProviderModelSwitch?.({ from: event.from, to: event.to, reason: event.reason }));
  }

  public async generateStream(prompt: string, options: AICompletionOptions, onChunk: (chunk: string) => void): Promise<string> {
    const requirements = this.requirements(
      NimFailoverProvider.estimateTokens(prompt, options),
      NimFailoverProvider.complexityFor(options)
    );
    let emitted = 0;
    const guarded = (chunk: string) => { emitted += 1; onChunk(chunk); };
    // Once a token has reached the user a retry would duplicate output, so
    // streaming is only eligible for failover before the first token.
    return this.run(
      (_model, attemptOptions) => this.delegate.generateStream(prompt, { ...options, ...attemptOptions }, guarded),
      requirements,
      () => emitted === 0,
      event => options.onProviderModelSwitch?.({ from: event.from, to: event.to, reason: event.reason }),
    );
  }

  public async chatWithTools(
    messages: Parameters<AIProvider['chatWithTools']>[0],
    tools: ToolDefinition[],
    options: AICompletionOptions = {}
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    const estimated = messages.reduce((sum, message) => sum + NimFailoverProvider.estimateTokens(String(message.content ?? ''), options), 0);
    const requirements = this.requirements(estimated, NimFailoverProvider.complexityFor(options));
    return this.run((_model, attemptOptions) => this.delegate.chatWithTools(messages, tools, { ...options, ...attemptOptions }), requirements, undefined,
      event => options.onProviderModelSwitch?.({ from: event.from, to: event.to, reason: event.reason }));
  }

  /** Streamed tool turns use the same failover rules as the other surfaces. */
  public async chatWithToolsStream(
    messages: Parameters<AIProvider['chatWithTools']>[0],
    tools: ToolDefinition[],
    options: AICompletionOptions,
    onToken: (token: string) => void
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    const estimated = messages.reduce((sum, message) => sum + NimFailoverProvider.estimateTokens(String(message.content ?? ''), options), 0);
    const requirements = this.requirements(estimated, NimFailoverProvider.complexityFor(options));
    let emitted = 0;
    const guarded = (token: string) => { emitted += 1; onToken(token); };
    const stream = this.delegate.chatWithToolsStream;
    if (!stream) return this.chatWithTools(messages, tools, options);
    return this.run(
      (_model, attemptOptions) => stream.call(this.delegate, messages, tools, { ...options, ...attemptOptions }, guarded),
      requirements,
      () => emitted === 0,
      event => options.onProviderModelSwitch?.({ from: event.from, to: event.to, reason: event.reason }),
    );
  }

  /** Exposed for the provider test surface: current model + switch log. */
  public describeFailover(): { active: string; switches: NimSwitchEvent[] } {
    return { active: this.currentModel, switches: [...this.switches] };
  }
}
