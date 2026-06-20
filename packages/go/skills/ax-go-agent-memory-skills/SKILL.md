---
name: "ax-go-agent-memory-skills"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for agent memory, recall callbacks, dynamic skill discovery, loaded-skill state, and used-skill tracking."
version: "22.0.5"
---
# AxAgent Memory And Skills For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Load memories or skill guides into an RLM agent run.
- Track which memories or skills actually influenced a turn.
- Keep recall and skill search as host callbacks rather than generated-package global state.

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
helper := ax.NewAgent("question:string -> answer:string", nil)
out := helper.Forward(llm, map[string]ax.Value{"question": "How should I proceed?"}, nil)
```

## Relevant API Surface

- Agents And RLM: `axllm.NewAgent`, `axllm.AxAgent`
- Runtime Profiles: `axllm.ProcessCodeRuntime`, `axllm.RuntimeCapabilities`, `axllm.RuntimeEnvelope`, `javascript-goja`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.