---
name: "ax-go-gen"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for AxGen programs, forward calls, streaming, tools, assertions, traces, usage, and output parsing."
version: "22.0.8"
---
# AxGen Structured Generation For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Build a structured generation program from a signature.
- Attach typed tools or MCP-derived tools to a generation call.
- Use package examples for no-key scripted clients and provider-api calls.

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
program := ax.NewAx("question:string -> answer:string", nil)
out := program.Forward(llm, map[string]ax.Value{"question": "What is Ax?"}, nil)
```

## Relevant API Surface

- AxGen: `axllm.NewAx`, `axllm.AxGen`
- Tools: `axllm.Fn`, `axllm.Tool`
- MCP: `axllm.AxMCPClient`, `axllm.AxMCPStreamableHTTPTransport`, `axllm.AxMCPStdioTransport`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.