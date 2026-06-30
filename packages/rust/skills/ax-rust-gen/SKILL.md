---
name: "ax-rust-gen"
description: "Use when writing Rust code with `axllm` for AxGen programs, forward calls, streaming, tools, assertions, traces, usage, and output parsing."
version: "22.0.9"
---
# AxGen Structured Generation For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Build a structured generation program from a signature.
- Attach typed tools or MCP-derived tools to a generation call.
- Use package examples for no-key scripted clients and provider-api calls.

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
let program = axllm::ax("question:string -> answer:string")?;
let out = program.forward(&llm, inputs, None)?;
```

## Relevant API Surface

- AxGen: `ax`, `AxGen`
- Tools: `tool`, `Tool`
- MCP: `AxMCPClient`, `AxMCPStreamableHTTPTransport`, `AxMCPStdioTransport`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.