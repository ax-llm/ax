---
name: "ax-go-gen"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for AxGen programs, forward calls, indexed multi-sampling, result pickers, streaming, tools, assertions, traces, usage, and output parsing."
version: "24.0.12"
---
# AxGen Structured Generation For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Build a structured generation program from a signature.
- Attach typed tools or MCP-derived tools to a generation call.
- Generate multiple validated structured samples and select a winner with a native callback.
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

## Provider Forward Options

AxGen merges constructor and per-call forward options before invoking the provider. Provider-facing keys such as `promptCacheKey`, `sessionId`, and `contextCache` therefore reach the chat request without being copied into program inputs. Per-call values override constructor defaults.

`structuredOutputMode` / `structured_output_mode` accepts `auto`, `native`, `function`, or `json_object`. Auto follows the selected profile/model ordering, with the provider-neutral singleton string/code JSON-object optimization. Explicit modes must be advertised and fail before transport otherwise. JSON-object mode retains exact-shape prompting, strict parsing, and one bounded correction retry without a synthetic `__axOutput` tool.

## Multi-Sampling

- Set `sampleCount` / `sample_count` to request N provider candidates. Core parses and validates every candidate, preserving each provider result index.
- Without a result picker, AxGen returns candidate 0. A result picker receives all `{ index, sample }` structured candidates and returns the winning list index; Core rejects an index outside `0..N-1`.
- Native callback surface: `SetSampleCount` / `SetResultPicker` with `AxResultPickerSample`.
- OpenAI-compatible Chat and Gemini map multi-sampling to `n` and `candidateCount`. Anthropic rejects `n > 1` explicitly.

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
