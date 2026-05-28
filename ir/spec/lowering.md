# AxIR Lowering Pipeline

The Go compiler uses staged lowering:

1. `parse`: read `.axir` modules.
2. `resolve`: load imports and collect symbols.
3. `check`: validate dialect names, refs, public symbols, reserved agent ops.
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
orchestration, AxAI normalization, provider JSON mapping, memory, trace, and
example/demo ordering.

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
