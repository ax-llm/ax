# Ax for Go API Reference

This generated API reference is emitted by AxIR from compiler-owned metadata. Do not edit it by hand; change the AxIR generator and regenerate packages instead.

## Package

- Target: `go`
- Package: `github.com/ax-llm/ax/packages/go`
- AxIR contract: `0.1`

## Signatures

Describe typed Ax inputs and outputs once, then reuse that shape for schemas, prompts, validation, tools, and structured results.

### `axllm.S`

Parse an Ax string signature into the target language signature object.

- Canonical Ax concept: `s`
- Kind: `function`
- Form: `axllm.S(signature string)`
- Returns: `AxSignature`

```go
sig := axllm.S("question:string -> answer:string")
```

### `axllm.FieldType`

Build signatures and field types fluently when the target has a fluent helper.

- Canonical Ax concept: `f`
- Kind: `function`
- Form: `FieldType and Field descriptors`
- Returns: `signature builder or field factory`
- Important options: input fields, output fields, field descriptions, constraints

### `axllm.AxSignature`

Parsed signature with input/output fields, descriptions, and JSON schema helpers.

- Canonical Ax concept: `AxSignature`
- Kind: `type`
- Form: `axllm.AxSignature`
- Returns: `signature object`
- Important options: inputs, outputs, description


## AxGen

Run structured generation with Core-owned prompts, tool loops, retries, streaming folds, traces, usage, examples, and field processors.

### `axllm.NewAx`

Create an AxGen program from a string or parsed signature.

- Canonical Ax concept: `ax`
- Kind: `function`
- Form: `axllm.NewAx(signature, options)`
- Returns: `AxGen`
- Important options: functions, examples, demos, modelConfig, maxRetries, streaming assertions, field processors

```go
qa := axllm.NewAx("question:string -> answer:string", nil)
```

### `axllm.AxGen`

Structured generation program with forward, streaming, optimization, trace, usage, and tool-call behavior.

- Canonical Ax concept: `AxGen`
- Kind: `type`
- Form: `axllm.NewGen(signature, options)`
- Returns: `program object`
- Important options: signature, functions, examples, demos, memory, prompt template


## AxAI

Call supported providers through the shared provider descriptor registry, scripted transports, routers, and balancers.

### `axllm.NewAI`

Create a provider client from a provider name and options.

- Canonical Ax concept: `ai`
- Kind: `function`
- Form: `axllm.NewAI(provider, options)`
- Returns: `AIClient`
- Important options: api key, model, api URL, headers, transport

```go
client := axllm.NewAI("openai", map[string]axllm.Value{"apiKey": os.Getenv("OPENAI_API_KEY")})
```

### `axllm.OpenAICompatibleClient`

OpenAI-compatible chat, stream, embedding, audio, and realtime provider boundary.

- Canonical Ax concept: `OpenAICompatibleClient`
- Kind: `type`
- Form: `axllm.NewOpenAICompatibleClient(options)`
- Returns: `provider client`
- Important options: api key, model, base URL, transport

### `axllm.OpenAIResponsesClient`

OpenAI Responses provider mapping using the same Core-owned request and response contract.

- Canonical Ax concept: `OpenAIResponsesClient`
- Kind: `type`
- Form: `axllm.NewOpenAIResponsesClient(options)`
- Returns: `provider client`
- Important options: api key, model, audio, realtime

### `axllm.GoogleGeminiClient`

Gemini provider mapping for chat, streaming, media, tools, embeddings, and usage normalization.

- Canonical Ax concept: `GoogleGeminiClient`
- Kind: `type`
- Form: `axllm.NewGoogleGeminiClient(options)`
- Returns: `provider client`
- Important options: api key, model, embed model

### `axllm.AnthropicClient`

Anthropic provider mapping for messages, thinking, cache control, streaming, and usage normalization.

- Canonical Ax concept: `AnthropicClient`
- Kind: `type`
- Form: `axllm.NewAnthropicClient(options)`
- Returns: `provider client`
- Important options: api key, model, thinking, cache control

### `axllm.AxBalancer`

Retry and route requests across multiple provider services while preserving Ax request shape.

- Canonical Ax concept: `AxBalancer`
- Kind: `type`
- Form: `axllm.NewAxBalancer(services, options)`
- Returns: `AI service`
- Important options: services, retry policy, capability requirements

### `axllm.MultiServiceRouter`

Choose a service by capability or model routing policy.

- Canonical Ax concept: `MultiServiceRouter`
- Kind: `type`
- Form: `axllm.MultiServiceRouter`
- Returns: `AI service`
- Important options: services, routing

### `axllm.ProviderRouter`

Route provider requests to registered provider clients.

- Canonical Ax concept: `ProviderRouter`
- Kind: `type`
- Form: `axllm.ProviderRouter`
- Returns: `AI service`
- Important options: providers, routing, processing


## Agents And RLM

Run AxAgent through the RLM executor loop, where actor-code steps execute through an AxCodeRuntime session.

### `axllm.NewAgent`

Create an AxAgent from a signature and agent/runtime options.

- Canonical Ax concept: `agent`
- Kind: `function`
- Form: `axllm.NewAgent(signature, options)`
- Returns: `*AxAgent`
- Important options: name, description, runtime, maxSteps, context fields, discovery, recall, functions

```go
helper := axllm.NewAgent("query:string -> answer:string", nil)
```

### `axllm.AxAgent`

RLM agent with Core-owned envelopes, state, traces, discovery, recall, delegation, and final typed responses.

- Canonical Ax concept: `AxAgent`
- Kind: `type`
- Form: `axllm.NewAgent(signature, options)`
- Returns: `agent program`
- Important options: executor model, runtime, policy, context, optimizer metadata


## Flow

Compose AxGen, AxAgent, and nested flows into a portable program graph.

### `axllm.NewFlow`

Create an AxFlow program graph.

- Canonical Ax concept: `flow`
- Kind: `function`
- Form: `axllm.NewFlow(options)`
- Returns: `*AxFlow`
- Important options: nodes, execute mappers, conditions, cache, returns

```go
wf := axllm.NewFlow(nil)
```

### `axllm.AxFlow`

Workflow graph with Core-owned planning, cache keys, state merge, child aggregation, optimization, and returns projection.

- Canonical Ax concept: `AxFlow`
- Kind: `type`
- Form: `axllm.NewFlow(options)`
- Returns: `flow program`
- Important options: steps, state, parallel groups, returns


## Tools

Expose host functions to AxGen and AxAgent with typed argument and return schemas.

### `axllm.Fn`

Build a typed function tool. Rust uses `tool` because `fn` is reserved.

- Canonical Ax concept: `fn`
- Kind: `function`
- Form: `axllm.Fn(name).Description(...).Arg(...).Handler(...)`
- Returns: `Tool`
- Important options: name, description, args, returns, handler

```go
search := axllm.Fn("search").Description("Search docs")
```

### `axllm.Tool`

Callable tool descriptor with JSON-schema-compatible parameters and a host handler.

- Canonical Ax concept: `Tool`
- Kind: `type`
- Form: `axllm.Tool`
- Returns: `tool descriptor`
- Important options: parameters, returns, handler


## MCP

Use MCP clients and transports while keeping JSON-RPC lifecycle, tools, prompts, resources, OAuth, cancellation, and SSRF checks aligned.

### `axllm.AxMCPClient`

MCP client that lists tools/prompts/resources and converts MCP tools to Ax functions.

- Canonical Ax concept: `AxMCPClient`
- Kind: `type`
- Form: `axllm.NewAxMCPClient(transport, options)`
- Returns: `MCP client`
- Important options: transport, client info, roots, tool overrides

```go
client := axllm.NewAxMCPClient(transport, nil)
```

### `axllm.AxMCPStreamableHTTPTransport`

Streamable HTTP transport with session headers, OAuth options, and SSRF protection.

- Canonical Ax concept: `AxMCPStreamableHTTPTransport`
- Kind: `type`
- Form: `axllm.NewAxMCPStreamableHTTPTransport(endpoint, options)`
- Returns: `MCP transport`
- Important options: endpoint, headers, OAuth, SSRF protection

### `axllm.AxMCPStdioTransport`

Stdio transport with JSON-RPC framing for local MCP servers.

- Canonical Ax concept: `AxMCPStdioTransport`
- Kind: `type`
- Form: `axllm.NewAxMCPStdioTransport(command, options)`
- Returns: `MCP transport`
- Important options: command, args, env


## Runtime Profiles

Run RLM actor code through the portable AxCodeRuntime and optional target-specific runtime profiles.

### `axllm.ProcessCodeRuntime`

Process/JSONL runtime adapter for actor-code sessions and runtime protocol tests.

- Canonical Ax concept: `ProcessCodeRuntime`
- Kind: `type`
- Form: `axllm.NewProcessCodeRuntime(command, env)`
- Returns: `AxCodeRuntime`
- Important options: command, env, cwd, timeout

```go
runtime := axllm.NewProcessCodeRuntime([]string{"node", "runtime-server.mjs"}, nil)
```

### `axllm.RuntimeCapabilities`

Runtime capability envelope visible to the agent runtime policy.

- Canonical Ax concept: `RuntimeCapabilities`
- Kind: `type`
- Form: `axllm.RuntimeCapabilities`
- Returns: `capability record`
- Important options: language, snapshot, patch, abort, usage instructions

### `axllm.RuntimeEnvelope`

Actor primitive envelope for final, clarification, discovery, recall, used, guidance, and runtime results.

- Canonical Ax concept: `RuntimeEnvelope`
- Kind: `type`
- Form: `runtime envelope map`
- Returns: `runtime envelope`
- Important options: type, args, result, error

### `javascript-goja`

Optional runtime profile for javascript actor code.

- Canonical Ax concept: `runtime-profile:javascript-goja`
- Kind: `runtime-profile`
- Form: `tools/axir verify --targets go --runtime-profiles javascript-goja`
- Returns: `AxCodeRuntime-compatible actor execution profile`
- Important options: actor language: javascript, support mode: embedded, dependency mode: optional-import


## Optimizers

Optimize Ax programs through BootstrapFewShot -> GEPA composition, portable component maps, evaluator rows, artifacts, and generated engines.

### `axllm.Optimize`

Convenience optimizer helper that composes AxBootstrapFewShot before AxGEPA and returns an artifact without applying final component changes.

- Canonical Ax concept: `optimize`
- Kind: `function`
- Form: `axllm.Optimize(program, examples, options)`
- Returns: `Value`
- Important options: student/client, teacher/reflection client, metric budget, bootstrap

```go
artifact, err := axllm.Optimize(qa, train, map[string]axllm.Value{"studentAI": client})
```

### `axllm.AxBootstrapFewShot`

Few-shot demonstration optimizer that selects successful evaluator rollouts before prompt/component evolution.

- Canonical Ax concept: `AxBootstrapFewShot`
- Kind: `type`
- Form: `axllm.NewBootstrapFewShot(options)`
- Returns: `optimizer engine`
- Important options: quality threshold, max demos, max rounds, batch size

```go
bootstrap := axllm.NewBootstrapFewShot(map[string]axllm.Value{"qualityThreshold": 0.7})
```

### `axllm.AxGEPA`

Generated GEPA optimizer engine with Core-owned reflection, Pareto, bootstrap, and selector-state behavior.

- Canonical Ax concept: `AxGEPA`
- Kind: `type`
- Form: `axllm.NewGEPA(reflection, options)`
- Returns: `optimizer engine`
- Important options: reflection client, budget, metric, candidate count

```go
engine := axllm.NewGEPA(reflectionClient, nil)
```

### `axllm.OptimizerEngine`

Optimizer boundary consumed by AxGen, AxAgent, and AxFlow optimization helpers.

- Canonical Ax concept: `OptimizerEngine`
- Kind: `interface`
- Form: `OptimizerEngine.Optimize(request, evaluator)`
- Returns: `optimized artifact`
- Important options: request, evaluator

### `axllm.OptimizerEvaluator`

Evaluator callback boundary used by generated optimizers.

- Canonical Ax concept: `OptimizerEvaluator`
- Kind: `interface`
- Form: `OptimizerEvaluator.Evaluate(request)`
- Returns: `score/evidence result`
- Important options: dataset rows, candidate map, evidence


## Errors And Values

Handle target-native errors and dynamic values at Ax host boundaries.

### `axllm.AxError`

Target-native error envelope for validation, provider, runtime, MCP, and optimizer failures.

- Canonical Ax concept: `AxError`
- Kind: `type`
- Form: `axllm.AxError with target-native error handling`
- Returns: `error`
- Important options: category, message, status, code, retryable

### `axllm.Value`

Dynamic JSON-like value boundary used by generated package APIs, tools, providers, MCP, and runtime sessions.

- Canonical Ax concept: `Value`
- Kind: `type`
- Form: `axllm.Value`
- Returns: `dynamic value`
- Important options: string, number, boolean, object, array, null
