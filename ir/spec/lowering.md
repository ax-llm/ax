# AxIR Lowering Pipeline

The Go compiler uses staged lowering:

1. `parse`: read `.axir` modules.
2. `resolve`: load imports and collect symbols.
3. `check`: validate dialect names, refs, public symbols, and Core body
   invariants.
4. `canonicalize`: stable formatter output and operation ordering.
5. `lower --to core`: convert Ax dialect ops with `core_kind` into Core ops.
6. `core-body`: validate and normalize typed Core regions for executable
   semantic bodies.
7. `runtime-model`: extract the Ax runtime package model and target idiom
   contract from lowered Core.
8. `compile`: emit source from the runtime model.

Current lowering emits both declarations and executable Core bodies. Core-owned
semantic bodies cover the current AxAI/AxGen runtime slice, including
signatures, schema, validation, prompts/templates, stream folding, AxGen
orchestration, AxAI normalization, provider JSON mapping, memory, trace,
example/demo ordering, and the AxAgent language-agnostic pipeline/runtime
contract.

AxAgent lowering treats runtime language, callable inventory, discovery policy,
delegation policy, `final(...)`/`askClarification(...)` protocol payloads, and
optimizer-facing component metadata as Core-owned semantics. Runtime-session
lowering also keeps the deterministic session lifecycle in Core: global
bootstrap, reserved-name validation, fresh `agent.test(...)` sessions,
single-step actor execution, action-log/status records, closed-session restart
notices, protocol normalization, and state inspect/export/restore/close shape.
The generated targets own only host boundaries: runtime code execution, sandbox
permissions, tool handlers, child-agent execution, recall/search callbacks,
skill loading, transport, and native callback invocation.

Code generation remains partly template-backed for idiomatic wrappers,
transport boundaries, host callbacks, package layout, and conformance harnesses.
Templates consume `AxRuntimeModel`; they must not reimplement Core-owned Ax
algorithms. Generated conformance runners execute fixtures against emitted
packages rather than against hand-written test harnesses.

The backend contract is intentionally asymmetric:

- Ax dialects explain what Ax behavior exists.
- Core bodies define portable executable semantics.
- Target templates provide native packaging and host integration.
- `axir verify` proves the emitted packages obey the same fixture contract.
