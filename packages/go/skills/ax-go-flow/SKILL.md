---
name: "ax-go-flow"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for flows, nodes, program graphs, nested programs, dynamic options, caching, and optimizer components."
version: "23.0.5"
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

### Parallel fan-out and join

Independent reads let research and audience analysis share one planner group.

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

## Relevant API Surface

- Flow: `axllm.NewFlow`, `axllm.AxFlow`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.