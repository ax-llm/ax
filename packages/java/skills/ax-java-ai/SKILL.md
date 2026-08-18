---
name: "ax-java-ai"
description: "Use when writing Java code with `dev.axllm:ax` for named deployment profiles, generic provider clients, model selection, OpenAI-compatible calls, Responses, Gemini, Anthropic, routers, and balancers."
version: "23.0.16"
---
# AxAI Providers For Java

This skill helps an agent write Java code with the generated Ax package `dev.axllm:ax`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Create provider clients or normalize provider options.
- Choose a named deployment profile separately from the model ID served by that deployment.
- Choose between model-list routing, ordered failover, and adaptive operational routing.
- Use scripted transports for deterministic no-key examples.
- Use provider-api examples only when explicit provider credentials are available.

## Package Facts

- Language: Java.
- Package: `dev.axllm:ax`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```java
import dev.axllm.ax.*;

var llm = Ax.ai("openai", java.util.Map.of("apiKey", System.getenv("OPENAI_API_KEY")));
```

## Named Deployment Profiles

- The first `ai` / `NewAI` factory argument selects deployment behavior. The model option selects a model only inside that deployment; never infer request rules from a vendor-looking model ID.
- `openai` is the official OpenAI deployment. `openai-compatible` is the conservative custom-endpoint profile and requires an explicit base URL. Unknown profile names are errors.
- A Together-hosted DeepSeek model uses the `together` profile's URL, authentication, reasoning fields, and effort mapping. Native DeepSeek `thinking` fields apply only to the `deepseek` profile.
- Verified DeepSeek, Grok, Groq, Cerebras, and DeepInfra model rules default an omitted thinking level to logical `max`, mapped to the strongest documented deployment effort.
- Send `none` only where the selected deployment and model document reasoning disablement. Unsupported levels fail before network I/O; dynamic Hugging Face Router routes remain conservative.
- Use named factories for Azure OpenAI, Cohere, DeepSeek, DeepSeek Responses, Mistral, Reka, Grok, routers, hosted inference, and configurable runtimes. Profile-only branded client constructors were removed.
- Retained client classes are transport/runtime boundaries: OpenAI-compatible Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini GenerateContent. Build ordinary applications through the named factory.
- Provider descriptors and conformance fixtures are generated from the shared profile manifest. Do not add provider-name switches or cross-profile model normalization in a generated package.

## Vertex And Prompt Caching

- Configure Gemini or Anthropic Vertex mode with `projectId` / `project_id` and `region`; optionally select a Vertex endpoint with `endpointId` / `endpoint_id`.
- In Vertex mode, `apiKey` / `api_key` is a caller-supplied bearer access token. Generated clients may read `GOOGLE_VERTEX_ACCESS_TOKEN`, but automatic ADC and token refresh remain host-owned.
- Core resolves `global`, `us`, `eu`, and regional Vertex hosts. An explicit `baseUrl` / `base_url` takes precedence.
- OpenAI GPT-5.6 Chat explicit caching is opt-in through `contextCache` / `context_cache` or message/function cache flags. Use `promptCacheKey` / `prompt_cache_key` for stable affinity; `sessionId` / `session_id` is the fallback.
- Normalized usage separates uncached prompt, cache-read, and cache-creation tokens. `get_model_cost` / target equivalent uses the shared model catalog, including cache-write pricing and long-context thresholds.
- Start with the OpenAI prompt-caching and Vertex Gemini examples under `examples/`. Scripted AxAI fixtures verify routing without live credentials.

## Routing And Balancing

- Use the multi-service router when a logical model key selects a configured service or concrete model. It combines model lists; it does not learn from outcomes.
- Use the default `AxBalancer` for deterministic ordered/metric failover with its existing retry policy.
- Opt into `AxBalancerAdaptiveStrategy` only for operational routing among application-approved equivalent aliases. It learns transient reliability and successful latency, combines them with estimated cost and a deadline, and explores with Thompson sampling.
- Put centralized decision state in an `AxBalancerStatsStore`. The routing-event callback is best-effort analytics and observability, not a state replication mechanism.
- Shared stores require non-empty, unique, stable route keys. Use slices to isolate workflows, tenants, or traffic classes without putting prompts, responses, raw errors, or sensitive identifiers in keys or events.
- Adaptive balancing does not measure answer quality or semantically choose a model. Only group routes that the application already accepts as substitutes.
- Generated streaming APIs are buffered: a provider error can fail over before the completed result is returned, and success latency is recorded after completion.
- Start with `examples/adaptive_balancer_no_key` for store/reducer syntax, then use the cataloged provider-backed adaptive-balancer example for a complete two-route setup.

## Relevant API Surface

- AxAI: `Ax.ai`, `OpenAICompatibleClient`, `OpenAIResponsesClient`, `GoogleGeminiClient`, `AnthropicClient`, `Map<String, Object>`, `AxUsageEvent`, `AxUsageObserver`, `AxGlobals.setUsageObserver`, `AxBalancer`, `AxBalancerAdaptiveStrategy`, `AxBalancerStatsStore`, `AxInMemoryBalancerStatsStore`, `AxBalancerAdaptive.createRouteStats`, `AxBalancerAdaptive.updateRouteStats`, `AxBalancerAdaptive.sampleRouteHealth`, `MultiServiceRouter`, `ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.