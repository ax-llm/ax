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
  usage normalization.
- `src/ax/ai/openai/responses_api.ts` and
  `src/ax/ai/openai/responses_api_base.ts` for descriptor-backed OpenAI
  Responses request/response/stream mapping, citations, function calls, and
  Responses-specific model/config defaults.
- `src/ax/ai/openai/audio.ts` and `src/ax/ai/openai/realtime.ts` for audio and
  realtime normalization fixtures. Generated targets use scripted transports for
  these operations; live multipart/WebSocket transports remain host-owned.
- `src/ax/ai/google-gemini/api.ts` and `src/ax/ai/catalog.ts` for
  descriptor-backed Gemini Developer API chat, stream, media-part, tool/schema,
  usage, embeddings, and Gemini Live realtime-audio normalization fixtures.
  Vertex routing, explicit context-cache resources, auth loading, and live network
  behavior remain host-owned follow-up scope.
- `src/ax/ai/anthropic/api.ts` for descriptor-backed Anthropic Developer API
  chat/stream mapping, system hoisting, block-level cache control, tool-use
  shapes, thinking blocks, citations, stop reasons, and usage/cache-token
  normalization. Vertex Anthropic, live web-search behavior, retries, auth
  loading, and live network behavior remain host-owned follow-up scope.
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
