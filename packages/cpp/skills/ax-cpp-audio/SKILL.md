---
name: "ax-cpp-audio"
description: "Use when writing C++ code with `axllm` for audio input/output, OpenAI Responses audio mapping, realtime event folding, and generated package audio examples."
version: "24.0.17"
---
# Ax Audio And Realtime For C++

This skill helps an agent write C++ code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Map speech, transcription, or realtime events through the generated provider surface.
- Use no-key examples for event folding and provider request mapping.
- Keep live provider calls behind explicit credentials and provider-api examples.

## Package Facts

- Language: C++.
- Package: `axllm`.
- Package API docs: `API.md` and `axir-api.json`.
- Capability manifest: `axir-capabilities.json`.
- Runnable examples: `examples/`.
- Real network support: yes.
- Scripted no-key transport support: yes.
- Runtime profiles: `javascript-quickjs`, `python-pyodide`.

## Core Pattern

```cpp
#include "axllm/axllm.hpp"

auto llm = axllm::ai("openai", { {"apiKey", std::getenv("OPENAI_API_KEY")} });
```

## Relevant API Surface

- AxAI: `axllm::ai`, `axllm::get_supported_ai_models`, `axllm::AxCredentialRequest`, `axllm::AxCredentialProvider`, `axllm::AxStreamHandler`, `axllm::OpenAICompatibleClient`, `axllm::OpenAIResponsesClient`, `axllm::GoogleGeminiClient`, `axllm::AnthropicClient`, `axllm::AxUsageContext`, `axllm::AxUsageEvent`, `axllm::AxUsageObserver`, `axllm::set_usage_observer`, `axllm::AxRuntimeHooks`, `axllm::AxRateLimitInfo`, `axllm::AxRateLimiter`, `axllm::AxTracer`, `axllm::AxMeter`, `axllm::AxGlobals`, `axllm::set_rate_limiter`, `axllm::set_tracer`, `axllm::set_meter`, `axllm::AxBalancer`, `axllm::AxBalancerAdaptiveStrategy`, `axllm::AxBalancerStatsStore`, `axllm::AxInMemoryBalancerStatsStore`, `axllm::create_balancer_route_stats`, `axllm::update_balancer_route_stats`, `axllm::sample_balancer_route_health`, `axllm::MultiServiceRouter`, `axllm::ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.