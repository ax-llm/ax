---
name: "ax-go-flow"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for flows, nodes, program graphs, nested programs, dynamic options, caching, and optimizer components."
version: "24.0.17"
---
# AxFlow For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Compose generators, agents, and nested flows into a workflow graph.
- Reason about flow state, node inputs, returns, caching, and errors.
- Use generated package examples for flow graphs and provider-backed flows.

## Package Facts

- Language: Go.
- Package: `github.com/ax-llm/ax/packages/go`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-goja`.

## Core Pattern

```go
draft := ax.NewAx("topicText:string -> draftText:string", nil)
wf := ax.NewFlow(map[string]ax.Value{"id": "docs.coreFlow"}).
  Execute("draft", draft, map[string]ax.Value{
    "reads": ax.Array("topicText"),
    "writes": ax.Array("draftResult", "draftText"),
  }).
  Returns(map[string]ax.Value{"draftText": "draftText"})
```

## More Patterns

### Typed programs

Build each flow node from its own input/output contract.

```go
classifier := ax.NewAx("requestText:string -> route:class \"support, sales, engineering\"", nil)
responder := ax.NewAx("requestText:string, route:string -> responseText:string", nil)
```

### Class decision

Declare reads and writes so the responder waits for the typed route.

```go
branchFlow := ax.NewFlow(map[string]ax.Value{"id": "docs.branchFlow"}).
  Execute("classifier", classifier, map[string]ax.Value{"reads": ax.Array("requestText"), "writes": ax.Array("classifierResult", "route")}).
  Execute("responder", responder, map[string]ax.Value{"reads": ax.Array("requestText", "route"), "writes": ax.Array("responderResult", "responseText")}).
  Returns(map[string]ax.Value{"route": "route", "responseText": "responseText"})
```

### Fan-out and join

Independent reads place research and audience analysis in one planner group. Owned clients and programs run concurrently; unsupported custom workers use a traced serial fallback.

```go
parallelFlow := ax.NewFlow(map[string]ax.Value{"id": "docs.parallelFlow"}).
  Execute("research", research, map[string]ax.Value{"reads": ax.Array("topicText"), "writes": ax.Array("researchResult", "factList")}).
  Execute("audience", audience, map[string]ax.Value{"reads": ax.Array("topicText"), "writes": ax.Array("audienceResult", "audienceAngle")}).
  Execute("join", join, map[string]ax.Value{"reads": ax.Array("factList", "audienceAngle"), "writes": ax.Array("joinResult", "briefText")}).
  Returns(map[string]ax.Value{"briefText": "briefText"})
```

### Draft, critique, revise

A linear refinement pipeline makes each dependency explicit.

```go
refineFlow := ax.NewFlow(map[string]ax.Value{"id": "docs.refineFlow"}).
  Execute("draft", draft, map[string]ax.Value{"reads": ax.Array("topicText"), "writes": ax.Array("draftResult", "draftText")}).
  Execute("critique", critique, map[string]ax.Value{"reads": ax.Array("draftText"), "writes": ax.Array("critiqueResult", "critiqueText")}).
  Execute("revise", revise, map[string]ax.Value{"reads": ax.Array("draftText", "critiqueText"), "writes": ax.Array("reviseResult", "revisedText")}).
  Returns(map[string]ax.Value{"revisedText": "revisedText"})
```

### Run a flow

Forward accepts the context, provider client, public inputs, and options.

```go
output, err := parallelFlow.Forward(
  ctx, client,
  map[string]ax.Value{"topicText": "Typed LLM workflows"},
  nil,
)
```

Start from the complete programs under `examples/`, then browse the larger gallery at https://axllm.dev/go/subsystems/flow/.

## Astra Session Work

Select `gpt-6-astra` through the ordinary OpenAI factory. The adapter chooses Responses automatically; existing model defaults are unchanged. Use low reasoning and standard processing. Portable minimal reasoning maps to low; none is rejected. EU residency does not support priority processing.

Keep applications on their generation, agent, and flow entrypoints. Declare only independent tools as background; ordinary and imported MCP tools stay blocking unless the application explicitly changes their declaration. A promise, thread, or MCP hint is not a background declaration. Set `asyncMode` to `off` for the ordinary tool loop; chat-only services retain that loop automatically.

Attach the language-native run controller through forward options for steering, reasoning changes, cancellation, and lifecycle events. Queued and applied are different states. HTTP applies updates at a response boundary; an optional host WebSocket enables native steering. Do not manage response IDs, socket messages, or tool-result submission in application code.

A provisional answer is not successful completion while started tools remain unresolved. Cancellation closes the session and reports unresolved call IDs; it cannot undo an external action. Handlers may cooperate through the invocation cancellation context. Late results from noncooperative work must not change a closed run or trigger replay.

Java, C++, and Rust WebSocket adapters track activity when frames arrive. Consuming buffered events does not reactivate a completed response. When no response is active, steering is queued for the next response; an active successor can still receive native steering. Observe lifecycle timing instead of assuming native application.

All five session adapters validate completed raw arguments against the shared Core validator before invoking handlers, including local references, unions, nested schemas, additional properties, and numeric/string/array constraints. Invalid arguments enter correction; step exhaustion fails the run.

Independent flow nodes use owned program and client workers. Built-in providers, routers, and balancers supply factories; custom implementations without them run the entire group serially and emit a flow_parallel_fallback trace. Rust does not require Send/Sync on the existing client trait. Rust nested flows and custom AxExecutableProgram implementations use execute_program; an optional AxOwnedProgramFactory constructs state on its worker. Workers deliver events and results to the owner, which merges successful results in plan order. On group failure, cancellation preserves completed diagnostics and discards late deliveries.

Use the provider-backed Astra examples under `src/examples/go/generation/`, `short-agents/`, and `flows/`. All-five generated parity remains under verification in the shared-session AxIR backlog; do not infer full agent, parallel-flow, or transport parity from these examples alone.

## Relevant API Surface

- Flow: `axllm.NewFlow`, `axllm.AxFlow`, `AxOwnedProgramFactory.OwnedWorkerFactory`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
