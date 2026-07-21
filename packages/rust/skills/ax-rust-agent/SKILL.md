---
name: "ax-rust-agent"
description: "Use when writing Rust code with `axllm` for agents, child delegation, tools, MCP, citations, persistent playbook learning, stage instructions, runtime state, final typed responses, and direct-respond executor skipping."
version: "23.0.3"
---
# AxAgent For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Create an RLM agent with tools, child agents, or MCP clients.
- Use clarification, discovery, recall, final, or respond envelopes.
- Require evidence citations, attach a persistent playbook, or add stage-owned actor instructions.
- Harvest run-end failures into the playbook and observe citation or playbook updates.
- Skip the executor stage for no-tool tasks with a distiller `respond` envelope (`directResponse`, on by default).
- Save and restore agent runtime state around long-running tasks.

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
- MCP: `AxMCPClient`, `AxMCPStreamableHTTPTransport`, `AxMCPStdioTransport`
- Runtime Profiles: `ProcessCodeRuntime`, `RuntimeCapabilities`, `RuntimeEnvelope`, `javascript-quickjs`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.