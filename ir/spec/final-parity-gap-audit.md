# AxIR Final Parity Gap Audit

Snapshot: after AxAgent context/checkpoint parity, AxFlow control-flow parity,
descriptor-backed OpenAI Responses/Gemini/Anthropic/OpenAI-compatible catalog
providers, AxAI model catalog/provider-routing parity, and generated GEPA.

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
| AxAgent pipeline/runtime/policy/context | complete for current portable slice | Fixtures cover static pipeline, runtime language metadata, actor-loop execution, discovery/recall/used, child delegation, guideAgent, trace/replay, runtime protocol, QuickJS, Pyodide parity, context budgets, action-log compaction, checkpoint/tombstone summaries, runtime-state provenance, and policy vocabulary registry behavior. |
| AxAgent host execution | intentional host boundary | AxIR owns protocol/envelopes/state/log ordering. Real interpreters, sandboxing, permissions, package loading, cancellation enforcement, filesystem/network policy, and native callback bodies remain adapter-owned. |
| Runtime profiles | complete for portability proof | QuickJS and Pyodide prove real model-facing code execution across generated targets. Further sandbox/product policy is not on the AxIR critical path unless selected as product work. |
| AxFlow graph execution | complete for current portable slice | Fixtures cover compact planner, execute/derive/map, returns, branch, while, feedback, node extension helpers, nested control-flow barriers, explicit parallel/merge errors, cache keys, streaming cache short-circuit, dynamic options, nested Flow, trace labels, usage/chat logs, autoParallel overrides, and stop/abort checkpoints. |
| AxProgram shared contract | partial | AxGen and Flow component contracts exist, but the shared program surface is still thin. More nested Agent/Flow rollout evidence should be added only when a concrete feature needs it. |
| AxOptimize contract and GEPA engine | complete for current portable slice | Fixtures cover components, artifacts, apply/rollback, evaluator-aware engines, evidence batches, metrics, judge payloads, Flow/Agent/Gen component maps, plus generated `AxGEPA` selection, reflection validation retry, selector state restore, Pareto metadata, bootstrapped demos, metric-call budgets, and dependency-group optimization. |
| AxAI provider descriptors/catalog/routing/balancing | complete for current portable slice | Fixtures cover OpenAI-compatible, OpenAI Responses/audio/realtime normalization, Gemini Developer API, Anthropic Developer API, Azure OpenAI, DeepSeek, Mistral, Reka, Cohere, Grok, TS model catalog semantics, generated catalog APIs, multi-service model-key routing, stable provider-router analysis/validation/stats, and AxBalancer selection/failover semantics. |
| Broader providers and live routing | deferred feature | Hugging Face remains catalog-audited but not generated, and TS still has Vertex routes, Gemini Live depth, Grok deeper realtime/audio parity, Anthropic Vertex/web-search transport, and product-grade live backoff/timer policy. These are deferred because transport/auth/retry/media processing are host-owned or product-level choices. |
| TypeScript public AxIR API | complete by omission | No public TypeScript AxIR APIs are added; generated target packages remain the portability surface. |

No current gap is classified as `compiler/runtime bug` or `TS behavior changed`.
The remaining work is mostly deliberate feature selection.

## Prioritized Roadmap

1. **Provider Product Depth, If Needed**
   - Why: Descriptor-backed text/chat coverage is broad enough. The remaining
     provider work is Hugging Face, Vertex variants, Gemini Live, Grok audio or
     realtime depth, Anthropic web-search/Vertex, and live retry/backoff policy.
   - Fixtures: provider-specific request/response/stream/usage shapes from TS.
   - Backends: Python, Java, C++.
   - Boundary: Core-owned mapping and target-owned transport.

2. **Runtime Productization**
   - Why: QuickJS/Pyodide profiles are done as portability proofs. Production
     sandbox policy, filesystem/network permissions, package loading, hard
     cancellation, and dependency packaging are real work but not required for
     AxIR semantic portability.
   - Fixtures: only add if these adapters become product-supported runtimes.
   - Backends: profile-specific.
   - Boundary: adapter-owned policy with AxIR-owned envelope/log/trace shapes.

## Default Recommendation

GEPA is no longer the obvious semantic blocker once the generated engine
fixtures are green. The next milestone should be chosen by product priority:
deepen a provider only if the product needs that wire behavior, or start runtime
productization only if QuickJS/Pyodide are being promoted from portability
proofs to supported production adapters.
