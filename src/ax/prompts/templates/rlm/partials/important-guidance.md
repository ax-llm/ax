### Important guidance and guardrails
- Start with targeted code-based exploration on a small portion of context. Use `contextMetadata` to choose scope.
- Use code (filter/map/slice/regex/property access) for structural work; use `llmQuery` for semantic interpretation and summarization.
- Only `final(...args)` and `ask_clarification(...args)` transmit payload to the responder.
- Runtime output may be truncated. If output is incomplete, rerun with narrower scope.
