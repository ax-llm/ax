---
name: "ax-go-ai"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for named deployment profiles, generic provider clients, model selection, OpenAI-compatible calls, Responses, Gemini, Anthropic, routers, and balancers."
version: "24.0.24"
---
# AxAI Providers For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Create provider clients or normalize provider options.
- Choose a named deployment profile separately from the model ID served by that deployment.
- Attach renewable per-request credentials for expiring cloud tokens.
- Resolve structured-output modes from the selected profile and model.
- Choose between model-list routing, ordered failover, and adaptive operational routing.
- Route multimodal requests without flattening native images or files when the selected provider supports them.
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

## Typesafe / Jev

The typesafe provider supports required boolean and class outputs. Numeric bounds never define a Score rubric; numbers, freeform strings, optional outputs, arrays, nesting, media, tools, and sampling controls are rejected before transport.

Set provider trueThreshold (or true_threshold) to a finite value in [0,1], default 0.5. Boolean conversion uses noul >= threshold; this policy is local and never sent. Choice returns the selected label without a confidence cutoff.

Use boolean(true "Core task blocked", false "Routine request") and class label descriptions for criteria. Fluent describe_values / describeValues / DescribeValues keeps the same field value type. C++ uses valueDescriptions on its existing field descriptors. Other providers receive readable prompt and schema descriptions.

The separate native client exposes system_one / systemOne / SystemOne and list_models / listModels / ListModels. Native probabilities remain unchanged. Score returns a fractional zero-based rubric position: convert scales explicitly in application code. Entries may be text, structured JSON objects/arrays, or null. Choice allows 1–255 labels; Score requires 2–10 rubric levels. The service context limit covers state, questions, and criteria; Ax never truncates or pretends to count native tokens exactly.

Choice and Score probabilities must be finite values in [0,1], match the criteria keys, and sum to one within an inclusive 0.01 tolerance. Totals of 0.99 and 1.01 are accepted with an allowance for floating-point summation error. Ax preserves the returned probabilities without renormalizing them.

The default model is jev-latest. Use API keys or renewable credential callbacks, the shared HTTP transport, retry settings, timeout, and cancellation. Native model discovery is separate from configured Ax model aliases. Typed native answers retain question names; only TypeScript can infer literal question keys and Choice-label unions at compile time. Other languages use their native typed maps/records/enums.

Typesafe-only balancers propagate the output-schema requirement. Mixed pools retain ordinary prompts and select Typesafe only when the actual request already has a supported schema. Unsupported requests remain excluded during fallback and degradation. Typesafe has no token streaming; the provider returns one completed result through its stream interface.

Runnable signature, native criteria/scoring, and two-program hybrid examples are under src/examples/go/generation/. See https://axllm.dev/go/examples/generation/.

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
- A profile without a base URL of its own (`openai-compatible`, `databricks`, `amazon-bedrock`, `vertex-ai`, ...) needs one from the caller: `ai(...)` fails with TypeScript's `<Name> requires apiURL` instead of sending the key to another host. Built directly without a base URL, the OpenAI-compatible client class talks to `https://api.openai.com/v1` with the conservative `openai-compatible` profile. For OpenAI itself use the `openai` factory, which applies OpenAI's model catalog.
- Environment credentials stay with their own provider: `OPENAI_API_KEY` and `OPENAI_BASE_URL` are read only for `openai`, `openai-responses` and `openai-compatible`; `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` only for `anthropic`; the Google key variables only for `google-gemini`. Any other provider needs an explicit API key or a credential provider.
- Sampling follows TypeScript. A client starts from its provider's defaults: temperature 0, or temperature 0.7 and top-p 1 for `openai-responses`, and none for the other Responses profiles. The client's model config, a model key's config and then the request's merge over them. The catalog marks the sampling parameters a model rejects (temperature, top-p, top-k and the presence/frequency penalties): a default for one is never sent; an explicit value is sent when the model accepts it for that request's reasoning effort (GPT-5.1-5.4 while reasoning is off, their default; GPT-5.5 and 5.6 with effort `none`) and otherwise dropped with a one-time warning naming the setting and the model. A model the catalog marks `temperatureOne` still takes an explicit temperature of 1. The o-series still get the token limit and `n`; a profile without model info uses OpenAI's for an exact o-series name.
- Anthropic: Opus 4.7 and later, Opus 5, Fable 5 and Sonnet 5 take only temperature 1 (no top-p or top-k); the other Claude models take every value with thinking off, and while thinking only temperature 1, top-p of 0.95 or above, and no top-k, and never temperature with top-p (an explicit top-p goes alone in place of the default temperature; an explicit temperature wins over it with a warning). The default temperature 0 is sent only without thinking. Gemini: the server-managed Flash models ignore temperature, top-p and top-k; the Gemini API rejects the penalties; Gemini 3 raises a temperature below 1 to 1, warning once for an explicit value. Vertex keeps its request shape for both and warns about a value it drops.
- Provider descriptors and conformance fixtures are generated from the shared profile manifest. Do not add provider-name switches or cross-profile model normalization in a generated package.

## Vertex And Prompt Caching

- Configure Gemini or Anthropic Vertex mode with `projectId` / `project_id` and `region`; optionally select a Vertex endpoint with `endpointId` / `endpoint_id`.
- Use `credentialProvider` / `credential_provider` for expiring Vertex and cloud tokens. It receives profile, operation, method, and URL on every attempt; its headers override static authentication.
- Credential callbacks cover chat, stream, embeddings, Responses, transcription, speech, and retries. Callback errors stop before transport, and completed 401/403 generation responses are not replayed automatically.
- Keep ADC and cloud SDK dependencies host-owned: obtain or refresh the token inside the callback. A required-auth profile accepts either a static key or the callback.
- Core resolves `global`, `us`, `eu`, and regional Vertex hosts. An explicit `baseUrl` / `base_url` takes precedence.
- `beta` on a call routes that Vertex call onto `v1beta1`, and `beta: false` keeps it on `v1` when the client sets `beta`, as in TypeScript.
- On Vertex, `gemini-embedding-2` embeds through `:embedContent` at the `global` location whatever `region` is set. Each call embeds exactly one text, because Vertex fuses a request's texts into one vector, and sends no task type, which Vertex ignores for this model; put task instructions in the text instead. Other embedding models and `endpointId` / `endpoint_id` deployments keep the regional `:predict` call.
- OpenAI GPT-5.6 Chat explicit caching is opt-in through `contextCache` / `context_cache` or message/function cache flags. Use `promptCacheKey` / `prompt_cache_key` for stable affinity; `sessionId` / `session_id` is the fallback.
- As in TypeScript, every OpenAI Responses request sends `prompt_cache_key`: the `promptCacheKey` / `prompt_cache_key`, else the `sessionId` / `session_id`, the call's before the client's. Chat Completions sends it only with GPT-5.6 caching.
- Normalized usage separates uncached prompt, cache-read, and cache-creation tokens. `get_model_cost` / target equivalent uses the shared model catalog, including cache-write pricing and long-context thresholds.
- Start with the OpenAI prompt-caching and Vertex Gemini examples under `examples/`. Scripted AxAI fixtures verify routing without live credentials.

## Request Timeouts

- With contextCache enabled, cached signature inputs form a stable user-message prefix; dynamic inputs follow separately. Agent stages mark stable inputs cached and keep runtime guidance and action history dynamic.
- `timeoutMs` on a chat, stream or embed call bounds the wait for the response headers in milliseconds, as TypeScript's per-call `timeout` does. In the client's options it applies to every call. A request whose response has not started in time fails with `AxAIServiceTimeoutError` (`Request timed out after <N>ms`). The request layer does not retry it, and AxGen retries it as an infrastructure error. Once the response starts, the body reads as it did before. AxGen and agent forwards pass `timeoutMs` to every model call.
- A per-call `timeout` is ignored until the next major version, which reads it in milliseconds as TypeScript does. A call that gives it without `timeoutMs` warns once, naming `timeoutMs`. Go's HTTP transport sets no timeout of its own; give `HTTPTransport` an `http.Client` with one for a client-wide bound.

## Transport Errors

- A connection that is refused, reset, or closed before a response raises `AxAIServiceNetworkError` with TypeScript's message, `Network Error: <cause>`. The client's own timeout raises `AxAIServiceTimeoutError` (`Request timed out after <N>ms`, the timeout in milliseconds). AxGen retries both as infrastructure errors.
- The HTTP client's error stays the error's cause (`errors.Unwrap`). Go has no client timeout of its own: a timeout of an `http.Client` you give `HTTPTransport` is that client's failure, so it raises `AxAIServiceNetworkError`, as a custom fetch's own timeout does in TypeScript. Set `timeoutMs` in the client's options for a client-wide `AxAIServiceTimeoutError`.

## Request Retries

- As TypeScript's apiCall does, chat, embed, context-cache and Typesafe requests, and a stream's request, go out again after a network failure or a status the retry config lists (`retryableStatusCodes`, by default 500, 408, 429, 502, 503, 504 and 529), up to `maxRetries` times (default 3).
- The wait is `initialDelayMs * backoffFactor ** attempt` (1 s doubling by default), at most `maxDelayMs` (60 s), times a jitter of 0.75 to 1.25. A status response's `Retry-After`, in seconds or as an HTTP date, replaces it when it is no longer than `maxDelayMs`.
- The call's `retry` options replace the client's. `retry: { maxRetries: 0 }` sends each request once.
- A 401 or 403, a timeout the request ran out of, and an aborted request are never retried here. A stream whose response began is not retried either: a failure to read its first event surfaces. A first event that carries a listed status (Anthropic's `overloaded_error`) goes out again, with its own budget and without jitter.

## Routing And Balancing

- Use the multi-service router when a logical model key selects a configured service or concrete model. It combines model lists; it does not learn from outcomes.
- Use `ProviderRouter` for capability-based selection and optional media degradation. When the selected provider supports images, preserve every native image part with its payload, MIME type, detail level, cache and optimization hints, alt text, and ordering with surrounding text.
- Native files retain filename, MIME type, data, cache flags, extraction metadata, and order through provider/model selection and later conversation turns. Existing extracted text is used only when the selected provider cannot consume the file.
- For unsupported files, configure a file-to-text callback or choose degradation, skip, or error policy. An empty extraction result is valid; extraction failures stop before the provider request. Python, Go, and Java accept fileToText in router processing options; C++ exposes file_to_text, and Rust exposes with_file_to_text and with_processing.
- Inline PDF inputs should include filename, mimeType, and base64 data. See the public native-file-routing generation example for this language; it uses the ordinary generator and a real provider.
- Use the default `AxBalancer` for deterministic ordered/metric failover with its existing retry policy.
- Opt into `AxBalancerAdaptiveStrategy` only for operational routing among application-approved equivalent aliases. It learns transient reliability and successful latency, combines them with estimated cost and a deadline, and explores with Thompson sampling.
- Put centralized decision state in an `AxBalancerStatsStore`. The routing-event callback is best-effort analytics and observability, not a state replication mechanism.
- Shared stores require non-empty, unique, stable route keys. Use slices to isolate workflows, tenants, or traffic classes without putting prompts, responses, raw errors, or sensitive identifiers in keys or events.
- Adaptive balancing does not measure answer quality or semantically choose a model. Only group routes that the application already accepts as substitutes.
- Generated provider streams are incremental and closeable. Retry or failover is allowed only before the first content event; later failures surface without replay, and adaptive latency is recorded at the first chunk.
- Start with `examples/adaptive_balancer_no_key` for store/reducer syntax, then use the cataloged provider-backed adaptive-balancer example for a complete two-route setup.

## Astra Session Work

Select `gpt-6-astra` through the ordinary OpenAI factory. The adapter chooses Responses automatically; existing model defaults are unchanged. Use low reasoning and standard processing. Portable minimal reasoning maps to low; none is rejected. EU residency does not support priority processing.

Keep applications on their generation, agent, and flow entrypoints. Declare only independent tools as background; ordinary and imported MCP tools stay blocking unless the application explicitly changes their declaration. A promise, thread, or MCP hint is not a background declaration. Set `asyncMode` to `off` for the ordinary tool loop; chat-only services retain that loop automatically.

Declared-background native agent tools retain the imported MCP schema, handler, namespace, and raw result. Discovery must expose the tool before the model can call it. Invalid arguments are corrected before handler execution; the responder waits for the incorporated result. Native calls appear in action logs and must not be repeated through actor code.
Owned child agents inherit selected MCP clients at delegation. Parent stages keep their own clients; none or an empty namespace list passes no parent clients. Explicit child context wins over inherited context. Each run refreshes protocol modules without serializing live client handles into model requests. Cancellation propagates through a delegated child into its pending MCP tool; completed child work is not replayed.
Imported MCP tools forward cancellation to context-aware transports, including built-in HTTP. Custom transports using the older send method receive cancellation checks before and after their call; noncooperative work may finish later and its result is discarded. Cancellation does not undo an external action or replay a request.
MCP host policy applies to native background calls too. Configure authorizeToolCall in Python, Go, and Java client options, or set_tool_authorizer on C++ and Rust clients before exposing their tools. The callback receives the client and call metadata; returning false denies the call before a tool request is sent. Use shared application policy state when permissions must change during a run.

Register child agents before running the parent: add_child_agent(namespace, name, child) in Python/C++, AddChildAgent in Go, addChildAgent in Java, and with_child_agent in Rust. Registered children are available automatically as namespaced actor calls, such as team.researcher({question}). Calls use discovery, validation, and invocation accounting. Child invocation remains serialized on the owning run thread and owns a separate conversation. Retained callbacks reject calls after the run closes. Controls target paths such as root/team.researcher/executor. Child results return through the parent invocation log, and parent usage includes a children section.

Attach the language-native run controller through forward options for steering, reasoning changes, cancellation, and lifecycle events. Queued and applied are different states. HTTP applies updates at a response boundary; an optional host WebSocket enables native steering. Do not manage response IDs, socket messages, or tool-result submission in application code.

As in TypeScript, an update queued while a request is in flight applies when the next step starts. If that request gave the final answer, the run takes one more step to apply it, and the answer comes from that step; a steer stays in the conversation for the steps after it.

Each model request opens its own native session with the whole conversation and closes it when that request's response completes, as in TypeScript. A correction or a later step opens a fresh session, which applies the run's updates again. A stream sends a session's partial output as it arrives: each response streams like a plain stream, a later response starts a new version, and the completed response adds only what was not sent. A forward does not apply streaming assertions.

A provisional answer is not successful completion while started tools remain unresolved. Cancellation closes the session, reports unresolved call IDs, and retains unresolved started calls in tool traces and native agent action logs; it cannot undo an external action. Handlers may cooperate through the invocation cancellation context. Late results from noncooperative work must not change a closed run or trigger replay.

Java, C++, and Rust WebSocket adapters track activity when frames arrive. Consuming buffered events does not reactivate a completed response. When no response is active, steering is queued for the next response; an active successor can still receive native steering. Observe lifecycle timing instead of assuming native application.

All five session adapters validate completed raw arguments against the shared Core validator before invoking handlers, including local references, unions, nested schemas, additional properties, and numeric/string/array constraints. Raw schema patterns use shared flagless ECMAScript semantics, including UTF-16, lookarounds, named captures, and backreferences. Invalid arguments enter correction; step exhaustion fails the run.

Independent flow nodes use owned program and client workers. Built-in providers, routers, and balancers supply factories; custom implementations without them run the entire group serially and emit a flow_parallel_fallback trace. Rust does not require Send/Sync on the existing client trait. Rust nested flows and custom AxExecutableProgram implementations use execute_program; an optional AxOwnedProgramFactory constructs state on its worker. Workers deliver events and results to the owner, which merges each successful step's changes in plan order, so a group ends as running its steps one after another would. On group failure, cancellation preserves completed diagnostics and discards late deliveries.

Use the provider-backed Astra examples under `src/examples/go/generation/`, `short-agents/`, and `flows/`. All-five generated parity remains under verification in the shared-session AxIR backlog; do not infer full agent, parallel-flow, or transport parity from these examples alone.

## Relevant API Surface

- AxAI: `axllm.NewAI`, `axllm.Typesafe`, `axllm.AxAITypesafeClient`, `context.Context`, `axllm.AxAIServiceAbortedError`, `axllm.GetSupportedAIModels`, `axllm.AxCredentialRequest`, `axllm.AxCredentialProvider`, `AxOwnedClientFactory.OwnedWorkerFactory`, `axllm.AxChatSession`, `axllm.AxChatStream`, `axllm.OpenAICompatibleClient`, `axllm.OpenAIResponsesClient`, `axllm.GoogleGeminiClient`, `axllm.AnthropicClient`, `axllm.AxUsageContext`, `axllm.AxUsageEvent`, `axllm.AxUsageObserver`, `axllm.SetUsageObserver`, `axllm.AxRuntimeHooks`, `axllm.AxRateLimitInfo`, `axllm.AxRateLimiter`, `axllm.AxTracer`, `axllm.AxMeter`, `axllm.AxGlobals`, `axllm.SetRateLimiter`, `axllm.SetTracer`, `axllm.SetMeter`, `axllm.AxBalancer`, `axllm.AxBalancerAdaptiveStrategy`, `axllm.AxBalancerStatsStore`, `axllm.AxInMemoryBalancerStatsStore`, `axllm.CreateBalancerRouteStats`, `axllm.UpdateBalancerRouteStats`, `axllm.SampleBalancerRouteHealth`, `axllm.MultiServiceRouter`, `axllm.ProviderRouter`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
- A provider can split a surrogate pair (an emoji, say) across stream chunks. AxGen streaming deltas and outputs join it, but a raw client `Stream` delta carries each half as its WTF-8 bytes, as TypeScript's raw deltas carry the lone surrogate. Join raw deltas with `JoinStreamText(text, delta)`: concatenating them with `+` leaves the two halves' bytes, which are not valid UTF-8, where the character belongs.
- When decorating `AIClient`, forward `GetFeatures(model) map[string]Value` whenever the wrapped client implements it. AxGen otherwise falls back to permissive capabilities, which can select an unsupported structured-output rung.
- For Vertex OpenAI-compatible MaaS, prefer `NewAI("vertex-ai", options)` with `AxCredentialProviderFunc`; do not reintroduce a request-rewriting response-format decorator.
