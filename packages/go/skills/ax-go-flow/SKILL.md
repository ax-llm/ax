---
name: "ax-go-flow"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for flows, nodes, program graphs, nested programs, dynamic options, caching, and optimizer components."
version: "22.0.7"
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
wf := ax.NewFlow(nil)
// See examples/axflow_program_graph/main.go for node wiring.
```

## Relevant API Surface

- Flow: `axllm.NewFlow`, `axllm.AxFlow`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.