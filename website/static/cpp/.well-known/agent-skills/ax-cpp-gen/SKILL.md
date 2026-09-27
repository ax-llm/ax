---
name: "ax-cpp-gen"
description: "Use when writing C++ code with `axllm` for AxGen programs, forward calls, indexed multi-sampling, result pickers, streaming, tools, assertions, traces, usage, and output parsing."
version: "24.0.23"
---
# AxGen Structured Generation For C++

This skill helps an agent write C++ code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Build a structured generation program from a signature.
- Attach typed tools or MCP-derived tools to a generation call.
- Generate multiple validated structured samples and select a winner with a native callback.
- Use package examples for no-key scripted clients and provider-api calls.

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
auto program = axllm::ax("question:string -> answer:string");
auto out = program.forward(llm, { {"question", "What is Ax?"} });
```

## Astra Session Work

Select `gpt-6-astra` through the ordinary OpenAI factory. The adapter chooses Responses automatically; existing model defaults are unchanged. Use low reasoning and standard processing. Portable minimal reasoning maps to low; none is rejected. EU residency does not support priority processing.

Keep applications on their generation, agent, and flow entrypoints. Declare only independent tools as background; ordinary and imported MCP tools stay blocking unless the application explicitly changes their declaration. A promise, thread, or MCP hint is not a background declaration. Set `asyncMode` to `off` for the ordinary tool loop; chat-only services retain that loop automatically.

Declared-background native agent tools retain the imported MCP schema, handler, namespace, and raw result. Discovery must expose the tool before the model can call it. Invalid arguments are corrected before handler execution; the responder waits for the incorporated result. Native calls appear in action logs and must not be repeated through actor code.
Owned child agents inherit selected MCP clients at delegation. Parent stages keep their own clients; none or an empty namespace list passes no parent clients. Explicit child context wins over inherited context. Each run refreshes protocol modules without serializing live client handles into model requests. Cancellation propagates through a delegated child into its pending MCP tool; completed child work is not replayed.
Imported MCP tools forward cancellation to context-aware transports, including built-in HTTP. Custom transports using the older send method receive cancellation checks before and after their call; noncooperative work may finish later and its result is discarded. Cancellation does not undo an external action or replay a request.
MCP host policy applies to native background calls too. Configure authorizeToolCall in Python, Go, and Java client options, or set_tool_authorizer on C++ and Rust clients before exposing their tools. The callback receives the client and call metadata; returning false denies the call before a tool request is sent. Use shared application policy state when permissions must change during a run.

Register child agents before running the parent: add_child_agent(namespace, name, child) in Python/C++, AddChildAgent in Go, addChildAgent in Java, and with_child_agent in Rust. Registered children are available automatically as namespaced actor calls, such as team.researcher({question}). Calls use discovery, validation, and invocation accounting. Child invocation remains serialized on the owning run thread and owns a separate conversation. Retained callbacks reject calls after the run closes. Controls target paths such as root/team.researcher/executor. Child results return through the parent invocation log, and parent usage includes a children section.

Attach the language-native run controller through forward options for steering, reasoning changes, cancellation, and lifecycle events. Queued and applied are different states. HTTP applies updates at a response boundary; an optional host WebSocket enables native steering. Do not manage response IDs, socket messages, or tool-result submission in application code.

A provisional answer is not successful completion while started tools remain unresolved. Cancellation closes the session, reports unresolved call IDs, and retains unresolved started calls in tool traces and native agent action logs; it cannot undo an external action. Handlers may cooperate through the invocation cancellation context. Late results from noncooperative work must not change a closed run or trigger replay.

Java, C++, and Rust WebSocket adapters track activity when frames arrive. Consuming buffered events does not reactivate a completed response. When no response is active, steering is queued for the next response; an active successor can still receive native steering. Observe lifecycle timing instead of assuming native application.

All five session adapters validate completed raw arguments against the shared Core validator before invoking handlers, including local references, unions, nested schemas, additional properties, and numeric/string/array constraints. Raw schema patterns use shared flagless ECMAScript semantics, including UTF-16, lookarounds, named captures, and backreferences. Invalid arguments enter correction; step exhaustion fails the run.

Independent flow nodes use owned program and client workers. Built-in providers, routers, and balancers supply factories; custom implementations without them run the entire group serially and emit a flow_parallel_fallback trace. Rust does not require Send/Sync on the existing client trait. Rust nested flows and custom AxExecutableProgram implementations use execute_program; an optional AxOwnedProgramFactory constructs state on its worker. Workers deliver events and results to the owner, which merges successful results in plan order. On group failure, cancellation preserves completed diagnostics and discards late deliveries.

Use the provider-backed Astra examples under `src/examples/cpp/generation/`, `short-agents/`, and `flows/`. All-five generated parity remains under verification in the shared-session AxIR backlog; do not infer full agent, parallel-flow, or transport parity from these examples alone.

## Provider Forward Options

AxGen merges constructor and per-call forward options before invoking the provider. Provider-facing keys such as `promptCacheKey`, `sessionId`, and `contextCache` therefore reach the chat request without being copied into program inputs. Per-call values override constructor defaults, and `modelConfig` / `model_config` merges key by key: a call's keys override the constructor's, whichever spelling each uses.

`structuredOutputMode` / `structured_output_mode` accepts `auto`, `native`, `function`, or `json_object`. Auto follows the selected profile/model ordering, with the provider-neutral singleton string/code JSON-object optimization. Explicit modes must be advertised and fail before transport otherwise. JSON-object mode retains exact-shape prompting, strict parsing, and one bounded correction retry without a synthetic `__axOutput` tool.

Beside native tools, auto keeps the rung it picks without them, for every provider and for forced calls too: Ax does not switch rungs to work around a provider's or model's JSON-mode problems. Set `structuredOutputMode` / `structured_output_mode` to `function` to have the model answer through `__axOutput` beside the tools instead.

A simple signature (no object or object-array output) selects no structured-output rung, with or without tools, as in TypeScript: the provider gets no response schema and the model answers with `field: value` lines, whatever `structuredOutputMode` says. Set `forceStructured` / `force_structured` (the TypeScript `useStructured()` equivalent) to keep the JSON contract; agent actor stages set it.

When the provider returns a thought (it does when `showThoughts` / `show_thoughts` is set), the forward output carries it under `thought`, or under the constructor's `thoughtFieldName` / `thought_field_name`, on every structured-output rung, as in TypeScript. The output thought joins each tool step's thought in order, a validation or refusal retry starts it over, and an empty thought is left out. As in TypeScript, a per-call thought field name is ignored.

`stream: true` on a forward streams the model's response and returns what a streaming consumer merges, as in TypeScript: the last version's deltas, merged. That matches a non-streaming forward except where TypeScript's streaming differs: a code field keeps its opening fence, and the thought a stop step streamed stays in the output. `streaming_forward(client, values, options, handler)` calls `handler(const AxGenDelta&)` with TypeScript's `{version, index, delta}` deltas as the model streams, on the calling thread, and returns the merged output of the picked sample: merge each index's deltas (strings and lists append, other values replace) and discard what you merged when the version changes. A validation or refusal retry starts a new version, an infrastructure retry continues the current one, and a step that replaces output an earlier step emitted (for example after a field processor's feedback) starts a new version that re-sends the thought so far. Streaming assertions and streaming field processors see the current field's text as it streams, as in TypeScript. Returning false from the handler stops the run (the provider stream closes and no further request is sent) without an exception, and `streaming_forward` returns what was merged so far; an exception the handler throws stops the run and propagates unchanged. With a run `control`, a run the handler stops either way ends with an `aborted` event rather than `failed`. An overload takes a `const AxCancellationToken*`.

Text-contract answers are parsed as TypeScript's `extractValues` parses them: `Label: value` lines, a single-field answer without a label, JavaScript `Number()` coercion, a JSON array or markdown list for list fields, fenced code and JSON blocks, and `null` for an optional field, with TypeScript's validation messages. For compatibility an answer that is exactly one JSON object whose keys are all output fields is still read as those fields; that fallback prints a deprecation warning once and is removed in the next major version, when such an answer is read as text, as in TypeScript.

`add_field_processor(field, processor, AxFieldProcessorMode::Feedback)` follows TypeScript: the `AxFieldProcessor` (`processor(value, context)`, with the output values so far in `context.values` and `context.done`) runs on the parsed field, and a non-empty result goes back to the model as a user message for another step, whose answer replaces the earlier one. `add_streaming_field_processor(field, processor)` does the same on each streamed chunk of a string or code field, and `add_streaming_assert(field, assertion, message)` checks a string or code field as it streams: `assertion(text, done)` returns null or true to pass, or a message string or false to fail, which retries the attempt with a correction. `add_field_transform(field, op)` is the permanent, port-only home of the rewrite (`uppercase`, `lowercase`, `trim`, `prefix:...`, `suffix:...`, or a callable), and `AxFieldProcessorMode::Transform` rewrites with an `AxFieldProcessor`; in `streaming_forward` a transformed field is held back and sent once, transformed. The two-argument `add_field_processor(field, op)` still rewrites the field value and prints a deprecation warning once: it becomes the feedback behavior in the next major version.

An `AxCachingFunction` (`std::function<std::optional<Value>(const std::string& key, const Value* value)>`) caches outputs as TypeScript's `cachingFunction` does: a read passes `value == nullptr` and gets the stored output back, or `std::nullopt` for a miss, and a store passes `&output` and its return is ignored. Set it on a program with `gen.set_caching_function(fn)`; for one call, make a handle with `auto cache = axllm::caching_function(fn);` and pass `{"caching_function", cache.value()}` in the `forward` or `streaming_forward` options, as a run control's `value()` is passed, keeping the handle alive for the call; or set it process-wide with `axllm::set_caching_function(fn)`. An empty function clears it. The call's function comes first, then the program's, then the process-wide one, and a run with a `control` skips the cache. As in TypeScript, a forward reads the cache before it opens the run's span or records metrics, so a hit sends no request and records neither; an error from the read propagates. A streaming forward yields a hit as one delta (version 0, index 0) and ignores an error from the read. Both store the finished output (the picked sample's, with a result picker) and ignore an error from the store. Keys are lowercase hex SHA-256 digests of the signature and the input values, media included; they differ from other languages' keys, so don't share one store across languages.

Prompts and provider request bodies write numbers as TypeScript's `JSON.stringify` does: shortest round-trip digits, `2` for a float two, exponent form below 1e-6 and from 1e21 up (`1e-7`, `1e+21`), and `null` for NaN and the infinities. Values hold numbers as doubles, so integers past 2^53 round as they do in TypeScript.

`maxSteps` / `max_steps` (default 25) caps the tool loop. Each model turn that calls tools is one step, and validation retries stay inside their step. Reaching the cap raises `Generate failed: Max steps reached: N`. A call to a stop function (`stopFunctions` / `stop_functions`) runs the tool and ends the forward, as in TypeScript: the output is empty apart from the earlier steps' thought, and the tool's result is not the output.

`maxRetries` / `max_retries` (default 3) caps both retry loops, as in TypeScript. A failed provider request is retried only for infrastructure errors: a 5xx status, a network error, a timeout, or a terminated stream. As in TypeScript, these retries wrap the validation loop: a step's infrastructure retries share one budget, and each one restarts validation with a fresh budget. Any other error, such as a 400 or 429 status, a response error, or a rejection before the request is sent, surfaces after one request. Validation failures, and assertion failures that carry a message, are retried inside the current step with a correction message, and each tool step starts with fresh budgets. As in TypeScript, an assertion that fails without a message, or that raises an error, surfaces at once without a retry; give it a message (the `message` key of a declarative assertion, or the message argument of a callable assertion where the target has one) to make its failure retryable. On the `function` rung a retry keeps the failed `__axOutput` call on the assistant turn with a `done` result and asks the model to fix its arguments, as TypeScript does. A model refusal spends the same budget: the same prompt goes out again at once, with no backoff and no correction message. `validationRetries` / `validation_retries` and `infraRetries` / `infra_retries` override the two budgets separately.

A failed forward raises `Generate failed: <reason>`, as TypeScript's message reads. Exhausted validation, assertion or refusal retries give `Generate failed: Unable to fix validation error: <last error>`, ending with `LLM Output:` and the last attempt's answer (each sample's, joined with `---`). A response the model cut off at its token limit raises `Generate failed: Max tokens reached before completion`, streamed or not, instead of returning the partial answer. Only the message text changed: the error keeps its class and category (a validation failure is still a validation error), and an aborted run raises its abort error as it is. The error it wraps is its `cause()`. TypeScript raises an `AxGenerateError`, which the ports raise from the next major version.

`strictMode` / `strict_mode`, set on the constructor or the forward (the forward's wins), requires the answer to open with its first required field's label, as in TypeScript: an unlabeled answer, or one JSON object, is retried with a correction instead of being read as a single-field answer.

`functionCall` / `function_call` sets the tool choice: `auto`, `none`, `required`, or `{ type: 'function', function: { name } }` to force one function. A forced call (`required` or named) applies to the first step only, as in TypeScript: later steps drop it together with the tools so the model can answer. Under the `function` structured-output rung the forced step withholds `__axOutput`, so the forcing reaches a user tool, and the next step forces `__axOutput`. A tool choice passed as `functionCallMode` is routed the same way.

## Multi-Sampling

- Set `sampleCount` / `sample_count` to request N provider candidates. Core parses and validates every candidate, preserving each provider result index.
- Without a result picker, AxGen returns candidate 0. A result picker receives all `{ index, sample }` structured candidates and returns the winning list index; Core rejects an index outside `0..N-1`.
- Native callback surface: `set_sample_count` / `set_result_picker`.
- OpenAI-compatible Chat and Gemini map multi-sampling to `n` and `candidateCount`. Anthropic rejects `n > 1` explicitly.

## Relevant API Surface

- AxGen: `axllm::ax`, `axllm::AxGen`, `axllm::run_control`, `axllm::AxRunControl`, `axllm::AxCachingFunction`, `axllm::set_caching_function`
- Tools: `axllm::Tool`, `axllm::Tool`
- MCP: `axllm::AxMCPClient`, `axllm::AxMCPStreamableHTTPTransport`, `axllm::AxMCPWebSocketTransport`, `axllm::AxMCPStdioTransport`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
