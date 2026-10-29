---
name: "ax-go-gepa"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for GEPA, Pareto tradeoffs, reflection clients, metric budgets, optimizer state, and artifacts."
version: "25.4.6"
---
# Ax GEPA For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Run the generated GEPA optimizer or inspect a GEPA artifact.
- Use BootstrapFewShot before GEPA when demonstrations should seed optimization.
- Track metric budgets, reflection calls, candidate state, and Pareto fronts.

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
engine := ax.NewGEPA(reflectionClient, nil)
result := engine.Optimize(request, evaluator)
```

## Relevant API Surface

- Optimizers: `axllm.Optimize`, `axllm.Playbook`, `axllm.AxPlaybook`, `axllm.AxBootstrapFewShot`, `axllm.AxGEPA`, `axllm.OptimizerEngine`, `axllm.OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
- GEPA returns baselineScore and baselineScores at the artifact top level and in metadata, measured before bootstrap or component changes. Compare metadata.bestScore with baselineScore; the original candidate need not remain on the Pareto frontier.
- Baseline and seeded validation use the same capped held-out subset and selection scalarization. Both consume maxMetricCalls. Bootstrap generation has separate limits; metadata.bootstrapMetricCalls plus metadata.totalMetricCalls equals metadata.totalCalls. Without new demos, reuse the baseline evaluation.
- Bootstrap demos contain only fresh training inputs and outputs; never recover demos from a retained validation or inactive-child trace tree.