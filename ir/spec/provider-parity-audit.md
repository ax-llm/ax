# AxIR Provider Parity Audit

This audit covers the AxAI provider surface after descriptor-backed OpenAI
Compatible, OpenAI Responses, Google Gemini, Anthropic, Azure OpenAI, DeepSeek,
Mistral, Reka, Cohere, and Grok support. It is
intentionally scoped to AxIR semantics: request/response mapping, stream
folding, usage normalization, descriptor identity, and generated conformance.
Live transport, auth loading, retries, SSE/WebSocket clients, binary upload,
and network execution remain target-owned boundaries.

## Status

| Area | Status | Notes |
| --- | --- | --- |
| OpenAI-compatible chat/embed/stream/errors | complete | Core helpers own mapping and generated targets call them through thin clients. |
| OpenAI Responses/audio/realtime normalization | descriptor-covered | Requests, stream folding, usage, audio request shaping, and fake realtime event normalization are fixture-backed; live multipart/WebSocket transport remains host-owned. |
| Google Gemini Developer API | descriptor-covered | Chat, stream, media parts, tool/schema mapping, usage, and embeddings are fixture-backed. Vertex routing, Live API, and explicit context-cache resources are deferred. |
| Anthropic Developer API | descriptor-covered | System handling, cache-control placement, tool-use, thinking, citations, stream events, and usage/cache tokens are fixture-backed. Vertex Anthropic and live web-search transport are deferred. |
| OpenAI-compatible catalog clients | descriptor-covered | Azure OpenAI, DeepSeek, Mistral, Reka, Cohere, and Grok route through shared OpenAI-compatible helpers with provider-specific descriptor quirks for base URLs, auth/versioning, model defaults, thinking/search fields, unsupported options, stream/usage normalization, and generated thin clients. |
| Provider identity and aliases | complete | `provider_normalize_profile` and `provider_profile_registry` centralize supported aliases and generated client mapping. |
| TS model catalog | complete | `model-catalog-audit` captures provider count, provider names, filter semantics, sorting semantics, capabilities, and cloning behavior from `src/ax/ai/catalog.ts`; generated targets expose the runtime catalog API from Core data. |
| Extra TS catalog providers | deferred feature | Hugging Face remains catalog-audited but not a generated client because its current TS surface is not an OpenAI-compatible descriptor fit. |
| `AxProviderRouter` | descriptor-covered | Core owns request requirement analysis, provider scoring/selection metadata, degradation warnings, validation result shape, and routing stats. Host processing callbacks and live provider calls remain target-owned. |
| `AxMultiServiceRouter` | complete | Generated Python, Java, and C++ route chat/embed/transcribe/speak by model key, validate duplicate/missing keys, propagate options/metrics/logger/cost calls, and preserve last-used service state. |
| `AxBalancer` | complete | Generated Python, Java, and C++ expose balancer services with TS-derived model-list validation, metric/input-order selection, capability filtering, retryable-error failover, aggregate features/metrics, options, and last-used state. Timer-backed live backoff remains target-owned. |

## Classification

- `complete`: Provider descriptor identity, OpenAI-compatible mapping, generated target dispatch for currently supported provider profiles, model catalog runtime APIs, and multi-service model-key routing.
- `descriptor-covered`: OpenAI Responses, Gemini, Anthropic, Azure OpenAI, DeepSeek, Mistral, Reka, Cohere, and Grok wire-shape semantics that are Core-owned and conformance-tested with fake transports.
- `intentional host boundary`: HTTP/SSE/WebSocket/multipart transports, auth loading, live network execution, binary upload, retries, and provider-side realtime sessions.
- `deferred feature`: Hugging Face client generation, timer-backed live backoff/product retry policy, Vertex routes, Gemini Live, Grok deeper realtime/audio production parity, and Anthropic Vertex/web-search transport.
- `missing fixture`: None for the current descriptor-backed provider profiles after the catalog audit fixture.
- `compiler/runtime bug`: None found in this audit.

## Recommended Next Milestone

Provider work is complete enough for the current AxIR semantic portability
track. The remaining provider-side work is live transport/productization,
Hugging Face, or provider-specific audio/realtime depth. The next milestone
should be selected by product need rather than descriptor coverage pressure.
