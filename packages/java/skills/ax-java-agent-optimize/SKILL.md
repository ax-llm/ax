---
name: "ax-java-agent-optimize"
description: "Use when writing Java code with `dev.axllm:ax` for agent optimization, evaluators, judges, optimizer artifacts, BootstrapFewShot, and GEPA."
version: "22.0.8"
---
# AxAgent Optimize For Java

This skill helps an agent write Java code with the generated Ax package `dev.axllm:ax`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Optimize an AxAgent or reusable program component.
- Create evaluator callbacks and persist optimizer artifacts.
- Keep optimization runs bounded by explicit budgets and dataset rows.

## Package Facts

- Language: Java.
- Package: `dev.axllm:ax`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```java
AxGEPA engine = new AxGEPA(reflectionClient, java.util.Map.of());
var result = engine.optimize(request, evaluator);
```

## Relevant API Surface

- Agents And RLM: `Ax.agent`, `AxAgent`
- Optimizers: `Ax.optimize`, `AxBootstrapFewShot`, `AxGEPA`, `OptimizerEngine`, `OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.