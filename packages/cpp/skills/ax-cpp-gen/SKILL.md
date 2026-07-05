---
name: "ax-cpp-gen"
description: "Use when writing C++ code with `axllm` for AxGen programs, forward calls, streaming, tools, assertions, traces, usage, and output parsing."
version: "23.0.0"
---
# AxGen Structured Generation For C++

This skill helps an agent write C++ code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Build a structured generation program from a signature.
- Attach typed tools or MCP-derived tools to a generation call.
- Use package examples for no-key scripted clients and provider-api calls.

## Package Facts

- Language: C++.
- Package: `axllm`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```cpp
auto program = axllm::ax("question:string -> answer:string");
auto out = program.forward(llm, { {"question", "What is Ax?"} });
```

## Relevant API Surface

- AxGen: `axllm::ax`, `axllm::AxGen`
- Tools: `axllm::Tool`, `axllm::Tool`
- MCP: `axllm::AxMCPClient`, `axllm::AxMCPStreamableHTTPTransport`, `axllm::AxMCPStdioTransport`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.