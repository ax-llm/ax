# Agent changes in Ax 25

Flat functions use their declared namespace, or `utils` when none is declared. Explicit `flatFunctionNamespace: 'tools'` retains the old grouping. Update runtime calls and discovery names accordingly.

Clarifications now carry TypeScript's structured `{question, ...}` payload by default. Explicit `clarificationShape: 'raw'` retains the original payload. Missing required context fields fail before any request; explicit `inputValidation: 'lenient'` retains the old behavior. Snake-case aliases are supported.

Every language, including Rust, returns an error prediction from task evaluation when the run throws. Evaluation pauses run-end learning. A playbook evolve record for a thrown run keeps its error without an additional error prediction.

Context maps now use TypeScript's section format and item identifiers. Existing 24.x snapshots preserve their items and normalize on their next update.

With `contextCache` enabled, stable actor inputs now form a cached user-message prefix. Current action history and runtime guidance follow in a separate user message. Empty groups are omitted. The `system` and `after-functions` breakpoints keep a single user message unless the provider ignores explicit breakpoints, matching TypeScript. This also applies to generators with cached signature fields.

Agents now build JavaScript actor stages by default. The language packages keep code engines optional: supply an executable runtime on the constructor or forward call before running the agent. Missing engines fail before a model request. An executable constructor runtime takes precedence over a call runtime; a metadata-only constructor config can use a call runtime. Explicit runtime language configuration is preserved.

Use `actorMode: 'completion'` (or `actor_mode`) to opt into the legacy completion-payload stages, on the constructor or an individual call. Completion mode cannot be combined with a runtime. Each mode keeps its stage instructions and optimized components when calls switch explicitly; runtime stage sets also distinguish language and usage guidance.
