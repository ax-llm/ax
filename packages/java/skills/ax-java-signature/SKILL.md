---
name: "ax-java-signature"
description: "Use when writing Java code with `dev.axllm:ax` for string signatures, field descriptors, JSON schema output, validation, and typed tool argument shapes."
version: "23.0.2"
---
# Ax Signatures For Java

This skill helps an agent write Java code with the generated Ax package `dev.axllm:ax`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Declare input and output contracts with native generated-package APIs.
- Generate JSON-schema-compatible shapes for outputs, tools, prompts, and validation.
- Keep Standard Schema and TypeScript-only helper libraries out of generated-language code.

## Package Facts

- Language: Java.
- Package: `dev.axllm:ax`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```java
import dev.axllm.ax.*;

AxSignature sig = Ax.s("question:string -> answer:string");
var schema = sig.toJsonSchema("outputs", java.util.Map.of());
```

## More Patterns

### Simple string contract

Use the string form when field names and types are enough.

```java
AxGen program = Ax.ax("questionText:string -> answerText:string");
```

### Bounded class output

A class field constrains the model to a known label set.

```java
AxGen router = Ax.ax(
    "messageText:string -> routeClass:class \"support, sales, engineering\"");
```

### Fluent constraints

Java exposes the native fluent builder for validation constraints and objects.

```java
AxSignature signature = Ax.f().call()
    .input("contactEmail", Ax.f().string("Contact email").email())
    .output("partySize", Ax.f().number("Guests").min(1).max(12))
    .output("bookingCode", Ax.f().string().regex("^[A-Z]{3}-\\d{4}$", "ABC-1234"))
    .build();
```

### JSON schema

Render the output contract for tools, validators, or external consumers.

```java
var schema = signature.toJsonSchema("outputs", java.util.Map.of());
```

### Reuse the signature

Pass one built signature into AxGen and call it like any other program.

```java
AxGen program = Ax.ax(signature);
var output = program.forward(client, inputs);
```

Start from the complete programs under `examples/`, then browse the larger gallery at https://axllm.dev/java/subsystems/s/.

## Relevant API Surface

- Signatures: `Ax.s`, `Ax.f`, `AxSignature`
- Tools: `Ax.fn`, `Tool`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.