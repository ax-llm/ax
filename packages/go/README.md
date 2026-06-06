# Ax for Go

Write Ax programs in Go with the same contract used by the main Ax library: signatures, structured generation, provider clients, RLM agents, flows, and optimizer artifacts compiled into a native Go module.

## Quick Start

```bash
cd packages/go
go test ./...
go run ./examples/signature_schema
```

```go
package main

import ax "github.com/ax-llm/ax/go"

func main() {
    sig := ax.NewSignature("question:string -> answer:string")
    _ = sig.ToJSONSchema(nil)
}
```

## What You Can Build

- Signatures and schemas: describe inputs and outputs once, then reuse that shape for validation, prompts, tools, and typed results.
- AxGen: run structured generation with retries, tool calls, field processors, assertions, traces, usage, and provider-backed output parsing.
- AxAI: call OpenAI-compatible, OpenAI Responses, Gemini, Anthropic, Azure OpenAI, DeepSeek, Mistral, Reka, Cohere, and Grok clients through one provider boundary.
- AxAgent and RLM: let an agent plan and execute actor-code steps while Ax keeps envelopes, state, logs, traces, context, discovery, recall, and final typed responses aligned.
- AxFlow: compose AxGen, AxAgent, and nested flows into a portable program graph.
- Optimizers: save, load, apply, and evaluate optimizer artifacts, including the generated GEPA engine.

## Package Shape

- Module: `github.com/ax-llm/ax/go`
- Import alias used in examples: `ax`
- Base package uses the Go standard library for HTTP/process boundaries
- Optional JavaScript actor execution lives in `runtime/goja` and is opt-in by import
- Network support: available

Shared Ax behavior is Core-owned. The generated target code stays focused on idiomatic wrappers, transports, dynamic value helpers, and host-runtime boundaries.

## Examples

`no-key` examples are deterministic local smokes. They are the fastest way to see the package work without any provider account:

- `go run ./examples/signature_schema`: signature parsing and JSON schema generation
- `go run ./examples/axgen_fake_client_tool`: AxGen with a fake client and tool
- `go run ./examples/axai_fake_transport`: provider mapping through a fake transport
- `go run ./examples/axagent_pipeline`: deterministic AxAgent pipeline
- `go run ./examples/axflow_program_graph`: AxFlow program graph
- `go run ./examples/runtime_adapter`: custom `AxCodeRuntime` session
- `go run ./examples/runtime_protocol`: process runtime protocol against the AxJS reference adapter
- `go run ./examples/optimizer_artifact`: optimizer artifact save/load/apply lifecycle

`provider-api` examples make a real provider call and require `OPENAI_API_KEY` or `OPENAI_APIKEY`:

- From the repo root, `OPENAI_API_KEY=... npm run example -- go axgen_openai_api.go`: AxGen with a real OpenAI-compatible provider API

## Runtime Profiles And RLM Agents

AxAgent uses an RLM executor loop. On each turn, the model writes a small actor-code step, and Ax sends that step into an `AxCodeRuntime` session. Think of the runtime as the agent's REPL: it keeps session state, exposes safe host callbacks, returns envelopes such as `final(...)`, `askClarification(...)`, `discover(...)`, `recall(...)`, and `used(...)`, and lets the agent continue from the result.

The TypeScript package ships `AxJSRuntime` as the reference JavaScript implementation of that REPL contract. Generated runtime profiles are adapters for the same `AxCodeRuntime` / `AxCodeSession` boundary. They exist so RLM agents can execute actor code in a host runtime that fits the target package.

This package is not a TypeScript transpiler. AxIR compiles shared Ax semantics into native package code; it does not run your original Ax TypeScript application inside a Go runtime. Application code is still written in the language you are using here.

Optional profile files in this package:

- `javascript-goja`: Go-native JavaScript actor code through the generated `runtime/goja` package.

Verify it with `axir verify --targets go --runtime-profiles javascript-goja` when the AxIR toolchain is available.

Optional runtime profiles are dependency-bearing and opt-in. Adapter policy owns sandboxing, dependency loading, hard cancellation, process security, and host permissions. The shared Ax contract still owns envelopes, state, logs, traces, and the model-visible protocol.

## Contract Snapshot

- Compiler contract version: 0.1
- Package: github.com/ax-llm/ax/go
- Supported conformance suites: signature, schema, validation, prompt, axgen, axai, axagent, axoptimize, axprogram, axflow
- Provider mode: provider-descriptor-registry-openai-compatible-openai-responses-google-gemini-anthropic
- Fake transport support: true
- Real network support: available
