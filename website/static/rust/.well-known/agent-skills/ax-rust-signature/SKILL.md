---
name: "ax-rust-signature"
description: "Use when writing Rust code with `axllm` for string signatures, field descriptors, JSON schema output, validation, and typed tool argument shapes."
version: "24.0.21"
---
# Ax Signatures For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Declare input and output contracts with native generated-package APIs.
- Generate JSON-schema-compatible shapes for outputs, tools, prompts, and validation.
- Keep Standard Schema and TypeScript-only helper libraries out of generated-language code.

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
use axllm::s;

let sig = s("question:string -> answer:string")?;
let schema = sig.to_json_schema("outputs");
```

## More Patterns

### Simple string contract

Use the string form when field names and types are enough.

```rust
let mut program = axllm::ax("questionText:string -> answerText:string")?;
```

### Bounded class output

A class field constrains the model to a known label set.

```rust
let router = axllm::ax(
    "messageText:string -> routeClass:class \"support, sales, engineering\"",
)?;
```

### Native constraints

Rust combines FieldType constraints with the generated signature builder.

```rust
let mut party_type = FieldType::number();
party_type.minimum = Some(1.0);
party_type.maximum = Some(12.0);

let mut code_type = FieldType::string();
code_type.pattern = Some(r"^[A-Z]{3}-\d{4}$".to_string());

let signature = f()
    .output("partySize", party_type)
    .output("bookingCode", code_type)
    .build();
```

### JSON schema

Render the output contract for tools, validators, or external consumers.

```rust
let schema = signature.to_json_schema("outputs");
```

### Reuse the signature

Attach the native signature to AxGen before the forward call.

```rust
let mut program = axllm::ax("requestText:string -> partySize:number, bookingCode:string")?;
program.signature = signature;
let output = program.forward(&mut client, inputs)?;
```

Start from the complete programs under `examples/`, then browse the larger gallery at https://axllm.dev/rust/subsystems/s/.

## Typesafe / Jev

The typesafe provider supports required boolean and class outputs. Numeric bounds never define a Score rubric; numbers, freeform strings, optional outputs, arrays, nesting, media, tools, and sampling controls are rejected before transport.

Set provider trueThreshold (or true_threshold) to a finite value in [0,1], default 0.5. Boolean conversion uses noul >= threshold; this policy is local and never sent. Choice returns the selected label without a confidence cutoff.

Use boolean(true "Core task blocked", false "Routine request") and class label descriptions for criteria. Fluent describe_values / describeValues / DescribeValues keeps the same field value type. C++ uses valueDescriptions on its existing field descriptors. Other providers receive readable prompt and schema descriptions.

The separate native client exposes system_one / systemOne / SystemOne and list_models / listModels / ListModels. Native probabilities remain unchanged. Score returns a fractional zero-based rubric position: convert scales explicitly in application code. Entries may be text, structured JSON objects/arrays, or null. Choice allows 1–255 labels; Score requires 2–10 rubric levels. The service context limit covers state, questions, and criteria; Ax never truncates or pretends to count native tokens exactly.

Choice and Score probabilities must be finite values in [0,1], match the criteria keys, and sum to one within an inclusive 0.01 tolerance. Totals of 0.99 and 1.01 are accepted with an allowance for floating-point summation error. Ax preserves the returned probabilities without renormalizing them.

The default model is jev-latest. Use API keys or renewable credential callbacks, the shared HTTP transport, retry settings, timeout, and cancellation. Native model discovery is separate from configured Ax model aliases. Typed native answers retain question names; only TypeScript can infer literal question keys and Choice-label unions at compile time. Other languages use their native typed maps/records/enums.

Typesafe-only balancers propagate the output-schema requirement. Mixed pools retain ordinary prompts and select Typesafe only when the actual request already has a supported schema. Unsupported requests remain excluded during fallback and degradation. Typesafe has no token streaming; the provider returns one completed result through its stream interface.

Runnable signature, native criteria/scoring, and two-program hybrid examples are under src/examples/rust/generation/. See https://axllm.dev/rust/examples/generation/.

## Relevant API Surface

- Signatures: `s`, `f`, `AxSignature`
- Tools: `tool`, `Tool`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
