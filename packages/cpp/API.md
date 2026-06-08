# Ax for C++ API Reference

This generated API reference is emitted by AxIR from compiler-owned metadata. Do not edit it by hand; change the AxIR generator and regenerate packages instead.

## Package

- Target: `cpp`
- Package: `axllm`
- AxIR contract: `0.1`

## Signatures

Describe typed Ax inputs and outputs once, then reuse that shape for schemas, prompts, validation, tools, and structured results.

### `axllm::s`

Parse an Ax string signature into the target language signature object.

- Canonical Ax concept: `s`
- Kind: `function`
- Form: `axllm::s(const std::string& signature)`
- Returns: `AxSignature`

```cpp
auto sig = axllm::s("question:string -> answer:string");
```

### `axllm::FieldType`

Build signatures and field types fluently when the target has a fluent helper.

- Canonical Ax concept: `f`
- Kind: `function`
- Form: `FieldType / Field descriptors`
- Returns: `signature builder or field factory`
- Important options: input fields, output fields, field descriptions, constraints

### `axllm::AxSignature`

Parsed signature with input/output fields, descriptions, and JSON schema helpers.

- Canonical Ax concept: `AxSignature`
- Kind: `type`
- Form: `axllm::Value signature`
- Returns: `signature object`
- Important options: inputs, outputs, description


## AxGen

Run structured generation with Core-owned prompts, tool loops, retries, streaming folds, traces, usage, examples, and field processors.

### `axllm::ax`

Create an AxGen program from a string or parsed signature.

- Canonical Ax concept: `ax`
- Kind: `function`
- Form: `axllm::ax(signature, options)`
- Returns: `AxGen`
- Important options: functions, examples, demos, modelConfig, maxRetries, streaming assertions, field processors

```cpp
auto qa = axllm::ax("question:string -> answer:string");
```

### `axllm::AxGen`

Structured generation program with forward, streaming, optimization, trace, usage, and tool-call behavior.

- Canonical Ax concept: `AxGen`
- Kind: `type`
- Form: `axllm::AxGen(signature, options)`
- Returns: `program object`
- Important options: signature, functions, examples, demos, memory, prompt template


## AxAI

Call supported providers through the shared provider descriptor registry, scripted transports, routers, and balancers.

### `axllm::ai`

Create a provider client from a provider name and options.

- Canonical Ax concept: `ai`
- Kind: `function`
- Form: `axllm::ai(provider, options)`
- Returns: `AI client/service`
- Important options: api key, model, api URL, headers, transport

```cpp
auto client = axllm::ai("openai", axllm::object({{"apiKey", std::getenv("OPENAI_API_KEY")}}));
```

### `axllm::OpenAICompatibleClient`

OpenAI-compatible chat, stream, embedding, audio, and realtime provider boundary.

- Canonical Ax concept: `OpenAICompatibleClient`
- Kind: `type`
- Form: `axllm::OpenAICompatibleClient(options, transport)`
- Returns: `provider client`
- Important options: api key, model, base URL, transport

### `axllm::OpenAIResponsesClient`

OpenAI Responses provider mapping using the same Core-owned request and response contract.

- Canonical Ax concept: `OpenAIResponsesClient`
- Kind: `type`
- Form: `axllm::OpenAIResponsesClient(options, transport)`
- Returns: `provider client`
- Important options: api key, model, audio, realtime

### `axllm::GoogleGeminiClient`

Gemini provider mapping for chat, streaming, media, tools, embeddings, and usage normalization.

- Canonical Ax concept: `GoogleGeminiClient`
- Kind: `type`
- Form: `axllm::GoogleGeminiClient(options, transport)`
- Returns: `provider client`
- Important options: api key, model, embed model

### `axllm::AnthropicClient`

Anthropic provider mapping for messages, thinking, cache control, streaming, and usage normalization.

- Canonical Ax concept: `AnthropicClient`
- Kind: `type`
- Form: `axllm::AnthropicClient(options, transport)`
- Returns: `provider client`
- Important options: api key, model, thinking, cache control

### `axllm::AxBalancer`

Retry and route requests across multiple provider services while preserving Ax request shape.

- Canonical Ax concept: `AxBalancer`
- Kind: `type`
- Form: `axllm::AxBalancer(services, options)`
- Returns: `AI service`
- Important options: services, retry policy, capability requirements

### `axllm::MultiServiceRouter`

Choose a service by capability or model routing policy.

- Canonical Ax concept: `MultiServiceRouter`
- Kind: `type`
- Form: `axllm::MultiServiceRouter(services)`
- Returns: `AI service`
- Important options: services, routing

### `axllm::ProviderRouter`

Route provider requests to registered provider clients.

- Canonical Ax concept: `ProviderRouter`
- Kind: `type`
- Form: `axllm::ProviderRouter(providers, routing, processing)`
- Returns: `AI service`
- Important options: providers, routing, processing


## Agents And RLM

Run AxAgent through the RLM executor loop, where actor-code steps execute through an AxCodeRuntime session.

### `axllm::agent`

Create an AxAgent from a signature and agent/runtime options.

- Canonical Ax concept: `agent`
- Kind: `function`
- Form: `axllm::agent(signature, options)`
- Returns: `AxAgent`
- Important options: name, description, runtime, maxSteps, context fields, discovery, recall, functions

```cpp
auto helper = axllm::agent("query:string -> answer:string");
```

### `axllm::AxAgent`

RLM agent with Core-owned envelopes, state, traces, discovery, recall, delegation, and final typed responses.

- Canonical Ax concept: `AxAgent`
- Kind: `type`
- Form: `axllm::AxAgent(signature, options)`
- Returns: `agent program`
- Important options: executor model, runtime, policy, context, optimizer metadata


## Flow

Compose AxGen, AxAgent, and nested flows into a portable program graph.

### `axllm::flow`

Create an AxFlow program graph.

- Canonical Ax concept: `flow`
- Kind: `function`
- Form: `axllm::flow(options)`
- Returns: `AxFlow`
- Important options: nodes, execute mappers, conditions, cache, returns

```cpp
auto wf = axllm::flow();
```

### `axllm::AxFlow`

Workflow graph with Core-owned planning, cache keys, state merge, child aggregation, optimization, and returns projection.

- Canonical Ax concept: `AxFlow`
- Kind: `type`
- Form: `axllm::AxFlow(options)`
- Returns: `flow program`
- Important options: steps, state, parallel groups, returns


## Tools

Expose host functions to AxGen and AxAgent with typed argument and return schemas.

### `axllm::Tool`

Build a typed function tool. Rust uses `tool` because `fn` is reserved.

- Canonical Ax concept: `fn`
- Kind: `function`
- Form: `axllm::Tool(name, description, parameters, handler)`
- Returns: `tool builder or Tool`
- Important options: name, description, args, returns, handler

```cpp
axllm::Tool search("search", "Search docs", axllm::object({}), handler);
```

### `axllm::Tool`

Callable tool descriptor with JSON-schema-compatible parameters and a host handler.

- Canonical Ax concept: `Tool`
- Kind: `type`
- Form: `axllm::Tool`
- Returns: `tool descriptor`
- Important options: parameters, returns, handler


## MCP

Use MCP clients and transports while keeping JSON-RPC lifecycle, tools, prompts, resources, OAuth, cancellation, and SSRF checks aligned.

### `axllm::AxMCPClient`

MCP client that lists tools/prompts/resources and converts MCP tools to Ax functions.

- Canonical Ax concept: `AxMCPClient`
- Kind: `type`
- Form: `axllm::AxMCPClient(transport, options)`
- Returns: `MCP client`
- Important options: transport, client info, roots, tool overrides

```cpp
axllm::AxMCPClient client(transport);
```

### `axllm::AxMCPStreamableHTTPTransport`

Streamable HTTP transport with session headers, OAuth options, and SSRF protection.

- Canonical Ax concept: `AxMCPStreamableHTTPTransport`
- Kind: `type`
- Form: `axllm::AxMCPStreamableHTTPTransport(endpoint, options)`
- Returns: `MCP transport`
- Important options: endpoint, headers, OAuth, SSRF protection

### `axllm::AxMCPStdioTransport`

Stdio transport with JSON-RPC framing for local MCP servers.

- Canonical Ax concept: `AxMCPStdioTransport`
- Kind: `type`
- Form: `axllm::AxMCPStdioTransport(command, options)`
- Returns: `MCP transport`
- Important options: command, args, env


## Runtime Profiles

Run RLM actor code through the portable AxCodeRuntime and optional target-specific runtime profiles.

### `axllm::ProcessCodeRuntime`

Process/JSONL runtime adapter for actor-code sessions and runtime protocol tests.

- Canonical Ax concept: `ProcessCodeRuntime`
- Kind: `type`
- Form: `axllm::RuntimeProtocolClient(transport)`
- Returns: `AxCodeRuntime`
- Important options: command, env, cwd, timeout

```cpp
auto runtime = axllm::RuntimeProtocolClient(transport);
```

### `axllm::RuntimeCapabilities`

Runtime capability envelope visible to the agent runtime policy.

- Canonical Ax concept: `RuntimeCapabilities`
- Kind: `type`
- Form: `axllm::RuntimeCapabilities`
- Returns: `capability record`
- Important options: language, snapshot, patch, abort, usage instructions

### `axllm::RuntimeEnvelope`

Actor primitive envelope for final, clarification, discovery, recall, used, guidance, and runtime results.

- Canonical Ax concept: `RuntimeEnvelope`
- Kind: `type`
- Form: `axllm::RuntimeEnvelope`
- Returns: `runtime envelope`
- Important options: type, args, result, error

### `javascript-quickjs`

Optional runtime profile for javascript actor code.

- Canonical Ax concept: `runtime-profile:javascript-quickjs`
- Kind: `runtime-profile`
- Form: `tools/axir verify --targets cpp --runtime-profiles javascript-quickjs`
- Returns: `AxCodeRuntime-compatible actor execution profile`
- Important options: actor language: javascript, support mode: embedded, dependency mode: optional-build, feature gate: AX_BUILD_QUICKJS_PROFILE, environment gate: AXIR_QUICKJS_CFLAGS, environment gate: AXIR_QUICKJS_LDFLAGS

### `python-pyodide`

Optional runtime profile for python actor code.

- Canonical Ax concept: `runtime-profile:python-pyodide`
- Kind: `runtime-profile`
- Form: `tools/axir verify --targets cpp --runtime-profiles python-pyodide`
- Returns: `AxCodeRuntime-compatible actor execution profile`
- Important options: actor language: python, support mode: process-adapter, dependency mode: optional-env, environment gate: AXIR_PYODIDE_RUNTIME_SERVER, environment gate: AXIR_PYODIDE_RESOLVE


## Optimizers

Optimize Ax programs through BootstrapFewShot -> GEPA composition, portable component maps, evaluator rows, artifacts, and generated engines.

### `axllm::optimize`

Convenience optimizer helper that composes AxBootstrapFewShot before AxGEPA and returns an artifact without applying final component changes.

- Canonical Ax concept: `optimize`
- Kind: `function`
- Form: `axllm::optimize(program, student, examples, options, teacher)`
- Returns: `optimized artifact`
- Important options: student/client, teacher/reflection client, metric budget, bootstrap

```cpp
auto artifact = axllm::optimize(qa, client, train, axllm::object({}), &reflection);
```

### `axllm::AxBootstrapFewShot`

Few-shot demonstration optimizer that selects successful evaluator rollouts before prompt/component evolution.

- Canonical Ax concept: `AxBootstrapFewShot`
- Kind: `type`
- Form: `axllm::AxBootstrapFewShot(options)`
- Returns: `optimizer engine`
- Important options: quality threshold, max demos, max rounds, batch size

```cpp
axllm::AxBootstrapFewShot bootstrap(axllm::object({{"qualityThreshold", 0.7}}));
```

### `axllm::AxGEPA`

Generated GEPA optimizer engine with Core-owned reflection, Pareto, bootstrap, and selector-state behavior.

- Canonical Ax concept: `AxGEPA`
- Kind: `type`
- Form: `axllm::AxGEPA(reflection, options)`
- Returns: `optimizer engine`
- Important options: reflection client, budget, metric, candidate count

```cpp
axllm::AxGEPA engine(reflection_client);
```

### `axllm::OptimizerEngine`

Optimizer boundary consumed by AxGen, AxAgent, and AxFlow optimization helpers.

- Canonical Ax concept: `OptimizerEngine`
- Kind: `interface`
- Form: `axllm::OptimizerEngine::optimize(request, evaluator)`
- Returns: `optimized artifact`
- Important options: request, evaluator

### `axllm::OptimizerEvaluator`

Evaluator callback boundary used by generated optimizers.

- Canonical Ax concept: `OptimizerEvaluator`
- Kind: `interface`
- Form: `axllm::OptimizerEvaluator::evaluate(request)`
- Returns: `score/evidence result`
- Important options: dataset rows, candidate map, evidence


## Errors And Values

Handle target-native errors and dynamic values at Ax host boundaries.

### `axllm::AxError`

Target-native error envelope for validation, provider, runtime, MCP, and optimizer failures.

- Canonical Ax concept: `AxError`
- Kind: `type`
- Form: `axllm::AxError with target-native error handling`
- Returns: `error`
- Important options: category, message, status, code, retryable

### `axllm::Value`

Dynamic JSON-like value boundary used by generated package APIs, tools, providers, MCP, and runtime sessions.

- Canonical Ax concept: `Value`
- Kind: `type`
- Form: `axllm::Value`
- Returns: `dynamic value`
- Important options: string, number, boolean, object, array, null
