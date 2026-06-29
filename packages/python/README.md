# Ax for Python

Build Ax programs from Python without giving up the Ax model: typed signatures, structured generation, provider routing, RLM agents, flows, and optimizer artifacts all come from the same shared compiler contract. The package feels like Python, but the behavior stays aligned with the main Ax implementation.

## Quick Start

```bash
pip install axllm
```

Realtime audio over WebSocket is an opt-in extra (pulls `websocket-client`):

```bash
pip install axllm[realtime]
```

```python
from axllm import s

sig = s("question:string -> answer:string")
schema = sig.to_json_schema("outputs")
assert "answer" in schema["properties"]
```

## What You Can Build

- Signatures and schemas: describe inputs and outputs once, then reuse that shape for validation, prompts, tools, and typed results.
- AxGen: run structured generation with retries, tool calls, field processors, assertions, traces, usage, and provider-backed output parsing.
- AxAI: call OpenAI-compatible, OpenAI Responses, Gemini, Anthropic, Azure OpenAI, DeepSeek, Mistral, Reka, Cohere, and Grok clients through one provider boundary.
- Audio and realtime: `.chat()` accepts `input_audio` content parts, `transcribe()`/`speak()` do batch speech-to-text and text-to-speech, and realtime-capable models stream audio over a WebSocket — transparently through `chat()` or via the productized `realtime_chat()` driver (Go: `RealtimeChat`).
- AxAgent and RLM: let an agent plan and execute actor-code steps while Ax keeps envelopes, state, logs, traces, context, discovery, recall, and final typed responses aligned.
- AxFlow: compose AxGen, AxAgent, and nested flows into a portable program graph.
- Optimizers: save, load, apply, and evaluate optimizer artifacts, including the generated GEPA engine.

## Package Shape

- Import package: `axllm`
- Distribution metadata: `pyproject.toml`, `MANIFEST.in`, and `axllm/py.typed`
- Base dependencies: none
- Network support: available

Shared Ax behavior is Core-owned. The generated target code stays focused on idiomatic wrappers, transports, dynamic value helpers, and host-runtime boundaries.

## Examples

`no-key` examples are deterministic local smokes. They are the fastest way to see the package work without any provider account:

- `python examples/signature_schema.py`: signature parsing and JSON schema generation
- `python examples/axgen_scripted_client_tool.py`: AxGen with a scripted client and tool
- `python examples/provider_mapping_no_key.py`: provider mapping through a scripted transport
- `python examples/provider_stream_no_key.py`: provider streaming through a scripted SSE transport
- `python examples/axflow_program_graph.py`: AxFlow program graph
- `python examples/audio_responses_mapping.py`: OpenAI Responses speak/transcribe mapping through a scripted transport
- `python examples/realtime_audio_events.py`: Grok/Gemini realtime audio setup, input, and event folding
- `python examples/realtime_audio_turn.py`: drive a full realtime audio turn through the productized `realtime_chat()` driver (offline, scripted transport)
- `python examples/runtime_adapter.py`: custom `AxCodeRuntime` session
- `python examples/runtime_protocol.py`: process runtime protocol against the AxJS reference adapter
- `python examples/optimizer_artifact.py`: optimizer artifact save/load/apply lifecycle
- `python examples/gepa_local_optimizer.py`: local GEPA optimizer artifact generation
- `python examples/ace_playbook.py`: grow an evolving context playbook with `playbook()` (offline, scripted client)
- `python examples/agent_playbook.py`: grow an evolving context playbook bound to an agent stage with `agent.playbook()` (offline, scripted client)
- `python examples/mcp_scripted_tools.py`: MCP tool discovery and invocation through a scripted transport

`provider-api` examples make a real provider call and require `OPENAI_API_KEY` or `OPENAI_APIKEY`:

- `OPENAI_API_KEY=... python examples/axgen_openai_api.py`: AxGen with a real OpenAI-compatible provider API
- `OPENAI_API_KEY=... python examples/flow_openai_api.py`: AxFlow with a real OpenAI-compatible provider API

## Runtime Profiles And RLM Agents

AxAgent uses an RLM executor loop. On each turn, the model writes a small actor-code step, and Ax sends that step into an `AxCodeRuntime` session. Think of the runtime as the agent's REPL: it keeps session state, exposes safe host callbacks, returns envelopes such as `final(...)`, `askClarification(...)`, `discover(...)`, `recall(...)`, and `used(...)`, and lets the agent continue from the result.

The TypeScript package ships `AxJSRuntime` as the reference JavaScript implementation of that REPL contract. Generated runtime profiles are adapters for the same `AxCodeRuntime` / `AxCodeSession` boundary. They exist so RLM agents can execute actor code in a host runtime that fits the target package.

This package is not a TypeScript transpiler. AxIR compiles shared Ax semantics into native package code; it does not run your original Ax TypeScript application inside a Python runtime. Application code is still written in the language you are using here.

Optional profile files in this package:

- `javascript-quickjs`: JavaScript actor code through a QuickJS protocol server via `ProcessCodeRuntime`.
- `python-pyodide`: Python actor code through a Pyodide JSONL protocol server.

See `examples/runtime_profiles/README.md` for setup, policy, and verification details.

Optional runtime profiles are dependency-bearing and opt-in. Adapter policy owns sandboxing, dependency loading, hard cancellation, process security, and host permissions. The shared Ax contract still owns envelopes, state, logs, traces, and the model-visible protocol.

## Contract Snapshot

- Compiler contract version: 0.1
- Package: axllm
- Supported conformance suites: signature, schema, validation, prompt, axgen, axai, axagent, axoptimize, axprogram, axflow, axmcp
- Provider mode: provider-descriptor-registry-openai-compatible-openai-responses-google-gemini-anthropic
- Scripted transport support: true
- Real network support: available
