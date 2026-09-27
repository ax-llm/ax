---
name: "ax-go-gen"
description: "Use when writing Go code with `github.com/ax-llm/ax/packages/go` for AxGen programs, forward calls, indexed multi-sampling, result pickers, streaming, tools, assertions, traces, usage, and output parsing."
version: "24.0.23"
---
# AxGen Structured Generation For Go

This skill helps an agent write Go code with the generated Ax package `github.com/ax-llm/ax/packages/go`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Build a structured generation program from a signature.
- Attach typed tools or MCP-derived tools to a generation call.
- Generate multiple validated structured samples and select a winner with a native callback.
- Use package examples for no-key scripted clients and provider-api calls.

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
program := ax.NewAx("question:string -> answer:string", nil)
out := program.Forward(llm, map[string]ax.Value{"question": "What is Ax?"}, nil)
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

As in TypeScript, an update queued while a request is in flight applies when the next step starts. If that request gave the final answer, the run takes one more step to apply it, and the answer comes from that step; a steer stays in the conversation for the steps after it.

A provisional answer is not successful completion while started tools remain unresolved. Cancellation closes the session, reports unresolved call IDs, and retains unresolved started calls in tool traces and native agent action logs; it cannot undo an external action. Handlers may cooperate through the invocation cancellation context. Late results from noncooperative work must not change a closed run or trigger replay.

Java, C++, and Rust WebSocket adapters track activity when frames arrive. Consuming buffered events does not reactivate a completed response. When no response is active, steering is queued for the next response; an active successor can still receive native steering. Observe lifecycle timing instead of assuming native application.

All five session adapters validate completed raw arguments against the shared Core validator before invoking handlers, including local references, unions, nested schemas, additional properties, and numeric/string/array constraints. Raw schema patterns use shared flagless ECMAScript semantics, including UTF-16, lookarounds, named captures, and backreferences. Invalid arguments enter correction; step exhaustion fails the run.

Independent flow nodes use owned program and client workers. Built-in providers, routers, and balancers supply factories; custom implementations without them run the entire group serially and emit a flow_parallel_fallback trace. Rust does not require Send/Sync on the existing client trait. Rust nested flows and custom AxExecutableProgram implementations use execute_program; an optional AxOwnedProgramFactory constructs state on its worker. Workers deliver events and results to the owner, which merges each successful step's changes in plan order, so a group ends as running its steps one after another would. On group failure, cancellation preserves completed diagnostics and discards late deliveries.

Use the provider-backed Astra examples under `src/examples/go/generation/`, `short-agents/`, and `flows/`. All-five generated parity remains under verification in the shared-session AxIR backlog; do not infer full agent, parallel-flow, or transport parity from these examples alone.

## Provider Forward Options

AxGen merges constructor and per-call forward options before invoking the provider. Provider-facing keys such as `promptCacheKey`, `sessionId`, and `contextCache` therefore reach the chat request without being copied into program inputs. Per-call values override constructor defaults, and `modelConfig` / `model_config` merges key by key: a call's keys override the constructor's, whichever spelling each uses.

`structuredOutputMode` / `structured_output_mode` accepts `auto`, `native`, `function`, or `json_object`. Auto follows the selected profile/model ordering, with the provider-neutral singleton string/code JSON-object optimization. Explicit modes must be advertised and fail before transport otherwise. JSON-object mode retains exact-shape prompting, strict parsing, and one bounded correction retry without a synthetic `__axOutput` tool.

Beside native tools, auto keeps the rung it picks without them, for every provider and for forced calls too: Ax does not switch rungs to work around a provider's or model's JSON-mode problems. Set `structuredOutputMode` / `structured_output_mode` to `function` to have the model answer through `__axOutput` beside the tools instead.

A simple signature (no object or object-array output) selects no structured-output rung, with or without tools, as in TypeScript: the provider gets no response schema and the model answers with `field: value` lines, whatever `structuredOutputMode` says. Set `forceStructured` / `force_structured` (the TypeScript `useStructured()` equivalent) to keep the JSON contract; agent actor stages set it.

When the provider returns a thought (it does when `showThoughts` / `show_thoughts` is set), the forward output carries it under `thought`, or under the constructor's `thoughtFieldName` / `thought_field_name`, on every structured-output rung, as in TypeScript. The output thought joins each tool step's thought in order, a validation or refusal retry starts it over, and an empty thought is left out. As in TypeScript, a per-call thought field name is ignored.

`stream: true` on a forward streams the model's response and returns what a streaming consumer merges, as in TypeScript: the last version's deltas, merged. That matches a non-streaming forward except where TypeScript's streaming differs: a code field keeps its opening fence, and the thought a stop step streamed stays in the output. `StreamingForward(ctx, client, values, options)` returns an `iter.Seq2[AxGenDelta, error]` of TypeScript's `{Version, Index, Delta}` deltas as the model streams: merge each index's deltas (strings and lists append, other values replace) and discard what you merged when the version changes. A validation or refusal retry starts a new version, an infrastructure retry continues the current one, and a step that replaces output an earlier step emitted (for example after a field processor's feedback) starts a new version that re-sends the thought so far. Streaming assertions and streaming field processors see the current field's text as it streams, as in TypeScript. Stopping the iteration cancels the run; with a run `control` the run then ends with an `aborted` event rather than `failed`.

Text-contract answers are parsed as TypeScript's `extractValues` parses them: `Label: value` lines, a single-field answer without a label, JavaScript `Number()` coercion, a JSON array or markdown list for list fields, fenced code and JSON blocks, and `null` for an optional field, with TypeScript's validation messages. For compatibility an answer that is exactly one JSON object whose keys are all output fields is still read as those fields; that fallback logs a deprecation warning once and is removed in the next major version, when such an answer is read as text, as in TypeScript.

`AddFieldProcessor(field, processor)` follows TypeScript: the `AxFieldProcessor` runs on the parsed field, and a non-empty result goes back to the model as a user message for another step, whose answer replaces the earlier one. `AddStreamingFieldProcessor` does the same on each streamed chunk of a string or code field. `AddFieldTransform` (or the `FieldProcessors` field) rewrites a field's value instead, a port extension; in `StreamingForward` a transformed field is held back and sent once, transformed. As in TypeScript, the feedback message's content is one text part (`[{type: "text", text}]`), and a streaming field processor's feedback waits for the end of the step: it follows the full answer and comes before the final processors' feedback. A streamed delta never ends in half of a surrogate pair.

An `AxCachingFunction` (`func(key string, value map[string]Value) (map[string]Value, error)`), passed as the `cachingFunction` (or `caching_function`) option of `NewAx` or of a forward call, caches outputs as TypeScript's `cachingFunction` does: a read passes a nil `value` and gets the stored output back, or a nil map for a miss (an empty map that is not nil is a hit with an empty output), and a store passes the output. `SetCachingFunction(fn)` sets a process-wide function, and `nil` clears it. It may be called from several goroutines at once. The call's function comes first, then the program's, then the process-wide one, and a run with a `control` skips the cache. As in TypeScript, a forward reads the cache before it opens the run's span or records metrics, so a hit sends no request and records neither; an error from the read propagates. A streaming forward yields a hit as one delta (version 0, index 0) and ignores an error from the read. Both store the finished output (the picked sample's, with a result picker) and ignore an error from the store. Keys are lowercase hex SHA-256 digests of the signature and the input values, media included; they differ from other languages' keys, so don't share one store across languages.

`renderAudio` (or `render_audio`), a constructor or forward option (the forward's wins), renders `audio` output fields as TypeScript does: each audio output that holds text goes through the client's speak(), and the field becomes the speak() result, with the text as its `transcript` unless speak() gave one. The speak request is the forward options' `speech.speak` defaults, then `speech.fields.<field>`, then the text. It renders where TypeScript does: a forward's answer (streamed or not; with a result picker, only the picked sample), a cache hit, and a streaming forward's result when a result picker picks it, which then goes out as its one delta. Deltas that stream without a result picker stay text. The trace and the cache hold the rendered output, a rendered artifact passes through a cache hit untouched, and an error from speak() surfaces as it is, without a retry. Without the option an audio output keeps the model's text, as before, and the first such output logs a deprecation warning once per process; `false` keeps the text without the warning. Rendering becomes the default in the next major version.

Prompts and provider request bodies write numbers as TypeScript's `JSON.stringify` does: shortest round-trip digits, `2` for a float two, exponent form below 1e-6 and from 1e21 up (`1e-7`, `1e+21`), and `null` for NaN and the infinities. `int` and `int64` values keep their exact digits past 2^53, where TypeScript's doubles round them; JSON text parses to `float64`, which rounds as TypeScript does.

`maxSteps` / `max_steps` (default 25) caps the tool loop. Each model turn that calls tools is one step, and validation retries stay inside their step. Reaching the cap raises `Generate failed: Max steps reached: N`. A call to a stop function (`stopFunctions` / `stop_functions`) runs the tool and ends the forward, as in TypeScript: the output is empty apart from the earlier steps' thought, and the tool's result is not the output.

`maxRetries` / `max_retries` (default 3) caps both retry loops, as in TypeScript. A failed provider request is retried only for infrastructure errors: a 5xx status, a network error, a timeout, or a terminated stream. As in TypeScript, these retries wrap the validation loop: a step's infrastructure retries share one budget, and each one restarts validation with a fresh budget. Any other error, such as a 400 or 429 status, a response error, or a rejection before the request is sent, surfaces after one request. Validation failures, and assertion failures that carry a message, are retried inside the current step with a correction message, and each tool step starts with fresh budgets. As in TypeScript, an assertion that fails without a message, or that raises an error, surfaces at once without a retry; give it a message (the `message` key of a declarative assertion, or the message argument of a callable assertion where the target has one) to make its failure retryable. On the `function` rung a retry keeps the failed `__axOutput` call on the assistant turn with a `done` result and asks the model to fix its arguments, as TypeScript does. A model refusal spends the same budget: the same prompt goes out again at once, with no backoff and no correction message. `validationRetries` / `validation_retries` and `infraRetries` / `infra_retries` override the two budgets separately.

A failed forward raises `Generate failed: <reason>`, as TypeScript's message reads. Exhausted validation, assertion or refusal retries give `Generate failed: Unable to fix validation error: <last error>`, ending with `LLM Output:` and the last attempt's answer (each sample's, joined with `---`). A response the model cut off at its token limit raises `Generate failed: Max tokens reached before completion`, streamed or not, instead of returning the partial answer. Only the message text changed: the error keeps its class and category (a validation failure is still a validation error), and an aborted run raises its abort error as it is. The error it wraps is what `errors.Unwrap` returns, so `errors.Is` and `errors.As` reach it; an error the runtime caught and raised again comes back rebuilt with the same category, type and message. TypeScript raises an `AxGenerateError`, which the ports raise from the next major version.

`includeOptionalInputFieldsInSystemPrompt` / `include_optional_input_fields_in_system_prompt` (off by default), set on the constructor or the forward (the forward's wins), lists every input field in the system prompt, provided or not, as in TypeScript; the user message still leaves out an unset optional field. The agent's actor stages turn it on, as TypeScript's do.

`strictMode` / `strict_mode`, set on the constructor or the forward (the forward's wins), requires the answer to open with its first required field's label, as in TypeScript: an unlabeled answer, or one JSON object, is retried with a correction instead of being read as a single-field answer.

`parseDates` / `parse_dates`, set on the constructor or the forward (the forward's wins), parses `date`, `datetime`, `dateRange` and `datetimeRange` output fields as TypeScript does in the text contract: `YYYY-MM-DD`; ISO 8601 with `Z` or an offset; or `YYYY-MM-DD HH:mm Zone` with an offset, `UTC`/`GMT`, an IANA zone name (matched without regard to case, with TypeScript's handling of DST gaps, which are an error, and overlaps, which take the earlier instant), or an abbreviation at its literal offset (`PST` is -08:00 all year; ambiguous ones such as `BST`, `IST` and `CST` are rejected; `PST`/`PDT` and `CDT` follow US usage, so for Philippine time (`PST`) or Cuban daylight time (`CDT`) give an IANA name (`Asia/Manila`, `America/Havana`) or a UTC offset); and ranges as `{"start", "end"}` JSON, a two-item array, `start/end`, or `start to end`. A value comes back as TypeScript's JSON of its `Date`: a `toISOString()` string such as `2024-05-09T18:30:00.000Z`, and `{"start", "end"}` of those for a range, in forward outputs and in streamed deltas. An unparseable value is a validation error that is retried with TypeScript's correction; an optional field's bad value is left out. Structured JSON answers keep the model's strings, as in TypeScript. Without the option date fields keep the model's text as before: that is the default until the next major version, which parses by default, and `parseDates: false` keeps today's behavior after that. Named zones resolve through `time.LoadLocation` (the platform tz database, `$ZONEINFO`, or `time/tzdata` when your program imports it, which Windows builds without Go installed need). A date or datetime input also takes a `time.Time`, rendered as TypeScript renders a `Date`: the UTC day for a date field and ISO 8601 without milliseconds for a datetime; a range input takes a `{"start", "end"}` map, of `time.Time` values or of strings.

`functionCall` / `function_call` sets the tool choice: `auto`, `none`, `required`, or `{ type: 'function', function: { name } }` to force one function. A forced call (`required` or named) applies to the first step only, as in TypeScript: later steps drop it together with the tools so the model can answer. Under the `function` structured-output rung the forced step withholds `__axOutput`, so the forcing reaches a user tool, and the next step forces `__axOutput`. A tool choice passed as `functionCallMode` is routed the same way.

## Multi-Sampling

- Set `sampleCount` / `sample_count` to request N provider candidates. Core parses and validates every candidate, preserving each provider result index.
- Without a result picker, AxGen returns candidate 0. A result picker receives all `{ index, sample }` structured candidates and returns the winning list index; Core rejects an index outside `0..N-1`.
- Native callback surface: `SetSampleCount` / `SetResultPicker` with `AxResultPickerSample`.
- OpenAI-compatible Chat and Gemini map multi-sampling to `n` and `candidateCount`. Anthropic rejects `n > 1` explicitly. Gemini 3 on the Gemini API returns one candidate, so `n > 1` is dropped with a one-time warning and AxGen gets one sample.

## Relevant API Surface

- AxGen: `axllm.NewAx`, `axllm.AxGen`, `axllm.RunControl`, `axllm.AxRunControl`, `axllm.AxCachingFunction`, `axllm.SetCachingFunction`
- Tools: `axllm.Fn`, `axllm.Tool`
- MCP: `axllm.AxMCPClient`, `axllm.AxMCPStreamableHTTPTransport`, `axllm.AxMCPWebSocketTransport`, `axllm.AxMCPStdioTransport`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.
