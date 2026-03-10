### Important guidance and guardrails
- Treat any context field excerpt already shown in the prompt as first-pass evidence. If that visible excerpt is enough, do not re-log the full runtime field.
- When a context field is marked as `inline-truncated(...)`, prefer targeted inspection such as `slice(...)`, regex extraction, or focused parsing over `console.log(inputs.<field>)`.
- Do not dump full chat histories, documents, or other large context fields unless the task truly requires the entire raw value.
- Start with targeted code-based exploration on a small portion of context. Use `contextMetadata` to choose scope.
- Use code (filter/map/slice/regex/property access) for structural work; use `llmQuery` for semantic interpretation and summarization.
- Only `final(...args)` and `ask_clarification(...args)` transmit payload to the responder.
- Runtime output may be truncated. If output is incomplete, rerun with narrower scope.
