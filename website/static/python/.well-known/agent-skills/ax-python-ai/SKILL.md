---
name: "ax-python-ai"
description: "Use when writing Python code with `axllm` for named deployment profiles, generic provider clients, model selection, OpenAI-compatible calls, Responses, Gemini, Anthropic, routers, and balancers."
version: "24.0.17"
---
# AxAI Providers For Python

This skill helps an agent write Python code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Create provider clients or normalize provider options.
- Choose a named deployment profile separately from the model ID served by that deployment.
- Attach renewable per-request credentials for expiring cloud tokens.
- Resolve structured-output modes from the selected profile and model.
- Choose between model-list routing, ordered failover, and adaptive operational routing.
- Route multimodal requests without flattening native images when the selected provider supports them.
- Use scripted transports for deterministic no-key examples.
- Use provider-api examples only when explicit provider credentials are available.

## Package Facts

- Language: Python.
- Package: `axllm`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```python
import os
from axllm import ai

llm = ai("openai", api_key=os.environ["OPENAI_API_KEY"])
```

## Named Deployment Profiles

- The first `ai` / `NewAI` factory argument selects deployment behavior. The model option selects a model only inside that deployment; never infer request rules from a vendor-looking model ID.
- `openai` is the official OpenAI deployment. `openai-compatible` is the conservative custom-endpoint profile and requires an explicit base URL. Unknown profile names are errors.
- A Together-hosted DeepSeek model uses the `together` profile's URL, authentication, reasoning fields, and effort mapping. Native DeepSeek `thinking` fields apply only to the `deepseek` profile.
- Verified DeepSeek, Grok, Groq, Cerebras, and DeepInfra model rules default an omitted thinking level to logical `max`, mapped to the strongest documented deployment effort.
- Send `none` only where the selected deployment and model document reasoning disablement. Unsupported levels fail before network I/O; dynamic Hugging Face Router routes remain conservative.
- Structured output is an ordered model-aware capability: `native`, `function`, and `json_object`. Exact caller model metadata overrides the first matching profile rule, which overrides the profile default.
- An explicit unsupported structured-output mode fails before transport. `structuredOutputs` / `structured_outputs` remains the compatibility alias for native JSON Schema only.
- The exact Vertex `google/gemma-4-26b-a4b-it-maas` rule prefers `json_object`, excludes native schema, defaults thinking to `max`, writes nested `enable_thinking`, and extracts/replays `reasoning_content`. Unknown Vertex models stay conservative.
- Use named factories for Azure OpenAI, Cohere, DeepSeek, DeepSeek Responses, Mistral, Reka, Grok, routers, hosted inference, and configurable runtimes. Profile-only branded client constructors were removed.
- Retained client classes are transport/runtime boundaries: OpenAI-compatible Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini GenerateContent. Build ordinary applications through the named factory.
- Provider descriptors and conformance fixtures are generated from the shared profile manifest. Do not add provider-name switches or cross-profile model normalization in a generated package.

## Vertex And Prompt Caching

- Configure Gemini or Anthropic Vertex mode with `projectId` / `project_id` and `region`; optionally select a Vertex endpoint with `endpointId` / `endpoint_id`.
- Use `credentialProvider` / `credential_provider` for expiring Vertex and cloud tokens. It receives profile, operation, method, and URL on every attempt; its headers override static authentication.
- Credential callbacks cover chat, stream, embeddings, Responses, transcription, speech, and retries. Callback errors stop before transport, and completed 401/403 generation responses are not replayed automatically.
- Keep ADC and cloud SDK dependencies host-owned: obtain or refresh the token inside the callback. A required-auth profile accepts either a static key or the callback.
- Core resolves `global`, `us`, `eu`, and regional Vertex hosts. An explicit `baseUrl` / `base_url` takes precedence.
- OpenAI GPT-5.6 Chat explicit caching is opt-in through `contextCache` / `context_cache` or message/function cache flags. Use `promptCacheKey` / `prompt_cache_key` for stable affinity; `sessionId` / `session_id` is the fallback.
- Normalized usage separates uncached prompt, cache-read, and cache-creation tokens. `get_model_cost` / target equivalent uses the shared model catalog, including cache-write pricing and long-context thresholds.
- Start with the OpenAI prompt-caching and Vertex Gemini examples under `examples/`. Scripted AxAI fixtures verify routing without live credentials.

## Routing And Balancing

- Use the multi-service router when a logical model key selects a configured service or concrete model. It combines model lists; it does not learn from outcomes.
- Use `ProviderRouter` for capability-based selection and optional media degradation. When the selected provider supports images, preserve every native image part with its payload, MIME type, detail level, cache and optimization hints, alt text, and ordering with surrounding text.
- Use the default `AxBalancer` for deterministic ordered/metric failover with its existing retry policy.
- Opt into `AxBalancerAdaptiveStrategy` only for operational routing among application-approved equivalent aliases. It learns transient reliability and successful latency, combines them with estimated cost and a deadline, and explores with Thompson sampling.
- Put centralized decision state in an `AxBalancerStatsStore`. The routing-event callback is best-effort analytics and observability, not a state replication mechanism.
- Shared stores require non-empty, unique, stable route keys. Use slices to isolate workflows, tenants, or traffic classes without putting prompts, responses, raw errors, or sensitive identifiers in keys or events.
- Adaptive balancing does not measure answer quality or semantically choose a model. Only group routes that the application already accepts as substitutes.
- Generated provider streams are incremental and closeable. Retry or failover is allowed only before the first content event; later failures surface without replay, and adaptive latency is recorded at the first chunk.
- Start with `examples/adaptive_balancer_no_key` for store/reducer syntax, then use the cataloged provider-backed adaptive-balancer example for a complete two-route setup.

## Astra Session Work

Select `gpt-6-astra` through the ordinary OpenAI factory. The adapter chooses Responses automatically; existing model defaults are unchanged. Use low reasoning and standard processing. Portable minimal reasoning maps to low; none is rejected. EU residency does not support priority processing.

Keep applications on their generation, agent, and flow entrypoints. Declare only independent tools as background; ordinary and imported MCP tools stay blocking unless the application explicitly changes their declaration. A promise, thread, or MCP hint is not a background declaration. Set `asyncMode` to `off` for the ordinary tool loop; chat-only services retain that loop automatically.

Attach the language-native run controller through forward options for steering, reasoning changes, cancellation, and lifecycle events. Queued and applied are different states. HTTP applies updates at a response boundary; an optional host WebSocket enables native steering. Do not manage response IDs, socket messages, or tool-result submission in application code.

A provisional answer is not successful completion while started tools remain unresolved. Cancellation closes the session and reports unresolved call IDs; it cannot undo an external action. Handlers may cooperate through the invocation cancellation context. Late results from noncooperative work must not change a closed run or trigger replay.

Java, C++, and Rust WebSocket adapters track activity when frames arrive. Consuming buffered events does not reactivate a completed response. When no response is active, steering is queued for the next response; an active successor can still receive native steering. Observe lifecycle timing instead of assuming native application.

C++ session tools validate required raw-schema properties and argument types before invoking handlers. Invalid arguments enter the correction loop, and step exhaustion fails the run. Full raw JSON Schema constraint coverage remains incomplete.

Generated flow groups currently execute serially in Python, Go, Java, C++, and Rust. Sequential node isolation and background tool/model overlap within a node do not establish concurrent node execution. The TypeScript parallel-flow examples describe TypeScript behavior only.

Use the provider-backed Astra examples under `src/examples/python/generation/`, `short-agents/`, and `flows/`. All-five generated parity remains under verification in the shared-session AxIR backlog; do not infer full agent, parallel-flow, or transport parity from these examples alone.

## Relevant API Surface

- AxAI: `ai`, `AxCancellationToken`, `AxAIServiceAbortedError`, `get_supported_ai_models`, `dict[str, str]`, `Callable[[dict[str, str]], dict[str, str]]`, `AxChatSession`, `closable generator`, `OpenAICompatibleClient`, `OpenAIResponsesClient`, `GoogleGeminiClient`, `AnthropicClient`, `AxUsageContext`, `AxUsageEvent`, `AxUsageObserver`, `set_usage_observer`, `AxRuntimeHooks`, `AxRateLimitInfo`, `AxRateLimiter`, `AxTracer`, `AxMeter`, `AxGlobals`, `set_rate_limiter`, `set_tracer`, `set_meter`, `AxBalancer`, `AxBalancerAdaptiveStrategy`, `AxBalancerStatsStore`, `AxInMemoryBalancerStatsStore`, `create_balancer_route_stats`, `update_balancer_route_stats`, `sample_balancer_route_health`, `MultiServiceRouter`, `ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
