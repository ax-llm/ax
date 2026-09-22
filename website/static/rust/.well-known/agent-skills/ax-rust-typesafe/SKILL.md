---
name: "ax-rust-typesafe"
description: "Use when writing Rust code with `axllm` for Typesafe Jev boolean/class signatures, value descriptions, configurable Noul conversion, native Noul/Choice/Score, structured criteria and hybrid generation."
version: "24.0.20"
---
# Typesafe / Jev For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Use Jev for typed decisions with ordinary Ax signatures.
- Use native questions for probabilities, rich criteria, structured state, or scoring.
- Compose a separate generative program for prose or tools.

## Package Facts

- Language: Rust.
- Package: `axllm`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`.

## Core Pattern

```rust
let mut model = ai("typesafe", json!({"api_key": api_key, "trueThreshold": 0.9}))?;
let decision = ax("ticket:string -> urgent:boolean(true \"Core task blocked\", false \"Routine request\"), team:class \"support, billing, engineering\"")?.forward(&mut model, json!({"ticket": ticket}))?;
```

## Typesafe / Jev

The typesafe provider supports required boolean and class outputs. Numeric bounds never define a Score rubric; numbers, freeform strings, optional outputs, arrays, nesting, media, tools, and sampling controls are rejected before transport.

Set provider trueThreshold (or true_threshold) to a finite value in [0,1], default 0.5. Boolean conversion uses noul >= threshold; this policy is local and never sent. Choice returns the selected label without a confidence cutoff.

Use boolean(true "Core task blocked", false "Routine request") and class label descriptions for criteria. Fluent describe_values / describeValues / DescribeValues keeps the same field value type. C++ uses valueDescriptions on its existing field descriptors. Other providers receive readable prompt and schema descriptions.

The separate native client exposes system_one / systemOne / SystemOne and list_models / listModels / ListModels. Native probabilities remain unchanged. Score returns a fractional zero-based rubric position: convert scales explicitly in application code. Entries may be text, structured JSON objects/arrays, or null. Choice allows 1–255 labels; Score requires 2–10 rubric levels. The service context limit covers state, questions, and criteria; Ax never truncates or pretends to count native tokens exactly.

Choice and Score probabilities must be finite values in [0,1], match the criteria keys, and sum to one within an inclusive 0.01 tolerance. Totals of 0.99 and 1.01 are accepted with an allowance for floating-point summation error. Ax preserves the returned probabilities without renormalizing them.

The default model is jev-latest. Use API keys or renewable credential callbacks, the shared HTTP transport, retry settings, timeout, and cancellation. Native model discovery is separate from configured Ax model aliases. Typed native answers retain question names; only TypeScript can infer literal question keys and Choice-label unions at compile time. Other languages use their native typed maps/records/enums.

Typesafe-only balancers propagate the output-schema requirement. Mixed pools retain ordinary prompts and select Typesafe only when the actual request already has a supported schema. Unsupported requests remain excluded during fallback and degradation. Typesafe has no token streaming; the provider returns one completed result through its stream interface.

Runnable signature, native criteria/scoring, and two-program hybrid examples are under src/examples/rust/generation/. See https://axllm.dev/rust/examples/generation/.

## Relevant API Surface

- Signatures: `s`, `f`, `AxSignature`
- AxGen: `ax`, `AxGen`, `run_control`, `AxRunControl`
- AxAI: `ai`, `typesafe`, `AxAITypesafeClient`, `AxCancellationToken`, `AxAIServiceAbortedError`, `get_supported_ai_models`, `AxCredentialRequest`, `AxCredentialProvider`, `AxAIClient::owned_worker_factory`, `AxChatSession`, `AxChatStream`, `OpenAICompatibleClient`, `OpenAIResponsesClient`, `GoogleGeminiClient`, `AnthropicClient`, `AxUsageContext`, `AxUsageEvent`, `AxUsageObserver`, `set_usage_observer`, `AxRuntimeHooks`, `AxRateLimitInfo`, `AxRateLimiter`, `AxTracer`, `AxMeter`, `AxGlobals`, `set_rate_limiter`, `set_tracer`, `set_meter`, `AxBalancer`, `AxBalancerAdaptiveStrategy`, `AxBalancerStatsStore`, `AxInMemoryBalancerStatsStore`, `create_balancer_route_stats`, `update_balancer_route_stats`, `sample_balancer_route_health`, `MultiServiceRouter`, `ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
