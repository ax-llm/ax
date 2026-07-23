---
name: "ax-rust-agent-observability"
description: "Use when writing Rust code with `axllm` for agent tracing, centralized and multi-tenant usage accounting, action logs, runtime diagnostics, replay, and production debugging."
version: "23.0.4"
---
# AxAgent Observability For Rust

This skill helps an agent write Rust code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Inspect agent traces, runtime envelopes, usage, or action logs.
- Register the process-wide usage observer and attribute model calls by tenant, user, request, run, or feature.
- Attach callbacks for model/tool activity and runtime progress.
- Debug agent loops through generated package state and examples.

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
let helper = axllm::agent("question:string -> answer:string")?;
let out = helper.forward(&llm, inputs, None)?;
```

## Centralized Usage Observer

Use the process-wide usage observer for application accounting across many agents, API routes, tenants, and users. Keep per-agent usage accessors for inspecting one agent instance after a run.

```rust
set_usage_observer(Some(Arc::new(move |event| {
    usage_queue.push(event);
})));
// Later: set_usage_observer(None);
```

- The observer receives one normalized event for each completed chat or embedding call that reports provider usage. A fully consumed stream emits once; an unconsumed or cancelled stream may not emit.
- Events include the operation, AI/provider name, model, normalized tokens, streaming flag, optional usage context, and available session or remote request IDs.
- Attach `usageContext` in AI service options for stable application or environment defaults. Attach it in call or agent-forward option maps for tenant, user, request, run, and feature attribution.
- Per-call context overrides service defaults. Nested `attributes` are shallow-merged.
- The observer is process-wide, best-effort, and fail-open. Registering again replaces the previous observer. Clear it during test teardown or shutdown when appropriate.
- The observer runs on the request path. Production callbacks should synchronously enqueue into a bounded concurrent queue and return immediately, then persist or aggregate out of band. Use a shared durable pipeline across processes or serverless instances.
- Keep identifiers opaque and attributes low-cardinality. Do not attach prompts, responses, secrets, or other sensitive payloads.
- Calculate currency cost downstream against a versioned provider/model pricing table.
- Runnable provider example: `src/examples/rust/generation/usage_observer.rs`.

## Relevant API Surface

- AxAI: `ai`, `OpenAICompatibleClient`, `OpenAIResponsesClient`, `GoogleGeminiClient`, `AnthropicClient`, `AxUsageContext`, `AxUsageEvent`, `AxUsageObserver`, `set_usage_observer`, `AxBalancer`, `AxBalancerAdaptiveStrategy`, `AxBalancerStatsStore`, `AxInMemoryBalancerStatsStore`, `create_balancer_route_stats`, `update_balancer_route_stats`, `sample_balancer_route_health`, `MultiServiceRouter`, `ProviderRouter`
- Agents And RLM: `agent`, `AxAgent`
- Runtime Profiles: `ProcessCodeRuntime`, `RuntimeCapabilities`, `RuntimeEnvelope`, `javascript-quickjs`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.