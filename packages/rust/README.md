# Ax for Rust

Write Ax programs in Rust with native Result-based errors, serde_json dynamic values at Ax boundaries, blocking provider transport, protocol-first RLM runtime sessions, and shared Ax semantics generated from the compiler contract.

## Quick Start

```bash
cargo add axllm
```

Or add to your `Cargo.toml`:

```toml
axllm = "22.0.7"
```

```rust
use axllm::{s, AxResult};

fn main() -> AxResult<()> {
    let sig = s("question:string -> answer:string")?;
    let schema = sig.to_json_schema("outputs");
    assert!(schema["properties"].get("answer").is_some());
    Ok(())
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

- Crate: `axllm`
- Dynamic value boundary: `serde_json::Value`
- Error boundary: `Result<T, AxError>`
- Built-in HTTP transport: blocking `reqwest` with rustls TLS
- Runtime execution: process/JSONL protocol through `ProcessCodeRuntime`; embedded QuickJS is opt-in with the `runtime-quickjs` Cargo feature
- Network support: available

Shared Ax behavior is Core-owned. The generated target code stays focused on idiomatic wrappers, transports, dynamic value helpers, and host-runtime boundaries.

## Examples

`no-key` examples are deterministic local smokes. They are the fastest way to see the package work without any provider account:

- `cargo run --example signature_schema`: signature parsing and JSON schema generation
- `cargo run --example provider_mapping_no_key`: provider mapping through a scripted transport
- `cargo run --example provider_stream_no_key`: provider streaming through a scripted SSE transport
- `cargo run --example axgen_scripted_client_tool`: AxGen with a scripted client and tool
- `cargo run --example axflow_program_graph`: AxFlow program graph
- `cargo run --example audio_responses_mapping`: OpenAI Responses speak/transcribe mapping through a scripted transport
- `cargo run --example realtime_audio_events`: Grok/Gemini realtime audio setup, input, and event folding
- `cargo run --example runtime_adapter`: custom `AxCodeRuntime` session
- `cargo run --example runtime_protocol`: process runtime protocol against the AxJS reference adapter
- `cargo run --example javascript_quickjs --features runtime-quickjs`: embedded QuickJS actor runtime profile
- `cargo run --example optimizer_artifact`: optimizer artifact lifecycle smoke
- `cargo run --example gepa_local_optimizer`: local GEPA optimizer artifact generation
- `cargo run --example mcp_scripted_tools`: MCP tool discovery and invocation through a scripted transport

`provider-api` examples make a real provider call and require `OPENAI_API_KEY` or `OPENAI_APIKEY`:

- `OPENAI_API_KEY=... cargo run --example axgen_openai_api`: AxGen with a real OpenAI-compatible provider API
- `OPENAI_API_KEY=... cargo run --example flow_openai_api`: AxFlow with a real OpenAI-compatible provider API

## Runtime Profiles And RLM Agents

AxAgent uses an RLM executor loop. On each turn, the model writes a small actor-code step, and Ax sends that step into an `AxCodeRuntime` session. Think of the runtime as the agent's REPL: it keeps session state, exposes safe host callbacks, returns envelopes such as `final(...)`, `askClarification(...)`, `discover(...)`, `recall(...)`, and `used(...)`, and lets the agent continue from the result.

The TypeScript package ships `AxJSRuntime` as the reference JavaScript implementation of that REPL contract. Generated runtime profiles are adapters for the same `AxCodeRuntime` / `AxCodeSession` boundary. They exist so RLM agents can execute actor code in a host runtime that fits the target package.

This package is not a TypeScript transpiler. AxIR compiles shared Ax semantics into native package code; it does not run your original Ax TypeScript application inside a Rust runtime. Application code is still written in the language you are using here.

Runtime profiles are target-specific and opt in to their engine dependencies:

- `ProcessCodeRuntime` speaks the shared AxCodeRuntime JSONL protocol.
- `javascript-quickjs` is an embedded JavaScript actor runtime backed by `rquickjs` and gated by Cargo feature `runtime-quickjs`.

Verify it with `axir verify --targets rust --runtime-profiles javascript-quickjs` when the AxIR toolchain is available.

Optional runtime profiles are dependency-bearing and opt-in. Adapter policy owns sandboxing, dependency loading, hard cancellation, process security, and host permissions. The shared Ax contract still owns envelopes, state, logs, traces, and the model-visible protocol.

## Contract Snapshot

- Compiler contract version: 0.1
- Package: axllm
- Supported conformance suites: signature, schema, validation, prompt, axgen, axai, axagent, axoptimize, axprogram, axflow, axmcp
- Provider mode: provider-descriptor-registry-openai-compatible-openai-responses-google-gemini-anthropic
- Scripted transport support: true
- Real network support: available
