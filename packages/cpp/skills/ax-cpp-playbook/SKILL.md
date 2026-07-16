---
name: "ax-cpp-playbook"
description: "Use when writing C++ code with `axllm` for the playbook() context-engineering surface, agent-bound verified evolution, run-end learning, online updates, and rendering a playbook into a program."
version: "23.0.1"
---
# Ax Playbook For C++

This skill helps an agent write C++ code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Grow an evolving context playbook for a program or agent stage with playbook().
- Attach a seed playbook to an agent and learn bounded avoidance rules from run-end failure signals.
- Use the agent-bound playbook evolve method to mine grounded weaknesses with verification and exact rollback.
- Refine a playbook online from live feedback or offline from labeled examples.
- Render or persist a playbook and inject it into a program context.

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
auto program = axllm::ax("question:string -> answer:string");
auto pb = axllm::playbook(program, *llm);
pb.evolve(examples, metric_fn);
```

## Relevant API Surface

- Optimizers: `axllm::optimize`, `axllm::playbook`, `axllm::AxPlaybook`, `axllm::AxBootstrapFewShot`, `axllm::AxGEPA`, `axllm::OptimizerEngine`, `axllm::OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.