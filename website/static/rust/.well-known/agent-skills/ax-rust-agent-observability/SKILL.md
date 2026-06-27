---
name: "ax-rust-agent-observability"
description: "Use when writing Rust code with `axllm` for agent tracing, usage accounting, action logs, runtime diagnostics, replay, and production debugging."
version: "22.0.7"
---
# AxAgent Observability For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Inspect agent traces, runtime envelopes, usage, or action logs.
- Attach callbacks for model/tool activity and runtime progress.
- Debug agent loops through generated package state and examples.

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
let helper = axllm::agent("question:string -> answer:string")?;
let out = helper.forward(&llm, inputs, None)?;
```

## Relevant API Surface

- Agents And RLM: `agent`, `AxAgent`
- Runtime Profiles: `ProcessCodeRuntime`, `RuntimeCapabilities`, `RuntimeEnvelope`, `javascript-quickjs`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
