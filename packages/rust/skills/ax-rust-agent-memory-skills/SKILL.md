---
name: "ax-rust-agent-memory-skills"
description: "Use when writing Rust code with `axllm` for agent memory, recall callbacks, dynamic skill discovery, loaded-skill state, and used-skill tracking."
version: "23.0.5"
---
# AxAgent Memory And Skills For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Load memories or skill guides into an RLM agent run.
- Use static skillsCatalog or memoriesCatalog search without host callbacks.
- Preload constructor or forward-time skills with deterministic id merging.
- Track which memories or skills actually influenced a turn.
- Register non-fatal loaded/used observers in native option maps or target callback wrappers.

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

## Lifecycle And State

- Constructor `skills` seed the loaded-skill prompt without firing load observers.
- Forward-time `skills` override constructor entries by normalized ID and remain loaded for later calls. IDs and names are trimmed, malformed entries are skipped, valid empty content is preserved, and rendered entries are ID-sorted.
- A forward input named `memories` seeds the first actor turn. Recalled entries merge by ID for that run, then memory state resets before the next forward.
- `onSkillsSearch` / `onMemoriesSearch` take precedence over static catalogs. Without a host callback, `skillsCatalog` / `memoriesCatalog` use the built-in deterministic lexical ranker.
- `onLoadedMemories` / `onLoadedSkills` observe runtime recall and discovery, not constructor presets. `onUsedMemories` / `onUsedSkills` emit one consolidated notification per forward. Forward observers override constructor observers, and observer errors are ignored.
- `relevanceRanking` produces advisory skill and memory hints using the same tokenization, weighting, tie suppression, limits, snippets, and already-loaded exclusion as TypeScript.
- `get_state()` and `set_state(...)` preserve the legacy bare-runtime snapshot shape. Use `export_runtime_state()` and `restore_runtime_state(...)` for the complete portable agent snapshot, including loaded skills and constructor-preset reapplication. Do not interchange the two shapes.

## Runnable Examples

- Provider-backed memory, skill, and observer lifecycle: `src/examples/rust/long-agents/skills_and_memory_assistant.rs`.
- Catalog-only search and relevance hints: the target's `smart-defaults-agent` example under `src/examples/rust/long-agents/`.
- Website gallery: https://axllm.dev/rust/examples/long-agents/.

## Relevant API Surface

- Agents And RLM: `agent`, `AxAgent`
- Runtime Profiles: `ProcessCodeRuntime`, `RuntimeCapabilities`, `RuntimeEnvelope`, `javascript-quickjs`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.