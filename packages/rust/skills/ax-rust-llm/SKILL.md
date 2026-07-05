---
name: "ax-rust-llm"
description: "Use when writing Rust code with `axllm` for using the generated Ax package, factory functions, package docs, examples, and API reference."
version: "23.0.0"
---
# Ax LLM Quick Reference For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Start a generated-language Ax program from package docs or examples.
- Translate the Ax mental model into the target package without TypeScript-only imports.
- Choose the native package entrypoints for signatures, providers, generators, agents, flows, and optimizers.

## Package Facts

- Language: Rust.
- Package: `axllm`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`.

## Core Pattern

```rust
use axllm::ai;

let llm = ai("openai", options)?;
```

## Relevant API Surface

- Signatures: `s`, `f`, `AxSignature`
- AxGen: `ax`, `AxGen`
- AxAI: `ai`, `OpenAICompatibleClient`, `OpenAIResponsesClient`, `GoogleGeminiClient`, `AnthropicClient`, `AxBalancer`, `MultiServiceRouter`, `ProviderRouter`
- Agents And RLM: `agent`, `AxAgent`
- Flow: `flow`, `AxFlow`
- Optimizers: `optimize`, `AxBootstrapFewShot`, `AxGEPA`, `OptimizerEngine`, `OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.