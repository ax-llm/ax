---
name: "ax-python-signature"
description: "Use when writing Python code with `axllm` for string signatures, field descriptors, JSON schema output, validation, and typed tool argument shapes."
version: "23.0.2"
---
# Ax Signatures For Python

This skill helps an agent write Python code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Declare input and output contracts with native generated-package APIs.
- Generate JSON-schema-compatible shapes for outputs, tools, prompts, and validation.
- Keep Standard Schema and TypeScript-only helper libraries out of generated-language code.

## Package Facts

- Language: Python.
- Package: `axllm`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```python
from axllm import s

sig = s("question:string -> answer:string")
schema = sig.to_json_schema("outputs")
```

## More Patterns

### Simple string contract

Use the string form when field names and types are enough.

```python
from axllm import ax

program = ax("questionText:string -> answerText:string")
```

### Bounded class output

A class field constrains the model to a known label set.

```python
router = ax(
    'messageText:string -> routeClass:class "support, sales, engineering"'
)
```

### Fluent constraints

Python exposes the native fluent builder for validation constraints and objects.

```python
from axllm import f

signature = (
    f()
    .input("contactEmail", f.string("Contact email").email())
    .output("partySize", f.number("Guests").min(1).max(12))
    .output("bookingCode", f.string().regex(r"^[A-Z]{3}-\d{4}$"))
    .build()
)
```

### JSON schema

Render the output contract for tools, validators, or external consumers.

```python
schema = signature.to_json_schema("outputs")
```

### Reuse the signature

Pass one built signature into AxGen and call it like any other program.

```python
program = ax(signature)
output = program.forward(client, inputs)
```

Start from the complete programs under `examples/`, then browse the larger gallery at https://axllm.dev/python/subsystems/s/.

## Relevant API Surface

- Signatures: `s`, `f`, `AxSignature`
- Tools: `fn`, `Tool`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.