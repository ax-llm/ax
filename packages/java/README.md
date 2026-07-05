# Ax for Java

Bring Ax into Java services and JVM applications with a small native API: signatures, structured generation, providers, RLM agents, flows, and optimizer artifacts are generated from the shared Ax compiler contract and exposed as ordinary Java classes.

## Quick Start

Add the dependency from Maven Central:

```xml
<dependency>
  <groupId>dev.axllm</groupId>
  <artifactId>ax</artifactId>
  <version>23.0.0</version>
</dependency>
```

Or with Gradle:

```groovy
implementation 'dev.axllm:ax:23.0.0'
```

Realtime audio over WebSocket uses the JDK's built-in `java.net.http` WebSocket — no extra dependency.

```java
import dev.axllm.ax.*;
import java.util.*;

AxSignature sig = Ax.s("question:string -> answer:string");
Map<String, Object> schema = sig.toJsonSchema("outputs", Map.of());
System.out.println(schema.get("properties"));
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

- Java package: `dev.axllm.ax`
- Maven artifact metadata: `dev.axllm:ax`
- Build metadata: `pom.xml`, `build.gradle`, and `settings.gradle`
- Optional QuickJS4J metadata stays under `examples/runtime_profiles/`
- Network support: available

Shared Ax behavior is Core-owned. The generated target code stays focused on idiomatic wrappers, transports, dynamic value helpers, and host-runtime boundaries.

## Examples

`no-key` examples are deterministic local smokes. They are the fastest way to see the package work without any provider account:

- `examples/SignatureSchemaExample.java`: signature parsing and JSON schema generation
- `examples/AxGenScriptedClientToolExample.java`: AxGen with a scripted client and tool
- `examples/ProviderMappingNoKeyExample.java`: provider mapping through a scripted transport
- `examples/ProviderStreamNoKeyExample.java`: provider streaming through a scripted SSE transport
- `examples/AxFlowProgramGraphExample.java`: AxFlow program graph
- `examples/AudioResponsesMappingExample.java`: OpenAI Responses speak/transcribe mapping through a scripted transport
- `examples/RealtimeAudioEventsExample.java`: Grok/Gemini realtime audio setup, input, and event folding
- `examples/RealtimeAudioTurnExample.java`: drive a full realtime audio turn through `realtimeChat` (offline, scripted transport)
- `examples/RuntimeAdapterExample.java`: custom `AxCodeRuntime` session
- `examples/RuntimeProtocolExample.java`: process runtime protocol against the AxJS reference adapter
- `examples/OptimizerArtifactExample.java`: optimizer artifact save/load/apply lifecycle
- `examples/GEPALocalOptimizerExample.java`: local GEPA optimizer artifact generation
- `examples/ACEPlaybookExample.java`: grow an evolving context playbook with `Ax.playbook()` (offline, scripted client)
- `examples/AgentPlaybookExample.java`: grow an evolving context playbook bound to an agent stage with `agent.playbook()` (offline, scripted client)
- `examples/AxMCPScriptedToolsExample.java`: MCP tool discovery and invocation through a scripted transport

`provider-api` examples make a real provider call and require `OPENAI_API_KEY` or `OPENAI_APIKEY`:

- `OPENAI_API_KEY=... javac -cp . dev/axllm/ax/*.java examples/AxGenOpenAIExample.java && java -cp .:examples AxGenOpenAIExample`: AxGen with a real OpenAI-compatible provider API
- `OPENAI_API_KEY=... javac -cp . dev/axllm/ax/*.java examples/FlowOpenAIExample.java && java -cp .:examples FlowOpenAIExample`: AxFlow with a real OpenAI-compatible provider API

## Runtime Profiles And RLM Agents

AxAgent uses an RLM executor loop. On each turn, the model writes a small actor-code step, and Ax sends that step into an `AxCodeRuntime` session. Think of the runtime as the agent's REPL: it keeps session state, exposes safe host callbacks, returns envelopes such as `final(...)`, `askClarification(...)`, `discover(...)`, `recall(...)`, and `used(...)`, and lets the agent continue from the result.

The TypeScript package ships `AxJSRuntime` as the reference JavaScript implementation of that REPL contract. Generated runtime profiles are adapters for the same `AxCodeRuntime` / `AxCodeSession` boundary. They exist so RLM agents can execute actor code in a host runtime that fits the target package.

This package is not a TypeScript transpiler. AxIR compiles shared Ax semantics into native package code; it does not run your original Ax TypeScript application inside a Java runtime. Application code is still written in the language you are using here.

Optional profile files in this package:

- `javascript-quickjs`: JavaScript actor code in QuickJS4J.
- `python-pyodide`: Python actor code through a Pyodide JSONL protocol server.

See `examples/runtime_profiles/README.md` for setup, policy, and verification details.

Optional runtime profiles are dependency-bearing and opt-in. Adapter policy owns sandboxing, dependency loading, hard cancellation, process security, and host permissions. The shared Ax contract still owns envelopes, state, logs, traces, and the model-visible protocol.

## Contract Snapshot

- Compiler contract version: 0.1
- Package: dev.axllm:ax
- Supported conformance suites: signature, schema, validation, prompt, axgen, axai, axagent, axoptimize, axprogram, axflow, axmcp
- Provider mode: provider-descriptor-registry-openai-compatible-openai-responses-google-gemini-anthropic
- Scripted transport support: true
- Real network support: available
