# agent.axir Reference Notes

Reference files:

- `src/ax/agent/*` for the TypeScript reference runtime.
- `src/ax/dsp/generate.ts` and `src/ax/dsp/sig.ts` for the AxGen stage and
  signature boundaries used by the portable pipeline alpha.

This module defines the portable AxAgent pipeline alpha. It generates an
idiomatic `agent(...)`/`AxAgent` wrapper in Python, Java, and C++, while Core IR
owns deterministic stage ordering, context-field splitting, runtime metadata,
discovery/delegation policy, protocol payload normalization, clarification
errors, chat-log aggregation, optimizer-facing component metadata, runtime
session lifecycle ordering, action-log records, and minimal state round trips.

The runtime contract is language-agnostic. `AxJSRuntime` is one concrete
implementation, not the model: generated backends can declare a different
runtime language, code field name, code fence language, and callable formatting
policy while preserving the same `inputs`, `final`, `askClarification`,
`discover`, `recall`, `llmQuery`, `inspectRuntime`, `reportSuccess`, and
`reportFailure` primitive names.

The policy layer captures deliberately volatile Ax decisions as fixture-backed
data: compact catalogs live in the actor prompt, full docs are loaded by
effect-only `discover(...)`, child agents are namespaced callables, and loaded
skill docs appear on the next executor turn. Actual code execution, sandbox
permissions, tool handlers, child-agent calls, recall/search callbacks, and
skill loading remain target-native host boundaries.

The alpha deliberately does not encode arbitrary JavaScript execution,
production memory/skills search, recursive agents, AxOptimize/GEPA execution,
judges, prompt mutation, or artifact selection. Each stage remains an AxGen
boundary, and optimizer metadata is recorded only so future optimization can
consume the same portable runtime contract.

Runtime sessions are a portable protocol, not built-in interpreters. Core owns
how globals are bootstrapped from inputs/context/callables/primitives, when a
session is created, how one actor code step is executed through a host
`AxCodeRuntime`/`AxCodeSession` boundary, how final/clarification/discover/status
payloads are normalized, when action-log entries are written, and how session
state export/restore/close is shaped. Generated targets provide the actual
runtime implementation; conformance uses deterministic fake runtimes.
