---
name: "ax-cpp-signature"
description: "Use when writing C++ code with `axllm` for string signatures, field descriptors, JSON schema output, validation, and typed tool argument shapes."
version: "22.0.7"
---
# Ax Signatures For C++

This skill helps an agent write C++ code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Declare input and output contracts with native generated-package APIs.
- Generate JSON-schema-compatible shapes for outputs, tools, prompts, and validation.
- Keep Standard Schema and TypeScript-only helper libraries out of generated-language code.

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
#include "axllm/axllm.hpp"

auto sig = axllm::s("question:string -> answer:string");
auto schema = axllm::to_json_schema(axllm::Core::get(sig, "outputs"));
```

## Relevant API Surface

- Signatures: `axllm::s`, `axllm::FieldType`, `axllm::AxSignature`
- Tools: `axllm::Tool`, `axllm::Tool`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
