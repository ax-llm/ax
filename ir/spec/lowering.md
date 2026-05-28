# AxIR Lowering Pipeline

The Go compiler uses staged lowering:

1. `parse`: read `.axir` modules.
2. `resolve`: load imports and collect symbols.
3. `check`: validate dialect names, refs, public symbols, reserved agent ops.
4. `canonicalize`: stable formatter output and operation ordering.
5. `lower --to core`: convert Ax dialect ops with `core_kind` into Core ops.
6. `runtime-model`: extract the Ax runtime package model and target idiom
   contract from lowered Core.
7. `compile`: emit source from the runtime model.

Current V1 lowering is declaration-oriented: Ax runtime operations lower to Core
records, functions, interfaces, errors, and semantic declarations. Later passes
can expand semantic declarations into explicit Core regions and blocks.

For Python AxAI + AxGen beta, code generation is still template-backed, but the
templates consume `AxRuntimeModel`. Capabilities emitted by those templates must
be declared as Ax semantic operations and visible after `lower --to core`. The
generated conformance runner then executes fixtures against the emitted Python
package rather than against a hand-written test harness.
