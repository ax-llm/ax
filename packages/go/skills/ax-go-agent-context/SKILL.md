---
name: "ax-go-agent-context"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for deciding between context maps, trajectory context policy, offline optimization (ACE/GEPA), and memory recall for long-context agents."
version: "22.0.8"
---
# AxAgent Context Selection For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Choose between contextMap, contextPolicy, optimization, and recall for a task.
- Avoid mixing persistent corpus orientation with within-run compaction.
- Route long-context agent work to the right generated-package feature.

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
- Optimizers: `axllm.Optimize`, `axllm.AxBootstrapFewShot`, `axllm.AxGEPA`, `axllm.OptimizerEngine`, `axllm.OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.