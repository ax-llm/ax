---
name: "ax-rust-playbook"
description: "Use when writing Rust code with `axllm` for the playbook() context-engineering surface, evolving task knowledge, online updates, and rendering a playbook into a program."
version: "22.0.7"
---
# Ax Playbook For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Grow an evolving context playbook for a program or agent stage with playbook().
- Refine a playbook online from live feedback or offline from labeled examples.
- Render or persist a playbook and inject it into a program context.

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
let mut pb = axllm::playbook(program, &mut llm, None)?;
pb.evolve(&examples, &mut metric_fn, None)?;
```

## Relevant API Surface

- Optimizers: `optimize`, `AxBootstrapFewShot`, `AxGEPA`, `OptimizerEngine`, `OptimizerEvaluator`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.