# Ax Architecture

Ax is a TypeScript-first framework for building typed AI programs, agents,
flows, and optimizers. The same runtime semantics are also compiled through
AxIR into language-agnostic Python, Java, C++, Go, and Rust libraries.

For compiler and IR details, see [`docs/COMPILER.md`](./COMPILER.md). For
audio and realtime usage, see [`docs/AUDIO.md`](./AUDIO.md). For reward-scored
candidate selection and feedback rounds, see [`docs/REFINE.md`](./REFINE.md).

## System Shape

Ax has seven main runtime surfaces:

1. **AxAI**: provider clients, model catalog metadata, chat, streaming,
   embeddings, transcribe/speak, audio/realtime operations, routing, and
   balancing.
2. **AxGen**: signature-driven structured generation, prompts, tools, retries,
   schema validation, assertions, `bestOfN(...)`, `refine(...)`,
   streaming assertions,
   examples/demos, memory, usage, traces, and streaming folds.
3. **AxAgent**: a staged agent pipeline with actor runtime sessions,
   discovery/recall/used protocols, child delegation, context budgets,
   checkpoint summaries, action logs, state export/restore, and runtime
   profiles.
4. **AxFlow**: an Ax program graph with child program calls, dependency
   planning, auto-parallel grouping, branch/while/feedback control flow,
   caching, merge semantics, and `.returns()` output projection.
5. **AxOptimize**: optimizable component inventory, evaluator rollouts,
   serialized artifacts, and optimizer engines including GEPA.
6. **AxEventRuntime**: a protocol-neutral durable-inbox and explicit-route layer
   for observing, invalidating, waking, and resuming Ax programs.
7. **AxIR generated libraries**: Python, Java, C++, Go, and Rust packages emitted from
   the shared portable semantics.

These surfaces are connected by the shared Ax program contract: `forward`,
inputs, outputs, examples, demos, traces, usage, chat logs, optimizer
components, and evaluation hooks.

## TypeScript Runtime

The TypeScript package `@ax-llm/ax` is the reference implementation and the
primary public API. New code should use the factory-style surface:

```ts
import { agent, ai, ax, bestOfN, flow, fn, refine, s } from '@ax-llm/ax';
```

The core TypeScript modules are:

- `src/ax/ai/`: provider implementations and model metadata
- `src/ax/dsp/`: signatures, generation, validation, tools, prompts,
  assertions, streaming assertions, `bestOfN(...)`, `refine(...)`, and optimizers such as GEPA
- `src/ax/agent/`: AxAgent pipeline, runtime/session policy, context budget,
  checkpointing, discovery, memory, delegation, and state
- `src/ax/flow/`: AxFlow graph API, step model, executor, and planner
- `src/ax/event/`: event envelopes, stores, sources, routes, continuations,
  targets, sink delivery, and protocol adapters
- `src/ax/funcs/`: JavaScript runtime, security policy helpers, sessions, and
  worker integration
- `src/ax/trace/`: OpenTelemetry integration and portable trace data

TypeScript is not transpiled to other languages. AxIR extracts conformance from
the TypeScript behavior and compiles shared Ax semantics into native target
libraries.

## AI Providers

All providers implement the `AxAIService` contract. Ax normalizes:

- chat and streaming chat
- embeddings
- tool/function calls and JSON schema output
- usage and cost metadata
- provider errors and retryable status
- batch audio APIs: `ai.transcribe(...)` and `ai.speak(...)`
- conversational audio/realtime `.chat()` operations

Provider mapping is descriptor-backed in AxIR. OpenAI-compatible providers,
OpenAI Responses, Gemini, Anthropic, Azure OpenAI, DeepSeek, Mistral, Reka,
Cohere, and Grok share Core request/response normalization. Grok Voice and
Gemini Live use reusable realtime-audio grammar profiles. Targets still own
real HTTP, SSE, WebSocket, auth, retry, and binary media transport.

## Signatures And AxGen

Signatures describe program inputs and outputs:

```ts
const classify = ax('question:string -> answer:string, confidence:number');
```

The signature system supports scalar, JSON, class, date/time, media, and code
fields. Audio inputs are media inputs; top-level audio outputs are scripted
speech artifacts synthesized through `ai.speak(...)` after structured output
selection.

AxGen turns a signature into a typed program. It owns prompt assembly,
examples/demos, tool calls, retries, output parsing, streaming fold semantics,
field processors, validation, memory/chat-log ordering, usage, and traces.

Validation, selection, and streaming safety are separate mechanisms:

- Schema validation retries with parser/constraint feedback.
- `addAssert(...)` checks whole-output hard invariants after validation and
  processors, then retries with correction feedback when it fails.
- `bestOfN(...)` scores complete candidates and returns the highest-reward
  prediction or first threshold hit.
- `refine(...)` runs complete-output feedback rounds and can apply temporary
  reward-derived advice to instruction components.
- `addStreamingAssert(...)` aborts unsafe partial streaming output for the
  current attempt with `AxStreamingAssertionError`, then uses the assertion
  message as correction feedback when retries remain.

## AxAgent

AxAgent builds higher-level programs on top of AxGen. It shapes task inputs,
executes model-written actor code through an `AxCodeRuntime` session, handles
protocol calls such as `final(...)`, `askClarification(...)`, `discover(...)`,
`recall(...)`, `used(...)`, and `guideAgent(...)`, then returns typed outputs.

The agent runtime is a host boundary. Ax owns the portable envelopes, reserved
names, restart policy, action-log records, trace events, state shape, context
budget, checkpoint/tombstone summaries, and model-visible prompt placement.
The host owns the actual interpreter, sandboxing, filesystem/network policy,
native cancellation, and callback bodies.

TypeScript ships `AxJSRuntime` as the canonical JavaScript actor runtime.
Generated AxIR libraries also include optional runtime profiles:

- QuickJS for JavaScript actor code in Java/C++/Rust, with Python driving a
  QuickJS protocol server
- goja for Go-native JavaScript actor code through the generated
  `runtime/goja` package
- Pyodide for Python actor code
- Rust keeps `ProcessCodeRuntime` for the shared JSONL process protocol and
  adds embedded QuickJS behind the `runtime-quickjs` Cargo feature.

Those profiles are supportable adapters, not a replacement for the TypeScript
runtime.

`AxJSRuntime` is defense-in-depth for LLM-authored code, not a container or VM
boundary. Host callbacks and granted runtime permissions remain the authority
boundary; keep durable secrets and privileged effects in host-side functions.

## AxFlow

AxFlow is an Ax program graph, not a generic workflow engine. Flow nodes call
AxGen, AxAgent, or nested AxFlow programs through the shared program boundary.

The current Flow runtime uses a compact step model, shared executor, and
planner. Known non-conflicting execute/derive steps may be grouped; map,
returns, control flow, explicit parallel/merge, unknown reads, and unsafe state
effects are planning barriers. Branch, while, feedback, node extension helpers,
streaming cache short-circuit, stop/abort checkpoints, and merge errors are
part of the portable graph semantics.

## AxEventRuntime

AxEventRuntime connects supervised sources to an inbox, selects an explicit
route action, invokes an AxGen, AxAgent, or AxFlow target when authorized,
persists the result, and then dispatches sinks. Protocol callbacks only publish
events; they never invoke models directly. Event payloads remain untrusted data
until a target's signature-aware input plan selects them. `eventPath` uses
segment-safe descriptors for envelope data, extensions, verified identity,
trust, correlation, and continuation metadata. Mapping and signature failures
dead-letter before invocation begins. Fan-out is represented as multiple
matching routes so each target retains independent authorization, ordering,
retry, cancellation, and run state.

The in-memory store is volatile and single-worker. Crash-safe, cooperating
multi-process execution requires the conforming SQLite store from the Node-only
tools entry point. AxIR specifies deterministic routing, input mapping, retry
classification, continuation matching, output-before-sink ordering, and adapter
normalization. Generated-language runtimes dispatch inline without hidden
worker threads; their hosts own timers, listener supervision, and other
asynchronous loops. See
[`docs/EVENT_RUNTIME.md`](./EVENT_RUNTIME.md).

## Optimization And GEPA

Programs expose optimizable components and can evaluate candidate component
maps without leaking state between rollouts. Optimizer artifacts are serialized
and validated before mutation, so optimized programs can be exported, loaded,
and applied later.

Multiple optimization strategies serve different needs:

- `optimize(...)`: normal helper that composes BootstrapFewShot -> GEPA
- `AxBootstrapFewShot`: few-shot demo selection
- `bestOfN(...)`: reward-scored complete-candidate selection
- `refine(...)`: reward-scored feedback rounds
- `AxGEPA`: multi-objective Pareto optimization

GEPA is one shipped optimizer engine. Top-level `optimize(...)` seeds GEPA with
`AxBootstrapFewShot` demos first, then runs GEPA with internal bootstrap
disabled and returns an artifact for the caller to apply. GEPA runs through the existing
`OptimizerEngine.optimize(request, evaluator)` boundary and owns reflection,
selection, Pareto acceptance, bootstrapping, selector state, metric budgets, and
descendant component optimization. The optimizer contract itself remains
engine-agnostic.

## AxIR Generated Libraries

AxIR makes Ax portable without freezing the TypeScript implementation into a
source-to-source transpiler. The compiler emits:

- Python package `axllm`
- Java package `dev.axllm.ax`
- C++ namespace `axllm` and CMake target `axllm::axllm`
- Go module `github.com/ax-llm/ax/packages/go` and package `axllm`
- Rust crate `axllm`

Generated libraries include package metadata, examples, capability manifests,
and conformance runners. They preserve Core-owned Ax semantics while using each
target's native naming, exceptions, callbacks, package layout, and build tools.
See [`docs/RELEASE.md`](./RELEASE.md) for publishable package names and release
smoke checks.

This is the language-agnostic contract: Ax behavior is specified once, verified
by fixtures, and emitted into idiomatic libraries for each target.

## Observability And Safety

Ax records usage, traces, chat logs, retries, tool calls, agent actions, flow
node events, and optimizer evidence in portable shapes. OpenTelemetry is
available in the TypeScript runtime, while generated targets expose the same
semantic trace/log data through their native APIs.

Security-sensitive behavior is deliberately host-owned. API keys, network
transport, runtime sandboxing, package loading, filesystem access, native
process control, and hard cancellation stay outside Core. AxIR defines the
envelopes and state/log/trace semantics that host code must preserve.

## Contributing

When changing Ax behavior:

1. Update TypeScript behavior and focused tests.
2. Add TS-derived AxIR fixtures if the behavior is portable.
3. Encode language-agnostic semantics in Core helpers or descriptors.
4. Keep generated target templates limited to idiomatic wrappers and host
   integration.
5. Update the relevant docs in `docs/` and skills in `src/ax/skills/` when the
   public behavior changes.

Do not edit generated docs under `website/.generated/`, and do not hand-edit
generated AxIR target output.
