---
name: "ax-python-refine"
description: "Use when writing Python code with `axllm` for reward-scored generation, iterative candidate improvement, evaluator feedback, and optimizer-backed refinement patterns."
version: "23.0.0"
---
# Ax Refinement Patterns For Python

This skill helps an agent write Python code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Improve generated outputs with evaluator feedback or optimizer artifacts.
- Port TypeScript refinement intent into generated-language surfaces without assuming TypeScript-only helpers.
- Use generated optimizer APIs when the target package does not expose a standalone refine helper.

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
from axllm import AxGEPA

engine = AxGEPA(reflection_client)
result = engine.optimize(request, evaluator)
```

## Relevant API Surface

- AxGen: `ax`, `AxGen`
- Optimizers: `optimize`, `AxBootstrapFewShot`, `AxGEPA`, `OptimizerEngine`, `OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.