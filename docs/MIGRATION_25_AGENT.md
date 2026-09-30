# Agent changes in Ax 25

Flat functions use their declared namespace, or `utils` when none is declared. Explicit `flatFunctionNamespace: 'tools'` retains the old grouping. Update runtime calls and discovery names accordingly.

Clarifications now carry TypeScript's structured `{question, ...}` payload by default. Explicit `clarificationShape: 'raw'` retains the original payload. Missing required context fields fail before any request; explicit `inputValidation: 'lenient'` retains the old behavior. Snake-case aliases are supported.

Every language, including Rust, returns an error prediction from task evaluation when the run throws. Evaluation pauses run-end learning. A playbook evolve record for a thrown run keeps its error without an additional error prediction.

Context maps now use TypeScript's section format and item identifiers. Existing 24.x snapshots preserve their items and normalize on their next update.
