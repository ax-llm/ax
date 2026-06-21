---
name: "ax-cpp-agent-observability"
description: "Use when writing C++ code with `axllm` for agent tracing, usage accounting, action logs, runtime diagnostics, replay, and production debugging."
version: "22.0.6"
---
# AxAgent Observability For C++

This skill helps an agent write C++ code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Inspect agent traces, runtime envelopes, usage, or action logs.
- Attach callbacks for model/tool activity and runtime progress.
- Debug agent loops through generated package state and examples.

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
auto helper = axllm::agent("question:string -> answer:string");
auto out = helper.forward(llm, { {"question", "How should I proceed?"} });
```

## Relevant API Surface

- Agents And RLM: `axllm::agent`, `axllm::AxAgent`
- Runtime Profiles: `axllm::ProcessCodeRuntime`, `axllm::RuntimeCapabilities`, `axllm::RuntimeEnvelope`, `javascript-quickjs`, `python-pyodide`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.