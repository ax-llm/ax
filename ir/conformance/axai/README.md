# AxAI Conformance Fixtures

These fixtures define the Python AxAI beta slice. They are backend-neutral at
the Ax service boundary and use fake OpenAI-compatible transport responses to
avoid network calls.

Reference areas:

- `src/ax/ai/types.ts` for normalized chat, embed, usage, model config, options,
  features, and service interfaces.
- `src/ax/ai/base.ts` for service-level model/config merging, request
  validation, metrics, and sync call behavior.
- `src/ax/ai/openai/api.ts` for OpenAI-compatible request mapping, response
  mapping, streaming delta mapping, embeddings, finish reasons, tool calls, and
  usage normalization.
- `src/ax/util/apicall.ts` for error classes and HTTP status normalization.
