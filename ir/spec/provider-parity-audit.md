# AxIR Provider Parity Audit

This audit covers the AxAI provider surface after descriptor-backed OpenAI
Compatible, OpenAI Responses, Google Gemini, and Anthropic support. It is
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
| Provider identity and aliases | complete | `provider_normalize_profile` and `provider_profile_registry` centralize supported aliases and generated client mapping. |
| TS model catalog | missing fixture now covered | `model-catalog-audit` captures provider count, provider names, filter semantics, sorting semantics, capabilities, and cloning behavior from `src/ax/ai/catalog.ts`. |
| Extra TS catalog providers | deferred feature | Azure OpenAI, Cohere, DeepSeek, Mistral, Hugging Face, Reka, and Grok are catalog-audited but not generated clients. |
| `AxProviderRouter` | deferred feature | TS performs request requirement analysis, provider selection, and media degradation via host processing callbacks. AxIR has no portable routing runtime yet. |
| `AxMultiServiceRouter` | deferred feature | TS routes by model/embed keys and validates duplicate keys. AxIR has no generated multi-service surface yet. |
| `AxBalancer` | deferred feature | TS rotates provider services using metrics and retry/backoff state. AxIR has no generated balancing surface yet. |

## Classification

- `complete`: Provider descriptor identity, OpenAI-compatible mapping, and generated target dispatch for currently supported provider profiles.
- `descriptor-covered`: OpenAI Responses, Gemini, and Anthropic wire-shape semantics that are Core-owned and conformance-tested with fake transports.
- `intentional host boundary`: HTTP/SSE/WebSocket/multipart transports, auth loading, live network execution, binary upload, retries, and provider-side realtime sessions.
- `deferred feature`: Model catalog runtime API, extra TS catalog providers, provider router, multi-service router, balancer, Vertex routes, Gemini Live, and Anthropic Vertex/web-search transport.
- `missing fixture`: None for the current descriptor-backed provider profiles after the catalog audit fixture.
- `compiler/runtime bug`: None found in this audit.

## Recommended Next Milestone

**AxAI Model Catalog and Provider Routing Runtime Parity** should be the next
provider milestone only if AxIR returns to AxAI work. It should add a small
generated model-catalog API for the current TS catalog semantics, then port the
minimum portable parts of multi-service routing: model-key dispatch, duplicate
key validation, last-used service tracking, and host-owned provider callbacks.
It should not add live provider transports or new provider profiles first.
