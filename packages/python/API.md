# Ax for Python API Reference

This generated API reference is emitted by AxIR from compiler-owned metadata. Do not edit it by hand; change the AxIR generator and regenerate packages instead.

## Package

- Target: `python`
- Package: `axllm`
- AxIR contract: `0.1`

## Signatures

Describe typed Ax inputs and outputs once, then reuse that shape for schemas, prompts, validation, tools, and structured results.

### `s`

Parse an Ax string signature into the target language signature object.

- Canonical Ax concept: `s`
- Kind: `function`
- Form: `s(signature: str)`
- Returns: `AxSignature`

```python
sig = s("question:string -> answer:string")
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
- Form: `ax(signature, options=None)`
- Returns: `AxGen`
- Important options: functions, examples, demos, modelConfig, maxRetries, streaming assertions, field processors

```python
qa = ax("question:string -> answer:string")
```

### `AxGen`

Structured generation program with forward, streaming, optimization, trace, usage, and tool-call behavior.

- Canonical Ax concept: `AxGen`
- Kind: `type`
- Form: `AxGen(signature, options=None)`
- Returns: `program object`
- Important options: signature, functions, examples, demos, memory, prompt template


## AxAI

Call supported providers through the shared provider descriptor registry, scripted transports, routers, and balancers.

### `ai`

Create a provider client from a provider name and options.

- Canonical Ax concept: `ai`
- Kind: `function`
- Form: `ai(provider='openai', **options)`
- Returns: `AI client/service`
- Important options: api key, model, api URL, headers, transport

```python
client = ai("openai", api_key=os.environ["OPENAI_API_KEY"])
```

### `OpenAICompatibleClient`

OpenAI-compatible chat, stream, embedding, audio, and realtime provider boundary.

- Canonical Ax concept: `OpenAICompatibleClient`
- Kind: `type`
- Form: `OpenAICompatibleClient(options=None)`
- Returns: `provider client`
- Important options: api key, model, base URL, transport

### `OpenAIResponsesClient`

OpenAI Responses provider mapping using the same Core-owned request and response contract.

- Canonical Ax concept: `OpenAIResponsesClient`
- Kind: `type`
- Form: `OpenAIResponsesClient(options=None)`
- Returns: `provider client`
- Important options: api key, model, audio, realtime

### `GoogleGeminiClient`

Gemini provider mapping for chat, streaming, media, tools, embeddings, and usage normalization.

- Canonical Ax concept: `GoogleGeminiClient`
- Kind: `type`
- Form: `GoogleGeminiClient(options=None)`
- Returns: `provider client`
- Important options: api key, model, embed model

### `AnthropicClient`

Anthropic provider mapping for messages, thinking, cache control, streaming, and usage normalization.

- Canonical Ax concept: `AnthropicClient`
- Kind: `type`
- Form: `AnthropicClient(options=None)`
- Returns: `provider client`
- Important options: api key, model, thinking, cache control

### `AxUsageContext`

Application attribution merged from service defaults and per-call overrides.

- Canonical Ax concept: `AxUsageContext`
- Kind: `type`
- Form: `dict[str, object]`
- Returns: `usage context`
- Important options: tenant, user, request, run, feature, attributes

### `AxUsageEvent`

Normalized token usage and correlation data for one completed chat or embedding operation.

- Canonical Ax concept: `AxUsageEvent`
- Kind: `type`
- Form: `AxUsageEvent`
- Returns: `usage event`
- Important options: provider, model, tokens, context, correlation IDs, streaming

### `AxUsageObserver`

Best-effort process-wide callback for normalized usage events.

- Canonical Ax concept: `AxUsageObserver`
- Kind: `interface`
- Form: `AxUsageObserver`
- Returns: `usage observer`
- Important options: fail-open delivery, synchronous enqueue

### `set_usage_observer`

Register, replace, or clear the process-wide usage observer.

- Canonical Ax concept: `set_usage_observer`
- Kind: `function`
- Form: `set_usage_observer(observer)`
- Returns: `void`
- Important options: observer, clear

```python
set_usage_observer(events.append)
```

### `AxBalancer`

Retry and route requests across multiple provider services, with opt-in adaptive cost, reliability, and deadline routing.

- Canonical Ax concept: `AxBalancer`
- Kind: `type`
- Form: `AxBalancer(services, options=None)`
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

### `create_balancer_route_stats`

Create neutral adaptive route statistics.

- Canonical Ax concept: `create_balancer_route_stats`
- Kind: `function`
- Form: `create_balancer_route_stats`
- Returns: `route stats`

### `update_balancer_route_stats`

Purely reduce one success or failure observation into route statistics.

- Canonical Ax concept: `update_balancer_route_stats`
- Kind: `function`
- Form: `update_balancer_route_stats`
- Returns: `route stats`
- Important options: current stats, observation

### `sample_balancer_route_health`

Sample failure and deadline-miss probability for adaptive exploration.

- Canonical Ax concept: `sample_balancer_route_health`
- Kind: `function`
- Form: `sample_balancer_route_health`
- Returns: `sampled health`
- Important options: route stats, deadline

### `MultiServiceRouter`

Choose a service by capability or model routing policy.

- Canonical Ax concept: `MultiServiceRouter`
- Kind: `type`
- Form: `MultiServiceRouter(services)`
- Returns: `AI service`
- Important options: services, routing

### `ProviderRouter`

Route provider requests to registered provider clients.

- Canonical Ax concept: `ProviderRouter`
- Kind: `type`
- Form: `ProviderRouter(providers, routing=None, processing=None)`
- Returns: `AI service`
- Important options: providers, routing, processing


## Agents And RLM

Run AxAgent through the RLM executor loop with stage instructions, validated evidence citations, persistent playbooks, and actor-code execution through an AxCodeRuntime session.

### `agent`

Create an AxAgent from a signature and agent/runtime options.

- Canonical Ax concept: `agent`
- Kind: `function`
- Form: `agent(signature, config=None)`
- Returns: `AxAgent`
- Important options: name, description, runtime, maxSteps, context fields, discovery, recall, functions, skills, skillsCatalog, memoriesCatalog, relevanceRanking, load observers, used observers, citations, playbook, instruction, instructionAddenda

```python
helper = agent("query:string -> answer:string")
```

### `AxAgent`

RLM agent with Core-owned envelopes, complete runtime-state export/restore, traces, discovery, recall, loaded skills and memories, usage observers, delegation, validated citations, stage instructions, persistent run-end learning, and verified playbook evolution.

- Canonical Ax concept: `AxAgent`
- Kind: `type`
- Form: `AxAgent(signature, config=None)`
- Returns: `agent program`
- Important options: executor model, runtime, policy, context, skills, memories, relevance ranking, observers, runtime state, optimizer metadata, citations, playbook


## Flow

Compose AxGen, AxAgent, and nested flows into a portable program graph.

### `flow`

Create an AxFlow program graph or compile the portable Mermaid shorthand.

- Canonical Ax concept: `flow`
- Kind: `function`
- Form: `flow(options=None) / flow(mermaid, bindings=None)`
- Returns: `AxFlow`
- Important options: nodes, execute mappers, conditions, cache, returns, Mermaid roundtrip

```python
wf = flow().node("qa", ax("question:string -> answer:string"))
```

### `AxFlow`

Workflow graph with Core-owned planning, cache keys, state merge, child aggregation, optimization, and returns projection.

- Canonical Ax concept: `AxFlow`
- Kind: `type`
- Form: `AxFlow(options=None, bindings=None)`
- Returns: `flow program`
- Important options: steps, state, parallel groups, returns


## Tools

Expose host functions to AxGen and AxAgent with typed argument and return schemas.

### `fn`

Build a typed function tool. Rust uses `tool` because `fn` is reserved.

- Canonical Ax concept: `fn`
- Kind: `function`
- Form: `fn(name).description(...).arg(...).handler(...).build()`
- Returns: `tool builder or Tool`
- Important options: name, description, args, returns, handler

```python
search = fn("search").description("Search docs").arg("query", f.string()).build()
```

### `Tool`

Callable tool descriptor with JSON-schema-compatible parameters and a host handler.

- Canonical Ax concept: `Tool`
- Kind: `type`
- Form: `Tool(name, description, parameters, handler)`
- Returns: `tool descriptor`
- Important options: parameters, returns, handler


## MCP

Use MCP clients and transports while keeping JSON-RPC lifecycle, tools, prompts, resources, OAuth, cancellation, and SSRF checks aligned.

### `AxMCPClient`

MCP client that lists tools/prompts/resources and converts MCP tools to Ax functions.

- Canonical Ax concept: `AxMCPClient`
- Kind: `type`
- Form: `AxMCPClient(transport, options=None)`
- Returns: `MCP client`
- Important options: transport, client info, roots, tool overrides

```python
client = AxMCPClient(transport)
```

### `AxMCPStreamableHTTPTransport`

Streamable HTTP transport with session headers, OAuth options, and SSRF protection.

- Canonical Ax concept: `AxMCPStreamableHTTPTransport`
- Kind: `type`
- Form: `AxMCPStreamableHTTPTransport(endpoint, options=None)`
- Returns: `MCP transport`
- Important options: endpoint, headers, OAuth, SSRF protection

### `AxMCPStdioTransport`

Stdio transport with JSON-RPC framing for local MCP servers.

- Canonical Ax concept: `AxMCPStdioTransport`
- Kind: `type`
- Form: `AxMCPStdioTransport(command, options=None)`
- Returns: `MCP transport`
- Important options: command, args, env


## Runtime Profiles

Run RLM actor code through the portable AxCodeRuntime and optional target-specific runtime profiles.

### `ProcessCodeRuntime`

Process/JSONL runtime adapter for actor-code sessions and runtime protocol tests.

- Canonical Ax concept: `ProcessCodeRuntime`
- Kind: `type`
- Form: `ProcessCodeRuntime(command, env=None)`
- Returns: `AxCodeRuntime`
- Important options: command, env, cwd, timeout

```python
runtime = ProcessCodeRuntime(["node", "runtime-server.mjs"])
```

### `RuntimeCapabilities`

Runtime capability envelope visible to the agent runtime policy.

- Canonical Ax concept: `RuntimeCapabilities`
- Kind: `type`
- Form: `RuntimeCapabilities(...).to_dict()`
- Returns: `capability record`
- Important options: language, snapshot, patch, abort, usage instructions

### `RuntimeEnvelope`

Actor primitive envelope for final, clarification, discovery, recall, used, guidance, and runtime results.

- Canonical Ax concept: `RuntimeEnvelope`
- Kind: `type`
- Form: `RuntimeEnvelope.from_result(...)`
- Returns: `runtime envelope`
- Important options: type, args, result, error

### `javascript-quickjs`

Optional runtime profile for javascript actor code.

- Canonical Ax concept: `runtime-profile:javascript-quickjs`
- Kind: `runtime-profile`
- Form: `tools/axir verify --targets python --runtime-profiles javascript-quickjs`
- Returns: `AxCodeRuntime-compatible actor execution profile`
- Important options: actor language: javascript, support mode: process-adapter, dependency mode: optional-env, environment gate: AXIR_QUICKJS4J_CP, environment gate: AXIR_QUICKJS4J_CP_FILE, environment gate: AXIR_QUICKJS4J_RESOLVE

### `python-pyodide`

Optional runtime profile for python actor code.

- Canonical Ax concept: `runtime-profile:python-pyodide`
- Kind: `runtime-profile`
- Form: `tools/axir verify --targets python --runtime-profiles python-pyodide`
- Returns: `AxCodeRuntime-compatible actor execution profile`
- Important options: actor language: python, support mode: process-adapter, dependency mode: optional-env, environment gate: AXIR_PYODIDE_RUNTIME_SERVER, environment gate: AXIR_PYODIDE_RESOLVE


## Optimizers

Optimize Ax programs through BootstrapFewShot -> GEPA composition and evolve program or agent playbooks through grounded, budgeted, rollback-safe learning.

### `optimize`

Convenience optimizer helper that composes AxBootstrapFewShot before AxGEPA and returns an artifact without applying final component changes.

- Canonical Ax concept: `optimize`
- Kind: `function`
- Form: `optimize(program, examples, options=None)`
- Returns: `optimized artifact`
- Important options: student/client, teacher/reflection client, metric budget, bootstrap

```python
artifact = optimize(qa, train, {"studentAI": client, "teacherAI": reflection})
```

### `playbook`

Bind an ACE-backed playbook to a program; agents also expose an agent-bound playbook handle.

- Canonical Ax concept: `playbook`
- Kind: `function`
- Form: `playbook(program, options=None)`
- Returns: `AxPlaybook`
- Important options: student/client, teacher, seed snapshot, online updates, verification budget

```python
pb = playbook(program, {"studentAI": client})
```

### `AxPlaybook`

Persistent playbook with render/update/snapshot operations and agent-bound verified evolve over train/validation task sets.

- Canonical Ax concept: `AxPlaybook`
- Kind: `type`
- Form: `AxPlaybook / agent.playbook()`
- Returns: `playbook handle`
- Important options: verify, minHeldInGain, epsilon, runsPerTask, maxMetricCalls, maxProposals

### `AxBootstrapFewShot`

Few-shot demonstration optimizer that selects successful evaluator rollouts before prompt/component evolution.

- Canonical Ax concept: `AxBootstrapFewShot`
- Kind: `type`
- Form: `AxBootstrapFewShot(**options)`
- Returns: `optimizer engine`
- Important options: quality threshold, max demos, max rounds, batch size

```python
bootstrap = AxBootstrapFewShot(qualityThreshold=0.7)
```

### `AxGEPA`

Generated GEPA optimizer engine with Core-owned reflection, Pareto, bootstrap, and selector-state behavior.

- Canonical Ax concept: `AxGEPA`
- Kind: `type`
- Form: `AxGEPA(reflection, **options)`
- Returns: `optimizer engine`
- Important options: reflection client, budget, metric, candidate count

```python
engine = AxGEPA(reflection_client)
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

### `AxValidationError / AxAIServiceError`

Target-native error envelope for validation, provider, runtime, MCP, and optimizer failures.

- Canonical Ax concept: `AxError`
- Kind: `type`
- Form: `AxValidationError / AxAIServiceError with target-native error handling`
- Returns: `error`
- Important options: category, message, status, code, retryable

### `dict/list/scalar`

Dynamic JSON-like value boundary used by generated package APIs, tools, providers, MCP, and runtime sessions.

- Canonical Ax concept: `Value`
- Kind: `type`
- Form: `dict/list/scalar`
- Returns: `dynamic value`
- Important options: string, number, boolean, object, array, null
