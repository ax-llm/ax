# Ax for C++

Use Ax from C++ when you want structured LLM programs close to your runtime: signatures, typed dynamic values, provider transports, RLM agents, flows, and optimizer artifacts are generated into a compact C++17 library.

## Quick Start

Add Ax to your CMake project with `FetchContent`:

```cmake
include(FetchContent)
FetchContent_Declare(axllm GIT_REPOSITORY https://github.com/ax-llm/ax GIT_TAG main SOURCE_SUBDIR packages/cpp)
FetchContent_MakeAvailable(axllm)
target_link_libraries(your_app PRIVATE axllm::axllm)
```

Realtime audio over WebSocket is opt-in; enable it (fetches IXWebSocket) by setting the CMake option before `FetchContent_MakeAvailable`:

```cmake
set(AXLLM_ENABLE_REALTIME ON)
```

```cpp
#include "axllm/axllm.hpp"

auto sig = axllm::s("question:string -> answer:string");
auto schema = axllm::to_json_schema(axllm::Core::get(sig, "outputs"));
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

- Library target: `axllm::axllm`
- Public files: `axllm/axllm.hpp`, `axllm/axllm.cpp`, and `CMakeLists.txt`
- Built-in HTTP transport: enabled when CMake finds CURL; custom `Transport` remains supported
- Optional QuickJS sources are not part of the default CMake build
- Network support: available through the built-in libcurl HttpTransport when the CMake package finds CURL; custom Transport remains supported

Shared Ax behavior is Core-owned. The generated target code stays focused on idiomatic wrappers, transports, dynamic value helpers, and host-runtime boundaries.

## Examples

`no-key` examples are deterministic local smokes. They are the fastest way to see the package work without any provider account:

- `examples/signature_schema.cpp`: signature parsing and JSON schema generation
- `examples/axgen_scripted_client_tool.cpp`: AxGen with a scripted client and tool
- `examples/provider_mapping_no_key.cpp`: provider mapping through a scripted transport
- `examples/provider_stream_no_key.cpp`: provider streaming through a scripted SSE transport
- `examples/axflow_program_graph.cpp`: AxFlow program graph
- `examples/audio_responses_mapping.cpp`: OpenAI Responses speak/transcribe mapping through a scripted transport
- `examples/realtime_audio_events.cpp`: Grok/Gemini realtime audio setup, input, and event folding
- `examples/realtime_audio_turn.cpp`: drive a full realtime audio turn through `realtime_chat` (offline, scripted transport)
- `examples/runtime_adapter.cpp`: custom `AxCodeRuntime` session
- `examples/runtime_protocol.cpp`: process runtime protocol against the AxJS reference adapter
- `examples/optimizer_artifact.cpp`: optimizer artifact save/load/apply lifecycle
- `examples/gepa_local_optimizer.cpp`: local GEPA optimizer artifact generation
- `examples/ace_playbook.cpp`: grow an evolving context playbook with `playbook()` (offline, scripted client)
- `examples/agent_playbook.cpp`: grow an evolving context playbook bound to an agent stage with `agent.playbook()` (offline, scripted client)
- `examples/mcp_scripted_tools.cpp`: MCP tool discovery and invocation through a scripted transport

`provider-api` examples make a real provider call and require `OPENAI_API_KEY` or `OPENAI_APIKEY`:

- `OPENAI_API_KEY=... ./build/axgen_openai_api`: AxGen with a real OpenAI-compatible provider API after building examples
- `OPENAI_API_KEY=... ./build/flow_openai_api`: AxFlow with a real OpenAI-compatible provider API after building examples

## Runtime Profiles And RLM Agents

AxAgent uses an RLM executor loop. On each turn, the model writes a small actor-code step, and Ax sends that step into an `AxCodeRuntime` session. Think of the runtime as the agent's REPL: it keeps session state, exposes safe host callbacks, returns envelopes such as `final(...)`, `askClarification(...)`, `discover(...)`, `recall(...)`, and `used(...)`, and lets the agent continue from the result.

The TypeScript package ships `AxJSRuntime` as the reference JavaScript implementation of that REPL contract. Generated runtime profiles are adapters for the same `AxCodeRuntime` / `AxCodeSession` boundary. They exist so RLM agents can execute actor code in a host runtime that fits the target package.

This package is not a TypeScript transpiler. AxIR compiles shared Ax semantics into native package code; it does not run your original Ax TypeScript application inside a C++ runtime. Application code is still written in the language you are using here.

Optional profile files in this package:

- `javascript-quickjs`: JavaScript actor code through the QuickJS C API.
- `python-pyodide`: Python actor code through a Pyodide JSONL protocol server.

See `examples/runtime_profiles/README.md` for setup, policy, and verification details.

Optional runtime profiles are dependency-bearing and opt-in. Adapter policy owns sandboxing, dependency loading, hard cancellation, process security, and host permissions. The shared Ax contract still owns envelopes, state, logs, traces, and the model-visible protocol.

## Contract Snapshot

- Compiler contract version: 0.1
- Package: axllm
- Supported conformance suites: signature, schema, validation, prompt, axgen, axai, axagent, axoptimize, axprogram, axflow, axmcp
- Provider mode: provider-descriptor-registry-openai-compatible-openai-responses-google-gemini-anthropic
- Scripted transport support: true
- Real network support: available through the built-in libcurl HttpTransport when the CMake package finds CURL; custom Transport remains supported
