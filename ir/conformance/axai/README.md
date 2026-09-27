# AxAI Conformance Fixtures

These fixtures define the Python AxAI beta slice. They are backend-neutral at
the Ax service boundary and use scripted OpenAI-compatible transport responses to
avoid network calls.

Reference areas:

- `src/ax/ai/types.ts` for normalized chat, embed, usage, model config, options,
  features, and service interfaces.
- `src/ax/ai/base.ts` for service-level model/config merging, request
  validation, metrics, and sync call behavior.
- `src/ax/ai/openai/api.ts` for OpenAI-compatible request mapping, response
  mapping, streaming delta mapping, embeddings, finish reasons, tool calls, and
  usage normalization, plus `src/ax/ai/openai/effort.ts` for the TS-derived
  GPT-5.6 Chat-versus-Responses and legacy-model reasoning-effort ladders.
- `src/ax/ai/openai/responses_api.ts` and
  `src/ax/ai/openai/responses_api_base.ts` for descriptor-backed OpenAI
  Responses request/response/stream mapping, citations, function calls, and
  Responses-specific model/config defaults.
- `src/ax/ai/openai/audio.ts` and `src/ax/ai/openai/realtime.ts` for audio and
  realtime normalization fixtures. Generated targets use scripted transports for
  these operations; live multipart/WebSocket transports remain host-owned.
- `src/ax/ai/google-gemini/api.ts` and `src/ax/ai/catalog.ts` for
  descriptor-backed Gemini Developer API chat, stream, media-part, tool/schema,
  usage, embeddings, Gemini Live realtime-audio normalization, and explicit
  context-cache resources. Deterministic fixtures cover Vertex `global`, `us`,
  `eu`, regional, endpoint, model, embedding, and cache routing plus bearer-token
  authentication. Automatic ADC/access-token refresh and live networking remain
  host-owned.
- `src/ax/ai/anthropic/api.ts` for descriptor-backed Anthropic Developer API
  chat/stream mapping, system hoisting, block-level cache control, tool-use
  shapes, thinking blocks, citations, stop reasons, and usage/cache-token
  normalization. Deterministic fixtures cover Anthropic Vertex `rawPredict` and
  streaming path selection. Automatic access-token refresh, live web-search
  behavior, retries, and live networking remain host-owned.
- `src/ax/ai/openai/caching.ts`, `src/ax/ai/openai/usage.ts`, and the provider
  model catalog for GPT-5.6 explicit prompt-cache breakpoints, prompt-cache-key
  precedence, cache-read/cache-write usage normalization, and cache-aware cost
  estimation. Disabled-case fixtures protect older models, Azure, Responses,
  and requests that did not opt into caching.
- `src/ax/ai/azure-openai/api.ts`, `src/ax/ai/deepseek/api.ts`,
  `src/ax/ai/mistral/api.ts`, `src/ax/ai/reka/api.ts`,
  `src/ax/ai/cohere/api.ts`, and `src/ax/ai/x-grok/api.ts` for
  descriptor-backed OpenAI-compatible catalog clients. Fixtures cover base URLs,
  auth/versioning, model defaults, chat request/response mapping, stream/usage
  normalization, provider-specific option stripping, Grok search parameters,
  DeepSeek/Grok thinking quirks, and Grok realtime audio through the shared
  OpenAI-compatible realtime grammar.
- `src/ax/ai/catalog.ts`, `src/ax/ai/router.ts`,
  `src/ax/ai/multiservice.ts`, and `src/ax/ai/balance.ts` for provider
  catalog/routing audit fixtures. Generated AxIR targets expose
  descriptor-backed OpenAI-compatible, OpenAI Responses, Gemini, Anthropic,
  Azure OpenAI, DeepSeek, Mistral, Reka, Cohere, and Grok clients, plus router,
  multi-service, and balancer runtime parity. Removed/non-generated catalog
  providers and live transport productization remain deferred.
- `src/ax/util/apicall.ts` for error classes and HTTP status normalization.

## Provider error fixtures

The `provider-error-*` fixtures pin that a provider error never carries
credentials, and carries the request body only while
`includeRequestBodyInErrors` allows it. The extractor derives them from
TypeScript's `AxAIServiceError`, which keeps the URL and the body and never the
request headers. Core owns that view (`@ai_error_request`): the normalizer and
the request-carrying `ai.error.*` intrinsics build every error from it. These
keys drive the fixtures:

- `api_key`: the API key the fixture client is built with (default `test-key`).
- `expected_error_excludes`: strings that must appear nowhere a logger, tracer
  or JSON dump could read on the error or its causes. Every runner checks it.
- `expected_error_request`: the request the error keeps: the URL, plus the body
  (`json`, or `data` for a multipart upload) unless
  `includeRequestBodyInErrors` is false. Python (`error.request`) and Java
  (`AxAIServiceError.request`) must have exactly these keys, values
  subset-matched. Go (`AxError.URL`, `AxError.RequestBody`) and C++
  (`AxError::url`, `AxError::request_body`) compare the URL and the body, and
  a missing body must be absent. Rust errors keep no request until the next
  major, so Rust has nothing to compare.

The `ai_error_request` kind calls Core directly. `operation: "view"` gives each
case's `call` and `options` to `@ai_error_request` and compares `expected`
exactly. `operation: "normalize"` gives `status`, `body`, the raw `call`
(headers included) and `options` to `@openai_normalize_error` and checks the
error with the keys above plus `expected_error_type` and `expected_status`.

An `ai_realtime` fixture's `expected_ws_url` is Core's realtime WebSocket URL
for the fixture's provider, model, `api_key` and client options.

Every runner reads `options` the same way. `service_options` configure the
client, falling back to `options`. `options` are also the call options, passed
wherever a port's method takes call options (Rust's `embed`, `transcribe` and
`speak` take none).
