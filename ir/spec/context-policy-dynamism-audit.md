# AxIR Context Policy Dynamism Audit

Snapshot: after `AxIR AxAgent Context Budget + Checkpoint Parity`, updated by
`AxIR AxAgent Policy Vocabulary Registry Consolidation`.

This audit checks whether AxIR can absorb frequent TypeScript AxAgent
`contextPolicy` changes without scattering prompt-budget decisions across target
runtimes. The current generated Python, Java, and C++ packages verify green, but
the context policy layer was only partly churn-friendly before the registry
consolidation.

## Verdict

AxIR has the right ownership boundary: generated targets do not hand-code
context-budget behavior, and the actor prompt fields are Core-owned. The
previous weak spot was inside `ir/axcore/agent.axir`, where volatile policy
vocabulary was embedded as procedural branches. The registry consolidation moves
that vocabulary into versioned Core data while leaving stable mechanics
procedural.

## Rule Classification

| Rule family | Classification | Current AxIR state |
| --- | --- | --- |
| Public option names and migration errors | registry/table data | Core validates `contextPolicy` and `executorModelPolicy` from vocabulary-registry keys and migration-error entries. |
| Presets and budgets | registry/table data | `resolve_agent_context_policy` consumes registry preset and budget profiles instead of owning preset/budget branch ladders. |
| Budget numbers and pressure thresholds | registry/table data plus stable Core math | Target prompt chars, inspect thresholds, checkpoint trigger ratios, pressure cutoffs, runtime decay floor, and pressure text are registry data; the math remains Core. |
| Actor input placement | stable Core invariant | `summarizedActorLog`, `actionLog`, `liveRuntimeState`, `contextPressure`, guidance, discovery, and memory placement should remain procedural Core behavior. |
| State export/restore placement | stable Core invariant | Context policy, context events, checkpoints, runtime summaries, and actor model routing state are correctly part of portable state. |
| Context event recording | stable Core invariant plus registry vocabulary | Event ordering and non-fatal callback behavior are stable; event kind names and reasons are registry data. |
| Action-log replay and compaction | mixed | Core covers checkpoint summaries, full replay, compact entries, and compaction events; TS has richer replay-mode assignment, distillation, omission, tombstones, and provenance. |
| Checkpoint summaries | mixed | Core owns deterministic fallback summaries; TS also has model-generated checkpoint summaries, working-state separation, supersession notes, summarizer option forwarding, and abort-aware summary calls. |
| Runtime-state summaries | stable Core invariant | JSON-safe rendering and reserved-name exclusion belong in Core; entry limits and max chars should be policy data. |
| Executor model routing | mixed | Core covers ordered model selection by error turns and namespaces; TS has stricter validation and restored-state normalization not fully fixture-backed. |
| Target templates | target-runtime helper | Template hits are declarations/imports, conformance checks, JSON/string helpers, and generated Core output. No target template owns context-policy choices. |

## Fixture Coverage

Covered by current `ir/conformance/axagent` fixtures:

- default `checkpointed`/`balanced` policy and `lean`/`compact` policy
- migration errors for `contextPolicy.state`, nested `summarizerOptions`, and legacy executor model prompt thresholds
- effective chat budget, dynamic runtime char decay, pressure labels, and large-array `smartStringify`
- checkpoint replay, lean pressure compaction, deterministic fallback checkpoint creation, runtime-state summary rendering
- exported/restored state carrying context policy, context events, checkpoints, runtime summaries, and actor model state

Missing or thin fixture areas from the current TS reference:

- `contextPolicy.checkpoints` and generic unknown `contextPolicy` key migration errors
- strict `executorModelPolicy` validation for non-object entries, missing model, non-integer/negative `aboveErrorTurns`, empty/non-string namespaces, and all legacy field names
- action-log replay modes `distill` and `omit`, structured output distillation, proactive grace windows, user-constraint signals, policy payload preservation, and referenced-variable preservation
- model-generated tombstone summaries and `tombstone_created` events
- model-generated checkpoint summaries, summarizer option precedence, abort forwarding, summary failure fallback, working-code-state split, and supersession notes
- runtime-state summary max-char behavior, deep object truncation, error stack truncation, and circular/depth-limited `smartStringify`
- actor model state reset on checkpoint fingerprint changes and restored legacy actor-model state normalization

## Generated Target Check

The emitted Python, Java, and C++ packages contain policy strings only through
generated Core functions and conformance fixtures. Template-level hits are
limited to helper declarations/imports, generic JSON/string helper behavior,
capability manifests, and conformance assertions. That means the portability
boundary is sound: policy choices are not duplicated manually per backend.

## Recommendation

The registry consolidation is now the baseline: `agent_policy_vocabulary_registry`
and `agent_context_policy_registry` store preset tables, budget tables, pressure
labels, event names, migration key maps, runtime-output constants, and executor
model policy legacy-key lists as data. Core procedures consume that data for
resolution, budget math, actor input construction, checkpoint state, event
recording, and export/restore.

The remaining work is fixture depth, not another architecture turn. Add TS-derived
fixtures for the still-thin areas above as those semantics become important.

Do not refactor stable mechanics into data. Prompt field placement, state
mutation order, context event append behavior, checkpoint fallback construction,
and generated target helper code should remain procedural unless TS changes
their semantics.
