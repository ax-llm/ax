---
name: "ax-python-agent-rlm"
description: "Use when writing Python code with `axllm` for RLM executor loops, AxCodeRuntime sessions, runtime envelopes, process runtimes, and optional runtime profiles."
version: "23.0.2"
---
# AxAgent RLM Runtime For Python

This skill helps an agent write Python code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Wire an AxCodeRuntime or AxCodeSession implementation.
- Use ProcessCodeRuntime or an optional runtime profile for actor-code sessions.
- Explain that generated packages are not TypeScript transpilers; they adapt the Ax runtime contract.

## Package Facts

- Language: Python.
- Package: `axllm`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```python
from axllm import agent

helper = agent("question:string -> answer:string")
out = helper.forward(llm, {"question": "How should I proceed?"})
```

## Relevant API Surface

- Agents And RLM: `agent`, `AxAgent`
- Runtime Profiles: `ProcessCodeRuntime`, `RuntimeCapabilities`, `RuntimeEnvelope`, `javascript-quickjs`, `python-pyodide`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.