# NUVRO AI Universal API Guide

In Settings, choose Universal API and use Saved providers to add named profiles.
Profiles have independent exact model IDs, base URLs, authentication and capability
settings. Select a saved profile to switch models while retaining the chat history.
Function calling is opt-in for new profiles. Bearer tokens (including externally
issued OAuth tokens), custom API-key headers, Basic authentication and no-auth
endpoints are supported. OAuth token refresh and cloud-specific request signing
are not implemented; those APIs need an additional adapter or gateway.

All four adapters support incremental SSE text and complete native tool-call
assembly. Interrupted or truncated tool calls never execute. Reasoning profiles
send native reasoning controls and retain signed Anthropic thinking blocks,
Gemini thought signatures and Responses reasoning items across tool turns.
Transient HTTP overload/rate-limit errors receive bounded retries, cancellation
and timeouts. Streaming failures after output begins are not replayed.

Provider profiles may also declare a request budget. NUVRO AI compacts older
tool/context messages before a configured serialized-input ceiling, caps output
tokens at the provider-safe value, and spaces requests for burst-sensitive
free-tier endpoints such as Groq. These controls reduce avoidable 413/429
failures while respecting provider quotas; they cannot bypass a provider's
account, model, RPM, TPM or daily limits.

When a provider returns `x-ratelimit-reset-requests`,
`x-ratelimit-reset-tokens`, or `Retry-After` together with an exhausted
remaining counter, the protocol/endpoint pair enters a bounded cooldown until
that reset window. Requests for different model IDs at the same endpoint share
one serialized pacing queue and cooldown, so a model switch cannot bypass an
active quota window. A 429 without reset metadata still receives a conservative
five-second cooldown (15 seconds for NVIDIA); provider-specified waits are
honored up to a 60-second cap. Retries re-enter the same queue. The state is
shared by subsequent turns in the running NUVRO AI server.

API-provided token counts are available through Refresh usage and
`GET /api/providers/usage`. Optional input/output prices produce estimates in
the configured price currency. Usage is session-scoped and capped at 1,000
requests; it is not a billing invoice or a persistent accounting ledger.

Connect a Streamable HTTP MCP server from Settings (optional bearer token), or
connect a local MCP stdio server with a direct executable and JSON argument
array. Stdio processes are spawned with `shell:false`, bounded Content-Length
JSON-RPC frames, a 30-second request timeout and explicit cleanup on server
shutdown. Local stdio is permitted in Offline Mode; HTTP extensions remain
blocked there. Plugins can register server-side handlers through
`ToolRegistry.extensions.register` or import an HTTP plugin manifest
`{id, endpoint, tools}`. Each tool in `tools` has a name, description and JSON
object `parameters` schema. HTTP plugins receive `POST {tool, arguments}` and
return JSON. Plugins and MCP tools enter the same registry and approval path
used by all providers. Extension connections last for the current server
session. OAuth discovery is not implemented; use a pre-authenticated endpoint
or bearer token where supported.

Settings also supports a local LSP stdio connection. NUVRO AI starts the
configured language server with `shell:false`, sets the active workspace as its
root, and exposes read-only `definition`, `references`, `diagnostics`, `hover`,
`completion`, and `rename_preview` tools. Results and edits outside the
workspace are discarded, and rename preview never writes files. This bridge is
intended for local servers such as TypeScript, Pyright or gopls and is available
in Offline Mode; full debugger-adapter support remains a separate capability.

Provider credentials are stored separately per validated endpoint and protocol.
Environment credentials require `QUILLIX_UNIVERSAL_API_ENDPOINT` and optionally
`QUILLIX_UNIVERSAL_API_PROTOCOL` to bind them to the intended API. Credentials
are never silently forwarded to a different URL.

The **Home Dashboard → Quick Connect** allows Ollama, Sarvam AI, OpenAI,
Grok/xAI, Groq and Universal API selection without opening Settings. Advanced
configuration remains in Settings.

For a reproducible live smoke against a configured Universal endpoint, set
`QUILLIX_LIVE_ENDPOINT`, `QUILLIX_LIVE_MODEL`, `QUILLIX_LIVE_PROTOCOL`
(`openai`, `responses`, `anthropic` or `gemini`) and
`QUILLIX_LIVE_API_KEY`, then run `npm run test:live-provider`. Add
`QUILLIX_LIVE_REQUIRE_TOOL=true` to require a native probe tool call. The
command never prints the key or model response content; without the required
environment it exits with an explicit `SKIP` result.

- **Ollama:** enter an installed local model name, such as `qwen3:4b`. Ollama must be running.
- **Sarvam:** paste your API key, save, then verify with an actual (credit-consuming) cloud request.
- **OpenAI:** uses the dedicated Responses API adapter and its exact model ID.
- **Grok/xAI:** uses the dedicated OpenAI-compatible xAI adapter and its exact model ID.
- **Groq:** uses the dedicated OpenAI-compatible Groq adapter and its configured model.
- **OpenAI-compatible Chat Completions:** choose `OpenAI-compatible`, set the API root (usually `/v1`) and the **exact model ID** your account supports.
- **NVIDIA NIM preset:** selects `https://integrate.api.nvidia.com/v1`, bearer `Authorization`, and the editable model default `openai/gpt-oss-120b`. A dedicated NVIDIA NIM provider is also available in Settings and Quick Connect when only a model ID and NVIDIA API key are needed.
- **DeepSeek preset:** selects `https://api.deepseek.com`, bearer `Authorization`, and the editable model default `deepseek-flash`.
- **OpenAI Responses:** choose `OpenAI Responses` for models/endpoints that require the Responses API. Native function calling (`function_call` / `function_call_output`) is supported.
- **Anthropic Claude:** choose `Anthropic`, API root `https://api.anthropic.com/v1` and your exact Claude model ID.
- **Google Gemini:** choose `Gemini`, API root `https://generativelanguage.googleapis.com/v1beta` and your exact model ID.
- **Other providers:** choose OpenAI-compatible only if the provider implements the Chat Completions tool-calling schema. A model name by itself does **not** make every API compatible.

Selecting a preset only fills local form defaults. NUVRO AI makes no provider
request until **Save & Connect** or an explicit connection test is pressed. The
base URL and model remain editable, so other OpenAI-compatible gateways can be
configured without adding code or storing a secret in the preset registry.

## Storage and privacy

Cloud credentials are encrypted by **Windows DPAPI** for the current Windows account; no keys are stored in NUVRO AI's settings JSON or frontend local storage. Universal credentials are bound to the selected protocol and endpoint. When switching to a different endpoint, supply a key for that endpoint. Existing version-1 DPAPI credentials are migrated on startup using the previously saved endpoint, without displaying the secret. If migration fails, the old encrypted record is preserved and the key should be re-entered.

Responses from a new endpoint are never followed via redirects when a key is attached. Offline mode blocks cloud requests. These restrictions do not prevent malicious model output; keep approval gates enabled for terminal/system-changing commands and review generated code.

## Verification

A success label requires nonempty real model output. `save` and `connected` are different statuses. Connection tests can use paid API credits. Exact model access, quotas, regional availability, rate limits and live endpoint behavior depend on the provider; **no** universal interoperability can be guaranteed.
