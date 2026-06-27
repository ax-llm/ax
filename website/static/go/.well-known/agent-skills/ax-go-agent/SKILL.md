---
name: "ax-go-agent"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for agents, child delegation, tools, MCP, clarification, runtime state, and final typed responses."
version: "22.0.7"
---
# AxAgent For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Create an RLM agent with tools, child agents, or MCP clients.
- Use clarification, discovery, recall, or final-response envelopes.
- Save and restore agent runtime state around long-running tasks.

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
helper := ax.NewAgent("question:string -> answer:string", nil)
out := helper.Forward(llm, map[string]ax.Value{"question": "How should I proceed?"}, nil)
```

## Relevant API Surface

- Agents And RLM: `axllm.NewAgent`, `axllm.AxAgent`
- MCP: `axllm.AxMCPClient`, `axllm.AxMCPStreamableHTTPTransport`, `axllm.AxMCPStdioTransport`
- Runtime Profiles: `axllm.ProcessCodeRuntime`, `axllm.RuntimeCapabilities`, `axllm.RuntimeEnvelope`, `javascript-goja`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
