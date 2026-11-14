# QUILLIX brain plug-in contract

QUILLIX separates the coding body from the model brain. The body owns the
workspace, retrieval, file edits, terminal, verification, approvals, rollback,
memory and UI. A brain only implements the provider contract in `qwen.ts` and
is registered through `ProviderRouter.registerBrain()`.

## Registration

```ts
router.registerBrain({
  id: 'my-local-brain',
  label: 'My Local Brain',
  mode: 'offline',
  capabilities: { tools: true, streaming: true, reasoning: false },
  create: (getSettings) => createMyProvider(getSettings()),
});
```

Brain IDs are lowercase kebab-case, at most 48 characters. Registration
rejects invalid IDs, duplicate IDs, missing labels, incomplete capabilities and
missing factories. The catalog exposes only descriptors; provider instances
and credentials never leave the server.

## Required boundary

The provider must implement the provider-neutral methods in `AIProvider`:

- `generateText` / `generateStream` for ordinary responses;
- `chatWithTools` / `chatWithToolsStream` for coding turns;
- `capabilities` so the body can avoid unsupported tools or streaming;
- optional `warmUp`, `releaseModel` and `getFallbackModel` for local model
  lifecycle and bounded verifier repairs.

Provider adapters must return validated tool calls and provider usage when the
transport supplies it. They must reject empty, malformed or truncated tool
responses; the body never executes an incomplete call.

## Offline safety

Set `mode: 'offline'` only for a provider whose transport is local. Online
brains are rejected by `BrainRegistry.create()` before their factory runs when
Offline Mode is enabled. An offline brain must not silently proxy requests to a
cloud endpoint. Workspace boundaries, approval checks, atomic writes and
verification remain body responsibilities and cannot be bypassed by a brain.

## Capability negotiation

`GET /api/brains` returns the registered descriptors and the selected brain's
effective capabilities. Universal profiles may narrow the declared contract
(for example, `tools: false`); the body then sends text-only turns and safely
represents tool results as context instead of attempting unsupported function
calls.

This contract lets a new Ollama-compatible model, local server, or supported
online protocol plug into the same plan → inspect → edit → test → repair loop
without changing the workspace or safety code.
