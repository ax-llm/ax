# AxIR Final Parity Gap Audit

Snapshot: after `Add AxAgent runtime behavior parity`.

AxIR now has executable Python, Java, and C++ targets for the current portable
contract. Default `axir verify --targets python,java,cpp` covers signature,
schema, validation, prompt/template, AxGen, AxAI, AxAgent, AxOptimize,
AxProgram, and AxFlow. Optional runtime-profile verification covers real
QuickJS and Pyodide actor execution.

This audit classifies remaining gaps against the current TypeScript runtime.
The categories are:

- `complete`: covered by Core, generated runtimes, fixtures, and verify.
- `intentional host boundary`: portable shape exists; host code owns execution.
- `deferred feature`: real TS feature that is intentionally outside the current
  portable contract.
- `missing fixture`: TS behavior exists and should be fixture-backed before
  encoding.
- `compiler/runtime bug`: expected portable behavior is known broken.
- `TS behavior changed`: local TS reference moved and AxIR has not caught up.

## Parity Matrix

| Area | Status | Notes |
| --- | --- | --- |
| Signature/schema/validation | complete | Fixtures cover parsing, fluent signatures, JSON schema, value validation, output validation, and internal stripping. |
| Prompt/template | complete | Fixtures cover default prompt rendering, functions, template conditionals, required variables, errors, and section ordering. |
| AxGen | complete for current beta slice | Fixtures cover examples/demos, memory/chat log, assertions, processors, tool calls, retry/correction, streaming fold, structured stream folding, and trace capture. |
| AxAgent pipeline/runtime/policy | complete for current portable slice | Fixtures cover static pipeline, runtime language metadata, actor-loop execution, discovery/recall/used, child delegation, guideAgent, trace/replay, runtime protocol, QuickJS, and Pyodide parity. |
| AxAgent host execution | intentional host boundary | AxIR owns protocol/envelopes/state/log ordering. Real interpreters, sandboxing, permissions, package loading, cancellation enforcement, filesystem/network policy, and native callback bodies remain adapter-owned. |
| Runtime profiles | complete for portability proof | QuickJS and Pyodide prove real model-facing code execution across generated targets. Further sandbox/product policy is not on the AxIR critical path unless selected as product work. |
| AxFlow graph execution | partial | Fixtures cover compact planner, execute/derive/map, returns, explicit parallel, cache keys, dynamic options, nested Flow, trace labels, usage/chat logs, and abort-before-step. TS has additional control-flow, feedback-loop, node extension, streaming cache, and in-flight stop behavior not yet fixture-backed. |
| AxProgram shared contract | partial | AxGen and Flow component contracts exist, but the shared program surface is still thin. More nested Agent/Flow rollout evidence should be added only when a concrete feature needs it. |
| AxOptimize contract | complete for engine boundary | Fixtures cover components, artifacts, apply/rollback, evaluator-aware engines, evidence batches, metrics, judge payloads, and Flow/Agent/Gen component maps. |
| GEPA algorithm | deferred feature | TS has GEPA selection, reflection, bootstrapping, Pareto/minibatch behavior, and selector state. AxIR intentionally models only the swappable optimizer contract and GEPA-compatible evidence shape. |
| AxAI/OpenAI-compatible provider | complete for current beta slice | Fixtures cover request validation, config merge, chat/embed, streaming text/tool deltas, errors, refusal, usage, images, JSON schema, and unsupported media/realtime/transcribe. |
| Broader providers and media | deferred feature | TS has Anthropic, Gemini, Cohere, Mistral, Grok, Reka, HuggingFace, model catalogs, routers/balancers, OpenAI Responses, audio, realtime, speech, and transcription behavior. AxIR currently targets OpenAI-compatible semantics only. |
| TypeScript public AxIR API | complete by omission | No public TypeScript AxIR APIs are added; generated target packages remain the portability surface. |

No current gap is classified as `compiler/runtime bug` or `TS behavior changed`.
The remaining work is mostly deliberate feature selection.

## Prioritized Roadmap

1. **AxAgent Context Budget + Checkpoint Parity**
   - Why: TS AxAgent has substantial prompt-context policy, action-log
     compaction, checkpointing, tombstones, runtime-state provenance, and
     context-pressure behavior. These are Ax decisions that directly shape model
     behavior and should be language-agnostic before broader agent production
     parity.
   - Fixtures: context policy presets, dynamic runtime character budgets,
     checkpoint summaries, action-log compaction modes, error tombstones,
     referenced-state preservation, runtime-state provenance, and abort-aware
     summarizer fallback.
   - Backends: Python, Java, C++.
   - Boundary: Core semantics plus host summarizer callback boundary.

2. **AxFlow Control-Flow Runtime Parity**
   - Why: Flow is now a smaller Ax program graph, but TS still has while loops,
     branches, feedback loops, node extension helpers, streaming cache behavior,
     in-flight stop behavior, and richer parallel merge error paths beyond the
     current fixtures.
   - Fixtures: while/branch/feedback execution, nested control-flow barriers,
     nodeExtended/nx signatures, streaming cache short-circuit, stop during
     running node, merge errors, and autoParallel false/override behavior.
   - Backends: Python, Java, C++.
   - Boundary: mostly Core graph semantics; host callbacks remain target-owned.

3. **AxAI Provider Breadth Selection**
   - Why: OpenAI-compatible parity is solid, but TS provider behavior contains
     many Ax decisions around Responses API, audio, realtime, model catalogs,
     routing, balancing, and provider-specific payload quirks.
   - Fixtures: choose one provider/feature family at a time. The first useful
     candidates are OpenAI Responses/audio/realtime or Gemini/Anthropic mapping,
     depending on product priority.
   - Backends: Python, Java, C++.
   - Boundary: Core-owned mapping/normalization; target-owned transport and
     network execution.

4. **GEPA Engine Port**
   - Why: The optimizer contract is done, but TS GEPA remains an algorithmic
     engine with reflection, selection, Pareto, bootstrapping, and dependency
     logic. Port it only if generated targets should ship GEPA, not merely
     accept optimizer engines.
   - Fixtures: GEPA reflection summaries, selector state, Pareto acceptance,
     bootstrap demos, feedback-only examples, max metric call budgets, and
     descendant component optimization.
   - Backends: Python, Java, C++.
   - Boundary: generated optimizer engine implementation, not Core contract
     expansion unless reusable semantics fall out.

5. **Runtime Productization**
   - Why: QuickJS/Pyodide profiles are done as portability proofs. Production
     sandbox policy, filesystem/network permissions, package loading, hard
     cancellation, and dependency packaging are real work but not required for
     AxIR semantic portability.
   - Fixtures: only add if these adapters become product-supported runtimes.
   - Backends: profile-specific.
   - Boundary: adapter-owned policy with AxIR-owned envelope/log/trace shapes.

## Default Recommendation

Do **AxAgent Context Budget + Checkpoint Parity** next. It is the highest-value
remaining semantic gap because it affects what the model sees during long agent
runs, not just transport or packaging. Runtime profiles should stay frozen
unless a bug falls out of this work.
