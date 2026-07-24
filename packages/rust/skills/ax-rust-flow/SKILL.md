---
name: "ax-rust-flow"
description: "Use when writing Rust code with `axllm` for flows, nodes, program graphs, nested programs, dynamic options, caching, and optimizer components."
version: "23.0.5"
---
# AxFlow For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Compose generators, agents, and nested flows into a workflow graph.
- Reason about flow state, node inputs, returns, caching, and errors.
- Use generated package examples for flow graphs and provider-backed flows.

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
let draft = axllm::ax("topicText:string -> draftText:string")?;
let wf = axllm::flow("docs.coreFlow")
    .execute_with_options(
        "draft",
        draft,
        &json!({"reads": ["topicText"], "writes": ["draftResult", "draftText"]}),
    )
    .returns(json!({"draftText": "draftText"}));
```

## More Patterns

### Typed programs

Build each flow node from its own input/output contract.

```rust
let classifier = axllm::ax("requestText:string -> route:class \"support, sales, engineering\"")?;
let responder = axllm::ax("requestText:string, route:string -> responseText:string")?;
```

### Class decision

Declare reads and writes so the responder waits for the typed route.

```rust
let mut branch_flow = axllm::flow("docs.branchFlow")
    .execute_with_options("classifier", classifier, &json!({"reads": ["requestText"], "writes": ["classifierResult", "route"]}))
    .execute_with_options("responder", responder, &json!({"reads": ["requestText", "route"], "writes": ["responderResult", "responseText"]}))
    .returns(json!({"route": "route", "responseText": "responseText"}));
```

### Parallel fan-out and join

Independent reads let research and audience analysis share one planner group.

```rust
let mut parallel_flow = axllm::flow("docs.parallelFlow")
    .execute_with_options("research", research, &json!({"reads": ["topicText"], "writes": ["researchResult", "factList"]}))
    .execute_with_options("audience", audience, &json!({"reads": ["topicText"], "writes": ["audienceResult", "audienceAngle"]}))
    .execute_with_options("join", join, &json!({"reads": ["factList", "audienceAngle"], "writes": ["joinResult", "briefText"]}))
    .returns(json!({"briefText": "briefText"}));
```

### Draft, critique, revise

A linear refinement pipeline makes each dependency explicit.

```rust
let mut refine_flow = axllm::flow("docs.refineFlow")
    .execute_with_options("draft", draft, &json!({"reads": ["topicText"], "writes": ["draftResult", "draftText"]}))
    .execute_with_options("critique", critique, &json!({"reads": ["draftText"], "writes": ["critiqueResult", "critiqueText"]}))
    .execute_with_options("revise", revise, &json!({"reads": ["draftText", "critiqueText"], "writes": ["reviseResult", "revisedText"]}))
    .returns(json!({"revisedText": "revisedText"}));
```

### Run a flow

Forward accepts the mutable provider client and public inputs.

```rust
let output = parallel_flow.forward(
    &mut client,
    json!({"topicText": "Typed LLM workflows"}),
)?;
```

Start from the complete programs under `examples/`, then browse the larger gallery at https://axllm.dev/rust/subsystems/flow/.

## Relevant API Surface

- Flow: `flow`, `AxFlow`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.