---
name: "ax-go-ai"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for provider clients, model selection, OpenAI-compatible calls, Responses, Gemini, Anthropic, routers, and balancers."
version: "23.0.3"
---
# AxAI Providers For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Create provider clients or normalize provider options.
- Choose between model-list routing, ordered failover, and adaptive operational routing.
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

- AxAI: `axllm.NewAI`, `axllm.OpenAICompatibleClient`, `axllm.OpenAIResponsesClient`, `axllm.GoogleGeminiClient`, `axllm.AnthropicClient`, `axllm.AxUsageContext`, `axllm.AxUsageEvent`, `axllm.AxUsageObserver`, `axllm.SetUsageObserver`, `axllm.AxBalancer`, `axllm.AxBalancerAdaptiveStrategy`, `axllm.AxBalancerStatsStore`, `axllm.AxInMemoryBalancerStatsStore`, `axllm.CreateBalancerRouteStats`, `axllm.UpdateBalancerRouteStats`, `axllm.SampleBalancerRouteHealth`, `axllm.MultiServiceRouter`, `axllm.ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.