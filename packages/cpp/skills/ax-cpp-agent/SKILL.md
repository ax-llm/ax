---
name: "ax-cpp-agent"
description: "Use when writing C++ code with `axllm` for agents, child delegation, tools, MCP, citations, persistent playbook learning, stage instructions, runtime state, final typed responses, and direct-respond executor skipping."
version: "25.0.1"
---
# AxAgent For C++

This skill helps an agent write C++ code with the generated Ax package `axllm`. Use the generated package API, examples, and manifests; do not import TypeScript-only APIs unless you are editing the TypeScript package.

## When To Use

- Create an RLM agent with tools, child agents, or MCP clients.
- Use clarification, discovery, recall, final, or respond envelopes.
- Require evidence citations, attach a persistent playbook, or add stage-owned actor instructions.
- Harvest run-end failures into the playbook and observe citation or playbook updates.
- Skip the executor stage for no-tool tasks with a distiller `respond` envelope (`directResponse`, on by default).
- Save and restore agent runtime state around long-running tasks.

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
auto helper = axllm::agent("question:string -> answer:string");
auto out = helper.forward(llm, { {"question", "How should I proceed?"} });
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

Each model request opens its own native session with the whole conversation and closes it when that request's response completes, as in TypeScript. A correction or a later step opens a fresh session, which applies the run's updates again. A stream sends a session's partial output as it arrives: each response streams like a plain stream, a later response starts a new version, and the completed response adds only what was not sent. A forward does not apply streaming assertions.

A provisional answer is not successful completion while started tools remain unresolved. Cancellation closes the session, reports unresolved call IDs, and retains unresolved started calls in tool traces and native agent action logs; it cannot undo an external action. Handlers may cooperate through the invocation cancellation context. Late results from noncooperative work must not change a closed run or trigger replay.

Java, C++, and Rust WebSocket adapters track activity when frames arrive. Consuming buffered events does not reactivate a completed response. When no response is active, steering is queued for the next response; an active successor can still receive native steering. Observe lifecycle timing instead of assuming native application.

All five session adapters validate completed raw arguments against the shared Core validator before invoking handlers, including local references, unions, nested schemas, additional properties, and numeric/string/array constraints. Raw schema patterns use shared flagless ECMAScript semantics, including UTF-16, lookarounds, named captures, and backreferences. Invalid arguments enter correction; step exhaustion fails the run.

Independent flow nodes use owned program and client workers. Built-in providers, routers, and balancers supply factories; custom implementations without them run the entire group serially and emit a flow_parallel_fallback trace. Rust does not require Send/Sync on the existing client trait. Rust nested flows and custom AxExecutableProgram implementations use execute_program; an optional AxOwnedProgramFactory constructs state on its worker. Workers deliver events and results to the owner, which merges each successful step's changes in plan order, so a group ends as running its steps one after another would. On group failure, cancellation preserves completed diagnostics and discards late deliveries.

Use the provider-backed Astra examples under `src/examples/cpp/generation/`, `short-agents/`, and `flows/`. All-five generated parity remains under verification in the shared-session AxIR backlog; do not infer full agent, parallel-flow, or transport parity from these examples alone.

## Where The Runtime Goes

Give the agent a code runtime on the constructor (`"runtime"`: `axllm::Core::code_runtime_ref(runtime)`, or a `{"language": ...}` config with the runtime passed per call) or on a forward call's options (`{"runtime", axllm::Core::code_runtime_ref(runtime)}`). The constructor's runtime wins; without one, a run uses the forward call's. Playbook evolve and agent optimize take a runtime in their options the same way, and run each task on it.

- A run with a runtime runs the RLM stages, as TypeScript's agent always does with its default JavaScript runtime: the distiller and the executor write code in the runtime's language and run it in the runtime.
- JavaScript actor stages are the default. Engines remain optional dependencies: forward requires an executable runtime and fails before any model request if none is supplied. Set `actorMode: 'completion'` or `actor_mode` on the constructor or a call for legacy completion-payload stages; that mode rejects a runtime.
- Calls can switch modes explicitly; runtime stage sets follow the supplied language and usage guidance. Both stage sets are kept, and each keeps the standing instruction, actor addenda and optimized components; `set_signature` rebuilds them.

## Flat Function Namespaces

- A flat function (one in the agent's `functions` outside a module) that names its own namespace is called `<namespace>.<name>`, as in TypeScript; one without a namespace is `tools.<name>` (TypeScript's is `utils.<name>`). A namespace that shadows a runtime global such as `inputs` or `final` raises TypeScript's error.
- `flatFunctionNamespace` / `flat_function_namespace` on the agent: `'own'`, the default since 25.0.0, is the above; `'tools'` calls every flat function `tools.<name>`, as the ports did before 25.0.0.
- A flat function without its own namespace uses `utils`, matching TypeScript. Explicit `'tools'` mode retains the legacy namespace.
- `clarificationShape` / `clarification_shape` defaults to `'structured'`: clarifications carry `{question, ...}`. Explicit `'raw'` retains the original payload. `inputValidation` / `input_validation` defaults to `'fail'`: missing required context fails before any request; explicit `'lenient'` retains the old behavior.
- Initialize saved state with `playbook.playbook` (a snapshot or bare playbook). `playbook.seed` is the numeric random seed; object seeds no longer load state.
- Task evaluation returns an error prediction for a thrown run in every language. Playbook evolve records keep the error without an extra error prediction, and evaluation does not trigger run-end learning.
- Host `Tool`s go under a namespace with `add_tool_module("crm", tools)`, which needs no option; `'own'` reads a function spec's `"namespace"` key.

## Streaming An Agent Run

`agent.streaming_forward(client, values, options, handler)` runs the agent, calls `handler(const AxGenDelta&)` with each delta of the responder as TypeScript's `streamingForward` yields it, on the calling thread, and returns the responder's output. Returning false stops the run without an exception; an exception the handler throws stops it and propagates.

- The distiller and the executor, or the direct-respond skip, run first without streaming, as in TypeScript. A clarification request or a stage failure raises before any delta.
- The deltas are the responder's AxGen deltas: merge each index's deltas (strings and lists append, other values replace) and start over when the version changes. A responder retry, such as a citation correction, streams a new version.
- With `citations` on, the responder's assertion checks the cited ids against the run's evidence and retries with TypeScript's correction message, in forward and streaming alike. With `surface: "hidden"` each delta leaves out the citation field, so a delta can be empty, and the citations observer gets the ids streamed in the last version that streamed any.
- As in forward, the used-memory and used-skill observers run before the responder, and the context map and the playbook learn after it.
- `parseDates` / `parse_dates` on the agent or on the forward call (the call's wins) reaches the responder, so its `date`, `datetime`, `dateRange` and `datetimeRange` output fields come back parsed as AxGen parses them, in forward outputs and streamed deltas alike. Parsing is enabled by default; set it to false to retain text.
- A run `control` hears the run at its own path (`root`) and each stage at `root/distiller`, `root/executor` and `root/responder`, in forward and streaming alike. Stopping the stream early ends the responder and the run as `aborted`. A steer queued while a stage's request is in flight makes that stage take another step, as AxGen does, and a steer without a target reaches every later stage too.
- Under a run `control` on a client that opens native chat sessions (such as `gpt-6-astra`), each stage's model request runs in its own session, and the responder streams its session's output as it arrives, as AxGen streaming does. Without sessions the responder streams through the request boundary.

## Relevant API Surface

- Agents And RLM: `axllm::agent`, `axllm::AxAgent`, `axllm::AxAgent::add_child_agent`, `axllm::AxAgent::streaming_forward`
- MCP: `axllm::AxMCPClient`, `axllm::AxMCPStreamableHTTPTransport`, `axllm::AxMCPWebSocketTransport`, `axllm::AxMCPStdioTransport`
- Runtime Profiles: `axllm::ProcessCodeRuntime`, `axllm::RuntimeCapabilities`, `axllm::RuntimeEnvelope`, `javascript-quickjs`, `python-pyodide`

## Guardrails

- Start from package examples for exact native syntax before inventing a new call shape.
- Use `provider-api` examples only when the user explicitly has provider credentials available.
- Use `no-key` examples for deterministic local checks and provider request mapping.
- Treat AxIR as the source of generated package truth: if package docs disagree with source code, update the compiler and regenerate packages.
- Do not copy repo-maintainer skills from `tools/*/skills/` into user packages.