---
name: "ax-go-playbook"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for the playbook() context-engineering surface, evolving task knowledge, online updates, and rendering a playbook into a program."
version: "23.0.0"
---
# Ax Playbook For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Grow an evolving context playbook for a program or agent stage with playbook().
- Refine a playbook online from live feedback or offline from labeled examples.
- Render or persist a playbook and inject it into a program context.

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
program := ax.NewAx("question:string -> answer:string", nil)
pb := ax.Playbook(program, map[string]ax.Value{"studentAI": llm})
pb.Evolve(ctx, examples, metricFn, nil)
```

## Relevant API Surface

- Optimizers: `axllm.Optimize`, `axllm.AxBootstrapFewShot`, `axllm.AxGEPA`, `axllm.OptimizerEngine`, `axllm.OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
