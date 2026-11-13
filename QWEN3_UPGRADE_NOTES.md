# Local Qwen coding model default

NUVRO AI uses `qwen2.5-coder:3b` by default. The agent workflow improves reliability through explicit deliverables, compact context, tool-call recovery, bounded repair loops, and real validation; it does not claim to make a 3B model equivalent to a larger model.

Default model for fresh NUVRO AI settings and standalone OllamaQwenProvider instances is now `qwen3:4b`. The existing Settings model remains user-editable and previously saved model preferences remain unchanged.

Run `ollama pull qwen3:4b` on the target computer before using it.

**Not implemented in this patch:** Sarvam AI and Universal API backends. The Settings UI still correctly reports Ollama only. Offline Mode restrictions remain unchanged.

Validation must be run on a Node-enabled machine before calling the build verified.
