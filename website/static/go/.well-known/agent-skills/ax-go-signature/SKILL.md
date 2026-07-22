---
name: "ax-go-signature"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for string signatures, field descriptors, JSON schema output, validation, and typed tool argument shapes."
version: "23.0.3"
---
# Ax Signatures For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Declare input and output contracts with native generated-package APIs.
- Generate JSON-schema-compatible shapes for outputs, tools, prompts, and validation.
- Keep Standard Schema and TypeScript-only helper libraries out of generated-language code.

## Package Facts

- Language: Go.
- Package: `github.com/ax-llm/ax/packages/go`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-goja`.

## Core Pattern

```go
import ax "github.com/ax-llm/ax/packages/go"

sig := ax.NewSignature("question:string -> answer:string")
schema := sig.ToJSONSchema(nil)
```

## More Patterns

### Simple string contract

Use the string form when field names and types are enough.

```go
program := ax.NewAx("questionText:string -> answerText:string", nil)
```

### Bounded class output

A class field constrains the model to a known label set.

```go
router := ax.NewAx(
  "messageText:string -> routeClass:class \"support, sales, engineering\"",
  nil,
)
```

### Native constraints

Go exposes generated signature and field records directly.

```go
signature := ax.AxSignature{
  Inputs: []ax.Field{{
    Name: "contactEmail",
    Type: ax.FieldType{Name: "string", Format: "email"},
  }},
  Outputs: []ax.Field{{
    Name: "partySize",
    Type: ax.FieldType{Name: "number", Minimum: 1, Maximum: 12},
  }},
}
```

### JSON schema

Render the native signature for tools, validators, or external consumers.

```go
schema := signature.ToJSONSchema(nil)
```

### Reuse the signature

Attach the native signature to AxGen before the forward call.

```go
program := ax.NewAx("contactEmail:string -> partySize:number", nil)
program.Signature = signature
output, err := program.Forward(ctx, client, inputs, nil)
```

Start from the complete programs under `examples/`, then browse the larger gallery at https://axllm.dev/go/subsystems/s/.

## Relevant API Surface

- Signatures: `axllm.S`, `axllm.FieldType`, `axllm.AxSignature`
- Tools: `axllm.Fn`, `axllm.Tool`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
