---
name: "ax-cpp-agent-optimize"
description: "Use when writing C++ code with `axllm` for agent optimization, evaluators, judges, optimizer artifacts, BootstrapFewShot, and GEPA."
version: "22.0.7"
---
# AxAgent Optimize For C++

This skill helps an agent write C++ code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Optimize an AxAgent or reusable program component.
- Create evaluator callbacks and persist optimizer artifacts.
- Keep optimization runs bounded by explicit budgets and dataset rows.

## Package Facts

- Language: C++.
- Package: `axllm`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```cpp
axllm::AxGEPA engine(reflection_client, options);
auto result = engine.optimize(request, evaluator);
```

## Relevant API Surface

- Agents And RLM: `axllm::agent`, `axllm::AxAgent`
- Optimizers: `axllm::optimize`, `axllm::AxBootstrapFewShot`, `axllm::AxGEPA`, `axllm::OptimizerEngine`, `axllm::OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
