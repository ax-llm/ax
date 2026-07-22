# Ax for Java API Reference

This generated API reference is emitted by AxIR from compiler-owned metadata. Do not edit it by hand; change the AxIR generator and regenerate packages instead.

## Package

- Target: `java`
- Package: `dev.axllm:ax`
- AxIR contract: `0.1`

## Signatures

Describe typed Ax inputs and outputs once, then reuse that shape for schemas, prompts, validation, tools, and structured results.

### `Ax.s`

Parse an Ax string signature into the target language signature object.

- Canonical Ax concept: `s`
- Kind: `function`
- Form: `Ax.s(String signature)`
- Returns: `AxSignature`

```java
AxSignature sig = Ax.s("question:string -> answer:string");
```

### `Ax.f`

Build signatures and field types fluently when the target has a fluent helper.

- Canonical Ax concept: `f`
- Kind: `function`
- Form: `Ax.f().input(...).output(...)`
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

### `Ax.ax`

Create an AxGen program from a string or parsed signature.

- Canonical Ax concept: `ax`
- Kind: `function`
- Form: `Ax.ax(signature)`
- Returns: `AxGen`
- Important options: functions, examples, demos, modelConfig, maxRetries, streaming assertions, field processors

```java
AxGen qa = Ax.ax("question:string -> answer:string");
```

### `AxGen`

Structured generation program with forward, streaming, optimization, trace, usage, and tool-call behavior.

- Canonical Ax concept: `AxGen`
- Kind: `type`
- Form: `new AxGen(signature)`
- Returns: `program object`
- Important options: signature, functions, examples, demos, memory, prompt template


## AxAI

Call supported providers through the shared provider descriptor registry, scripted transports, routers, and balancers.

### `Ax.ai`

Create a provider client from a provider name and options.

- Canonical Ax concept: `ai`
- Kind: `function`
- Form: `Ax.ai(provider, options)`
- Returns: `AI client/service`
- Important options: api key, model, api URL, headers, transport

```java
AxAIService client = Ax.ai("openai", Map.of("apiKey", System.getenv("OPENAI_API_KEY")));
```

### `OpenAICompatibleClient`

OpenAI-compatible chat, stream, embedding, audio, and realtime provider boundary.

- Canonical Ax concept: `OpenAICompatibleClient`
- Kind: `type`
- Form: `new OpenAICompatibleClient(options)`
- Returns: `provider client`
- Important options: api key, model, base URL, transport

### `OpenAIResponsesClient`

OpenAI Responses provider mapping using the same Core-owned request and response contract.

- Canonical Ax concept: `OpenAIResponsesClient`
- Kind: `type`
- Form: `new OpenAIResponsesClient(options)`
- Returns: `provider client`
- Important options: api key, model, audio, realtime

### `GoogleGeminiClient`

Gemini provider mapping for chat, streaming, media, tools, embeddings, and usage normalization.

- Canonical Ax concept: `GoogleGeminiClient`
- Kind: `type`
- Form: `new GoogleGeminiClient(options)`
- Returns: `provider client`
- Important options: api key, model, embed model

### `AnthropicClient`

Anthropic provider mapping for messages, thinking, cache control, streaming, and usage normalization.

- Canonical Ax concept: `AnthropicClient`
- Kind: `type`
- Form: `new AnthropicClient(options)`
- Returns: `provider client`
- Important options: api key, model, thinking, cache control

### `AxBalancer`

Retry and route requests across multiple provider services, with opt-in adaptive cost, reliability, and deadline routing.

- Canonical Ax concept: `AxBalancer`
- Kind: `type`
- Form: `new AxBalancer(services, options)`
- Returns: `AI service`
- Important options: services, retry policy, capability requirements, adaptive strategy

### `AxBalancerAdaptiveStrategy`

Configure adaptive provider routing without changing the ordered default.

- Canonical Ax concept: `AxBalancerAdaptiveStrategy`
- Kind: `type`
- Form: `AxBalancerAdaptiveStrategy`
- Returns: `adaptive strategy`
- Important options: deadline, bad outcome cost, expected tokens, stable route keys, slice, stats store, routing events

### `AxBalancerStatsStore`

Store shared adaptive decision state with atomic observations.

- Canonical Ax concept: `AxBalancerStatsStore`
- Kind: `interface`
- Form: `AxBalancerStatsStore`
- Returns: `stats store`
- Important options: get, observe

### `AxInMemoryBalancerStatsStore`

Thread-safe in-memory adaptive stats store.

- Canonical Ax concept: `AxInMemoryBalancerStatsStore`
- Kind: `type`
- Form: `AxInMemoryBalancerStatsStore`
- Returns: `stats store`

### `AxBalancerAdaptive.createRouteStats`

Create neutral adaptive route statistics.

- Canonical Ax concept: `create_balancer_route_stats`
- Kind: `function`
- Form: `AxBalancerAdaptive.createRouteStats`
- Returns: `route stats`

### `AxBalancerAdaptive.updateRouteStats`

Purely reduce one success or failure observation into route statistics.

- Canonical Ax concept: `update_balancer_route_stats`
- Kind: `function`
- Form: `AxBalancerAdaptive.updateRouteStats`
- Returns: `route stats`
- Important options: current stats, observation

### `AxBalancerAdaptive.sampleRouteHealth`

Sample failure and deadline-miss probability for adaptive exploration.

- Canonical Ax concept: `sample_balancer_route_health`
- Kind: `function`
- Form: `AxBalancerAdaptive.sampleRouteHealth`
- Returns: `sampled health`
- Important options: route stats, deadline

### `MultiServiceRouter`

Choose a service by capability or model routing policy.

- Canonical Ax concept: `MultiServiceRouter`
- Kind: `type`
- Form: `new AxMultiServiceRouter(services)`
- Returns: `AI service`
- Important options: services, routing

### `ProviderRouter`

Route provider requests to registered provider clients.

- Canonical Ax concept: `ProviderRouter`
- Kind: `type`
- Form: `new AxProviderRouter(providers, routing, processing)`
- Returns: `AI service`
- Important options: providers, routing, processing


## Agents And RLM

Run AxAgent through the RLM executor loop with stage instructions, validated evidence citations, persistent playbooks, and actor-code execution through an AxCodeRuntime session.

### `Ax.agent`

Create an AxAgent from a signature and agent/runtime options.

- Canonical Ax concept: `agent`
- Kind: `function`
- Form: `Ax.agent(signature, options)`
- Returns: `AxAgent`
- Important options: name, description, runtime, maxSteps, context fields, discovery, recall, functions, citations, playbook, instruction, instructionAddenda

```java
AxAgent helper = Ax.agent("query:string -> answer:string", Map.of());
```

### `AxAgent`

RLM agent with Core-owned envelopes, state, traces, discovery, recall, delegation, validated citations, stage instructions, persistent run-end learning, and verified playbook evolution.

- Canonical Ax concept: `AxAgent`
- Kind: `type`
- Form: `new AxAgent(signature, options)`
- Returns: `agent program`
- Important options: executor model, runtime, policy, context, optimizer metadata, citations, playbook


## Flow

Compose AxGen, AxAgent, and nested flows into a portable program graph.

### `Ax.flow`

Create an AxFlow program graph or compile the portable Mermaid shorthand.

- Canonical Ax concept: `flow`
- Kind: `function`
- Form: `Ax.flow(options) / Ax.flow(mermaid, bindings)`
- Returns: `AxFlow`
- Important options: nodes, execute mappers, conditions, cache, returns, Mermaid roundtrip

```java
AxFlow wf = Ax.flow(Map.of());
```

### `AxFlow`

Workflow graph with Core-owned planning, cache keys, state merge, child aggregation, optimization, and returns projection.

- Canonical Ax concept: `AxFlow`
- Kind: `type`
- Form: `new AxFlow(optionsOrMermaid, bindings)`
- Returns: `flow program`
- Important options: steps, state, parallel groups, returns


## Tools

Expose host functions to AxGen and AxAgent with typed argument and return schemas.

### `Ax.fn`

Build a typed function tool. Rust uses `tool` because `fn` is reserved.

- Canonical Ax concept: `fn`
- Kind: `function`
- Form: `Ax.fn(name).description(...).arg(...).handler(...).build()`
- Returns: `tool builder or Tool`
- Important options: name, description, args, returns, handler

```java
Tool search = Ax.fn("search").description("Search docs").build();
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
- Form: `new AxMCPClient(transport, options)`
- Returns: `MCP client`
- Important options: transport, client info, roots, tool overrides

```java
AxMCPClient client = new AxMCPClient(transport);
```

### `AxMCPStreamableHTTPTransport`

Streamable HTTP transport with session headers, OAuth options, and SSRF protection.

- Canonical Ax concept: `AxMCPStreamableHTTPTransport`
- Kind: `type`
- Form: `new AxMCPStreamableHTTPTransport(endpoint, options)`
- Returns: `MCP transport`
- Important options: endpoint, headers, OAuth, SSRF protection

### `AxMCPStdioTransport`

Stdio transport with JSON-RPC framing for local MCP servers.

- Canonical Ax concept: `AxMCPStdioTransport`
- Kind: `type`
- Form: `new AxMCPStdioTransport(command, options)`
- Returns: `MCP transport`
- Important options: command, args, env


## Runtime Profiles

Run RLM actor code through the portable AxCodeRuntime and optional target-specific runtime profiles.

### `ProcessCodeRuntime`

Process/JSONL runtime adapter for actor-code sessions and runtime protocol tests.

- Canonical Ax concept: `ProcessCodeRuntime`
- Kind: `type`
- Form: `new AxProcessCodeRuntime(command, env)`
- Returns: `AxCodeRuntime`
- Important options: command, env, cwd, timeout

```java
AxCodeRuntime runtime = new AxProcessCodeRuntime(List.of("node", "runtime-server.mjs"), Map.of());
```

### `RuntimeCapabilities`

Runtime capability envelope visible to the agent runtime policy.

- Canonical Ax concept: `RuntimeCapabilities`
- Kind: `type`
- Form: `new AxRuntimeCapabilities()`
- Returns: `capability record`
- Important options: language, snapshot, patch, abort, usage instructions

### `RuntimeEnvelope`

Actor primitive envelope for final, clarification, discovery, recall, used, guidance, and runtime results.

- Canonical Ax concept: `RuntimeEnvelope`
- Kind: `type`
- Form: `AxRuntimeEnvelope`
- Returns: `runtime envelope`
- Important options: type, args, result, error

### `javascript-quickjs`

Optional runtime profile for javascript actor code.

- Canonical Ax concept: `runtime-profile:javascript-quickjs`
- Kind: `runtime-profile`
- Form: `tools/axir verify --targets java --runtime-profiles javascript-quickjs`
- Returns: `AxCodeRuntime-compatible actor execution profile`
- Important options: actor language: javascript, support mode: embedded, dependency mode: optional-classpath, environment gate: AXIR_QUICKJS4J_CP, environment gate: AXIR_QUICKJS4J_CP_FILE, environment gate: AXIR_QUICKJS4J_RESOLVE

### `python-pyodide`

Optional runtime profile for python actor code.

- Canonical Ax concept: `runtime-profile:python-pyodide`
- Kind: `runtime-profile`
- Form: `tools/axir verify --targets java --runtime-profiles python-pyodide`
- Returns: `AxCodeRuntime-compatible actor execution profile`
- Important options: actor language: python, support mode: process-adapter, dependency mode: optional-env, environment gate: AXIR_PYODIDE_RUNTIME_SERVER, environment gate: AXIR_PYODIDE_RESOLVE


## Optimizers

Optimize Ax programs through BootstrapFewShot -> GEPA composition and evolve program or agent playbooks through grounded, budgeted, rollback-safe learning.

### `Ax.optimize`

Convenience optimizer helper that composes AxBootstrapFewShot before AxGEPA and returns an artifact without applying final component changes.

- Canonical Ax concept: `optimize`
- Kind: `function`
- Form: `Ax.optimize(program, examples, options)`
- Returns: `optimized artifact`
- Important options: student/client, teacher/reflection client, metric budget, bootstrap

```java
Map<String, Object> artifact = Ax.optimize(qa, train, Map.of("studentAI", client, "teacherAI", reflection));
```

### `Ax.playbook`

Bind an ACE-backed playbook to a program; agents also expose an agent-bound playbook handle.

- Canonical Ax concept: `playbook`
- Kind: `function`
- Form: `Ax.playbook(program, options)`
- Returns: `AxPlaybook`
- Important options: student/client, teacher, seed snapshot, online updates, verification budget

```java
AxPlaybook pb = Ax.playbook(program, Map.of("studentAI", client));
```

### `AxPlaybook`

Persistent playbook with render/update/snapshot operations and agent-bound verified evolve over train/validation task sets.

- Canonical Ax concept: `AxPlaybook`
- Kind: `type`
- Form: `AxPlaybook / agent.playbook(options)`
- Returns: `playbook handle`
- Important options: verify, minHeldInGain, epsilon, runsPerTask, maxMetricCalls, maxProposals

### `AxBootstrapFewShot`

Few-shot demonstration optimizer that selects successful evaluator rollouts before prompt/component evolution.

- Canonical Ax concept: `AxBootstrapFewShot`
- Kind: `type`
- Form: `new AxBootstrapFewShot(options)`
- Returns: `optimizer engine`
- Important options: quality threshold, max demos, max rounds, batch size

```java
AxBootstrapFewShot bootstrap = new AxBootstrapFewShot(Map.of("qualityThreshold", 0.7));
```

### `AxGEPA`

Generated GEPA optimizer engine with Core-owned reflection, Pareto, bootstrap, and selector-state behavior.

- Canonical Ax concept: `AxGEPA`
- Kind: `type`
- Form: `new AxGEPA(reflection, options)`
- Returns: `optimizer engine`
- Important options: reflection client, budget, metric, candidate count

```java
AxGEPA engine = new AxGEPA(reflectionClient, Map.of());
```

### `OptimizerEngine`

Optimizer boundary consumed by AxGen, AxAgent, and AxFlow optimization helpers.

- Canonical Ax concept: `OptimizerEngine`
- Kind: `interface`
- Form: `OptimizerEngine.optimize(request, evaluator)`
- Returns: `optimized artifact`
- Important options: request, evaluator

### `OptimizerEvaluator`

Evaluator callback boundary used by generated optimizers.

- Canonical Ax concept: `OptimizerEvaluator`
- Kind: `interface`
- Form: `OptimizerEvaluator.evaluate(request)`
- Returns: `score/evidence result`
- Important options: dataset rows, candidate map, evidence


## Errors And Values

Handle target-native errors and dynamic values at Ax host boundaries.

### `AxAIServiceError`

Target-native error envelope for validation, provider, runtime, MCP, and optimizer failures.

- Canonical Ax concept: `AxError`
- Kind: `type`
- Form: `AxAIServiceError with target-native error handling`
- Returns: `error`
- Important options: category, message, status, code, retryable

### `Object`

Dynamic JSON-like value boundary used by generated package APIs, tools, providers, MCP, and runtime sessions.

- Canonical Ax concept: `Value`
- Kind: `type`
- Form: `Object`
- Returns: `dynamic value`
- Important options: string, number, boolean, object, array, null
