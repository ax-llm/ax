---
name: "ax-java-agent-context"
description: "Use when writing Java code with `dev.axllm:ax` for deciding between context maps, trajectory context policy, offline optimization (ACE/GEPA), and memory recall for long-context agents."
version: "22.0.7"
---
# AxAgent Context Selection For Java

This skill helps an agent write Java code with the generated Ax package `dev.axllm:ax`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Choose between contextMap, contextPolicy, optimization, and recall for a task.
- Avoid mixing persistent corpus orientation with within-run compaction.
- Route long-context agent work to the right generated-package feature.

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
AxAgent helper = Ax.agent("question:string -> answer:string", java.util.Map.of());
var out = helper.forward(llm, java.util.Map.of("question", "How should I proceed?"));
```

## Relevant API Surface

- Agents And RLM: `Ax.agent`, `AxAgent`
- Runtime Profiles: `ProcessCodeRuntime`, `RuntimeCapabilities`, `RuntimeEnvelope`, `javascript-quickjs`, `python-pyodide`
- Optimizers: `Ax.optimize`, `AxBootstrapFewShot`, `AxGEPA`, `OptimizerEngine`, `OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.