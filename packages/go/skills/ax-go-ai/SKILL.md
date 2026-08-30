---
name: "ax-go-ai"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for named deployment profiles, generic provider clients, model selection, OpenAI-compatible calls, Responses, Gemini, Anthropic, routers, and balancers."
version: "24.0.15"
---
# AxAI Providers For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

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

- Language: Go.
- Package: `github.com/ax-llm/ax/packages/go`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-goja`.

## Core Pattern

```go
import ax "github.com/ax-llm/ax/packages/go"

llm := ax.NewAI("openai", map[string]ax.Value{"apiKey": os.Getenv("OPENAI_API_KEY")})
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

## Relevant API Surface

- AxAI: `axllm.NewAI`, `axllm.AxCredentialRequest`, `axllm.AxCredentialProvider`, `axllm.AxChatStream`, `axllm.OpenAICompatibleClient`, `axllm.OpenAIResponsesClient`, `axllm.GoogleGeminiClient`, `axllm.AnthropicClient`, `axllm.AxUsageContext`, `axllm.AxUsageEvent`, `axllm.AxUsageObserver`, `axllm.SetUsageObserver`, `axllm.AxRuntimeHooks`, `axllm.AxRateLimitInfo`, `axllm.AxRateLimiter`, `axllm.AxTracer`, `axllm.AxMeter`, `axllm.AxGlobals`, `axllm.SetRateLimiter`, `axllm.SetTracer`, `axllm.SetMeter`, `axllm.AxBalancer`, `axllm.AxBalancerAdaptiveStrategy`, `axllm.AxBalancerStatsStore`, `axllm.AxInMemoryBalancerStatsStore`, `axllm.CreateBalancerRouteStats`, `axllm.UpdateBalancerRouteStats`, `axllm.SampleBalancerRouteHealth`, `axllm.MultiServiceRouter`, `axllm.ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
- When decorating `AIClient`, forward `GetFeatures(model) map[string]Value` whenever the wrapped client implements it. AxGen otherwise falls back to permissive capabilities, which can select an unsupported structured-output rung.
- For Vertex OpenAI-compatible MaaS, prefer `NewAI("vertex-ai", options)` with `AxCredentialProviderFunc`; do not reintroduce a request-rewriting response-format decorator.