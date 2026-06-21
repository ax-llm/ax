---
name: "ax-cpp-llm"
description: "Use when writing C++ code with `axllm` for using the generated Ax package, factory functions, package docs, examples, and API reference."
version: "22.0.6"
---
# Ax LLM Quick Reference For C++

This skill helps an agent write C++ code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Start a generated-language Ax program from package docs or examples.
- Translate the Ax mental model into the target package without TypeScript-only imports.
- Choose the native package entrypoints for signatures, providers, generators, agents, flows, and optimizers.

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

auto llm = axllm::ai("openai", { {"apiKey", std::getenv("OPENAI_API_KEY")} });
```

## Relevant API Surface

- Signatures: `axllm::s`, `axllm::FieldType`, `axllm::AxSignature`
- AxGen: `axllm::ax`, `axllm::AxGen`
- AxAI: `axllm::ai`, `axllm::OpenAICompatibleClient`, `axllm::OpenAIResponsesClient`, `axllm::GoogleGeminiClient`, `axllm::AnthropicClient`, `axllm::AxBalancer`, `axllm::MultiServiceRouter`, `axllm::ProviderRouter`
- Agents And RLM: `axllm::agent`, `axllm::AxAgent`
- Flow: `axllm::flow`, `axllm::AxFlow`
- Optimizers: `axllm::optimize`, `axllm::AxBootstrapFewShot`, `axllm::AxGEPA`, `axllm::OptimizerEngine`, `axllm::OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.