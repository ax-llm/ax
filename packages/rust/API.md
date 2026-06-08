# Ax for Rust API Reference

This generated API reference is emitted by AxIR from compiler-owned metadata. Do not edit it by hand; change the AxIR generator and regenerate packages instead.

## Package

- Target: `rust`
- Package: `axllm`
- AxIR contract: `0.1`

## Signatures

Describe typed Ax inputs and outputs once, then reuse that shape for schemas, prompts, validation, tools, and structured results.

### `s`

Parse an Ax string signature into the target language signature object.

- Canonical Ax concept: `s`
- Kind: `function`
- Form: `s(spec: &str)`
- Returns: `AxResult<AxSignature>`

```rust
let sig = s("question:string -> answer:string")?;
```

### `f`

Build signatures and field types fluently when the target has a fluent helper.

- Canonical Ax concept: `f`
- Kind: `function`
- Form: `f().input(...).output(...).build()`
- Returns: `signature builder or field factory`
- Important options: input fields, output fields, field descriptions, constraints

### `AxSignature`

Parsed signature with input/output fields, descriptions, and JSON schema helpers.

- Canonical Ax concept: `AxSignature`
- Kind: `type`
- Form: `AxSignature`
- Returns: `signature object`
- Important options: inputs, outputs, description


## AxGen

Run structured generation with Core-owned prompts, tool loops, retries, streaming folds, traces, usage, examples, and field processors.

### `ax`

Create an AxGen program from a string or parsed signature.

- Canonical Ax concept: `ax`
- Kind: `function`
- Form: `ax(spec: &str)`
- Returns: `AxResult<AxGen>`
- Important options: functions, examples, demos, modelConfig, maxRetries, streaming assertions, field processors

```rust
let qa = ax("question:string -> answer:string")?;
```

### `AxGen`

Structured generation program with forward, streaming, optimization, trace, usage, and tool-call behavior.

- Canonical Ax concept: `AxGen`
- Kind: `type`
- Form: `AxGen`
- Returns: `program object`
- Important options: signature, functions, examples, demos, memory, prompt template


## AxAI

Call supported providers through the shared provider descriptor registry, scripted transports, routers, and balancers.

### `ai`

Create a provider client from a provider name and options.

- Canonical Ax concept: `ai`
- Kind: `function`
- Form: `ai(provider, options)`
- Returns: `AxResult<OpenAICompatibleClient>`
- Important options: api key, model, api URL, headers, transport

```rust
let client = ai("openai", json!({"apiKey": std::env::var("OPENAI_API_KEY")?}))?;
```

### `OpenAICompatibleClient`

OpenAI-compatible chat, stream, embedding, audio, and realtime provider boundary.

- Canonical Ax concept: `OpenAICompatibleClient`
- Kind: `type`
- Form: `OpenAICompatibleClient / ai(provider, options)`
- Returns: `provider client`
- Important options: api key, model, base URL, transport

### `OpenAIResponsesClient`

OpenAI Responses provider mapping using the same Core-owned request and response contract.

- Canonical Ax concept: `OpenAIResponsesClient`
- Kind: `type`
- Form: `OpenAIResponsesClient / ai(provider, options)`
- Returns: `provider client`
- Important options: api key, model, audio, realtime

### `GoogleGeminiClient`

Gemini provider mapping for chat, streaming, media, tools, embeddings, and usage normalization.

- Canonical Ax concept: `GoogleGeminiClient`
- Kind: `type`
- Form: `GoogleGeminiClient / ai(provider, options)`
- Returns: `provider client`
- Important options: api key, model, embed model

### `AnthropicClient`

Anthropic provider mapping for messages, thinking, cache control, streaming, and usage normalization.

- Canonical Ax concept: `AnthropicClient`
- Kind: `type`
- Form: `AnthropicClient / ai(provider, options)`
- Returns: `provider client`
- Important options: api key, model, thinking, cache control

### `AxBalancer`

Retry and route requests across multiple provider services while preserving Ax request shape.

- Canonical Ax concept: `AxBalancer`
- Kind: `type`
- Form: `AxBalancer`
- Returns: `AI service`
- Important options: services, retry policy, capability requirements

### `MultiServiceRouter`

Choose a service by capability or model routing policy.

- Canonical Ax concept: `MultiServiceRouter`
- Kind: `type`
- Form: `MultiServiceRouter`
- Returns: `AI service`
- Important options: services, routing

### `ProviderRouter`

Route provider requests to registered provider clients.

- Canonical Ax concept: `ProviderRouter`
- Kind: `type`
- Form: `ProviderRouter`
- Returns: `AI service`
- Important options: providers, routing, processing


## Agents And RLM

Run AxAgent through the RLM executor loop, where actor-code steps execute through an AxCodeRuntime session.

### `agent`

Create an AxAgent from a signature and agent/runtime options.

- Canonical Ax concept: `agent`
- Kind: `function`
- Form: `agent(spec: &str)`
- Returns: `AxResult<AxAgent>`
- Important options: name, description, runtime, maxSteps, context fields, discovery, recall, functions

```rust
let helper = agent("query:string -> answer:string")?;
```

### `AxAgent`

RLM agent with Core-owned envelopes, state, traces, discovery, recall, delegation, and final typed responses.

- Canonical Ax concept: `AxAgent`
- Kind: `type`
- Form: `AxAgent`
- Returns: `agent program`
- Important options: executor model, runtime, policy, context, optimizer metadata


## Flow

Compose AxGen, AxAgent, and nested flows into a portable program graph.

### `flow`

Create an AxFlow program graph.

- Canonical Ax concept: `flow`
- Kind: `function`
- Form: `flow(id)`
- Returns: `AxFlow`
- Important options: nodes, execute mappers, conditions, cache, returns

```rust
let wf = flow("workflow");
```

### `AxFlow`

Workflow graph with Core-owned planning, cache keys, state merge, child aggregation, optimization, and returns projection.

- Canonical Ax concept: `AxFlow`
- Kind: `type`
- Form: `AxFlow`
- Returns: `flow program`
- Important options: steps, state, parallel groups, returns


## Tools

Expose host functions to AxGen and AxAgent with typed argument and return schemas.

### `tool`

Build a typed function tool. Rust uses `tool` because `fn` is reserved.

- Canonical Ax concept: `fn`
- Kind: `function`
- Form: `tool(name).description(...).arg(...).handler(...).build()`
- Returns: `ToolBuilder`
- Important options: name, description, args, returns, handler

```rust
let search = tool("search").description("Search docs").build();
```

### `Tool`

Callable tool descriptor with JSON-schema-compatible parameters and a host handler.

- Canonical Ax concept: `Tool`
- Kind: `type`
- Form: `Tool`
- Returns: `tool descriptor`
- Important options: parameters, returns, handler


## MCP

Use MCP clients and transports while keeping JSON-RPC lifecycle, tools, prompts, resources, OAuth, cancellation, and SSRF checks aligned.

### `AxMCPClient`

MCP client that lists tools/prompts/resources and converts MCP tools to Ax functions.

- Canonical Ax concept: `AxMCPClient`
- Kind: `type`
- Form: `AxMCPClient::new(transport, options)`
- Returns: `MCP client`
- Important options: transport, client info, roots, tool overrides

```rust
let client = AxMCPClient::new(transport, json!({}));
```

### `AxMCPStreamableHTTPTransport`

Streamable HTTP transport with session headers, OAuth options, and SSRF protection.

- Canonical Ax concept: `AxMCPStreamableHTTPTransport`
- Kind: `type`
- Form: `AxMCPStreamableHTTPTransport`
- Returns: `MCP transport`
- Important options: endpoint, headers, OAuth, SSRF protection

### `AxMCPStdioTransport`

Stdio transport with JSON-RPC framing for local MCP servers.

- Canonical Ax concept: `AxMCPStdioTransport`
- Kind: `type`
- Form: `AxMCPStdioTransport`
- Returns: `MCP transport`
- Important options: command, args, env


## Runtime Profiles

Run RLM actor code through the portable AxCodeRuntime and optional target-specific runtime profiles.

### `ProcessCodeRuntime`

Process/JSONL runtime adapter for actor-code sessions and runtime protocol tests.

- Canonical Ax concept: `ProcessCodeRuntime`
- Kind: `type`
- Form: `ProcessCodeRuntime::new(command)`
- Returns: `AxCodeRuntime`
- Important options: command, env, cwd, timeout

```rust
let runtime = ProcessCodeRuntime::new(vec!["node".into(), "runtime-server.mjs".into()]);
```

### `RuntimeCapabilities`

Runtime capability envelope visible to the agent runtime policy.

- Canonical Ax concept: `RuntimeCapabilities`
- Kind: `type`
- Form: `RuntimeCapabilities`
- Returns: `capability record`
- Important options: language, snapshot, patch, abort, usage instructions

### `RuntimeEnvelope`

Actor primitive envelope for final, clarification, discovery, recall, used, guidance, and runtime results.

- Canonical Ax concept: `RuntimeEnvelope`
- Kind: `type`
- Form: `RuntimeEnvelope`
- Returns: `runtime envelope`
- Important options: type, args, result, error

### `javascript-quickjs`

Optional runtime profile for javascript actor code.

- Canonical Ax concept: `runtime-profile:javascript-quickjs`
- Kind: `runtime-profile`
- Form: `tools/axir verify --targets rust --runtime-profiles javascript-quickjs`
- Returns: `AxCodeRuntime-compatible actor execution profile`
- Important options: actor language: javascript, support mode: embedded, dependency mode: optional-feature, feature gate: runtime-quickjs


## Optimizers

Optimize Ax programs through BootstrapFewShot -> GEPA composition, portable component maps, evaluator rows, artifacts, and generated engines.

### `optimize`

Convenience optimizer helper that composes AxBootstrapFewShot before AxGEPA and returns an artifact without applying final component changes.

- Canonical Ax concept: `optimize`
- Kind: `function`
- Form: `optimize(program, examples, options)`
- Returns: `AxResult<OptimizedArtifact>`
- Important options: student/client, teacher/reflection client, metric budget, bootstrap

```rust
let artifact = optimize(&mut qa, train, json!({"maxMetricCalls": 100}))?;
```

### `AxBootstrapFewShot`

Few-shot demonstration optimizer that selects successful evaluator rollouts before prompt/component evolution.

- Canonical Ax concept: `AxBootstrapFewShot`
- Kind: `type`
- Form: `AxBootstrapFewShot::new(options)`
- Returns: `optimizer engine`
- Important options: quality threshold, max demos, max rounds, batch size

```rust
let bootstrap = AxBootstrapFewShot::new(json!({"qualityThreshold": 0.7}));
```

### `AxGEPA`

Generated GEPA optimizer engine with Core-owned reflection, Pareto, bootstrap, and selector-state behavior.

- Canonical Ax concept: `AxGEPA`
- Kind: `type`
- Form: `AxGEPA::new(reflection, options)`
- Returns: `optimizer engine`
- Important options: reflection client, budget, metric, candidate count

```rust
let engine = AxGEPA::new(reflection_client, json!({}));
```

### `OptimizerEngine`

Optimizer boundary consumed by AxGen, AxAgent, and AxFlow optimization helpers.

- Canonical Ax concept: `OptimizerEngine`
- Kind: `interface`
- Form: `OptimizerEngine::optimize(request, evaluator)`
- Returns: `optimized artifact`
- Important options: request, evaluator

### `OptimizerEvaluator`

Evaluator callback boundary used by generated optimizers.

- Canonical Ax concept: `OptimizerEvaluator`
- Kind: `interface`
- Form: `OptimizerEvaluator::evaluate(request)`
- Returns: `score/evidence result`
- Important options: dataset rows, candidate map, evidence


## Errors And Values

Handle target-native errors and dynamic values at Ax host boundaries.

### `AxError`

Target-native error envelope for validation, provider, runtime, MCP, and optimizer failures.

- Canonical Ax concept: `AxError`
- Kind: `type`
- Form: `AxError with target-native error handling`
- Returns: `error`
- Important options: category, message, status, code, retryable

### `serde_json::Value`

Dynamic JSON-like value boundary used by generated package APIs, tools, providers, MCP, and runtime sessions.

- Canonical Ax concept: `Value`
- Kind: `type`
- Form: `serde_json::Value`
- Returns: `dynamic value`
- Important options: string, number, boolean, object, array, null
