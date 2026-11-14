/**
 * QUILLIX debug logging (opt-in).
 *
 * Set QUILLIX_DEBUG=1 before starting the server to trace the agent loop
 * end-to-end on stderr:
 *
 *   [AGENT_REQUEST]          — one line per model conversation turn
 *   [OLLAMA_REQUEST]         — HTTP request sent to Ollama
 *   [OLLAMA_STREAM_START]    — stream connected
 *   [OLLAMA_CHUNK]           — one line per received NDJSON chunk
 *   [OLLAMA_STREAM_END]      — stream finished (text + tool-call counts)
 *   [TOOL_CALL_DETECTED]     — parsed tool call(s) found in the turn
 *   [TOOL_EXECUTION_START]   — registry execution begins
 *   [TOOL_EXECUTION_RESULT]  — registry execution outcome
 *   [AGENT_CONTINUE]         — loop continues after tool results / nudges
 *   [AGENT_ERROR]            — fatal run error
 *   [AGENT_COMPLETE]         — run finished
 *
 * Never writes to stdout (that belongs to the app); stderr only, so it is
 * safe to keep enabled while investigating Ollama timeouts.
 */
export function isDebugEnabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.QUILLIX_DEBUG || '');
}

export function debugLog(tag: string, message: string, data?: unknown): void {
  if (!isDebugEnabled()) return;
  let suffix = '';
  if (data !== undefined) {
    try {
      suffix = ' ' + JSON.stringify(data);
    } catch {
      suffix = ' [unserializable]';
    }
  }
  process.stderr.write(`[${tag}] ${message}${suffix}\n`);
}
