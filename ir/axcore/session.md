# Chat sessions and run controls

Applications use generation, agent, and flow entrypoints. Raw Responses requests
and sockets are internal adapters. Existing chat-only services and ordinary
blocking tools remain supported. Astra selects Responses automatically;
`asyncMode: off` retains the ordinary tool loop.

## Ownership and completion

`session.axir` owns pending calls, response boundaries, control ordering,
duplicate suppression, output versions, usage accounting, and continuation
choices. Each conversation has its own registry, so identical call IDs in
separate nodes do not collide. Host adapters own transport and tool workers.
Workers deliver results to the run dispatcher; they do not mutate Core state,
conversation history, memory, or action logs.

A boundary decision is `wait`, `submit`, `continue`, `validate`, or `closed`.
`submit` carries ready results without acknowledging them. The adapter records
submission only after transport acceptance. Intermediate answers remain
provisional while work is pending. `validate` permits final validation; it does
not declare success. Step exhaustion and failed validation cannot return a
successful final answer. Closing a run retains unresolved call IDs and rejects
late deliveries. Cancellation requests cooperative termination and never implies
that an external action was undone.

Completed native tool arguments pass the shared validator before a handler
starts. The validator follows the supported TypeScript contract: local JSON
Pointer references, a depth limit of 64, allOf/anyOf/oneOf, nullable type unions,
integers, type- and order-preserving enum/const comparison, nested properties and items, required and additional
properties, numeric bounds, Unicode code-point string lengths, patterns, and
array lengths. External and unresolved references are rejected. Partial argument
events cannot start a handler. Native MCP schemas retain their original
references and constraints through provider request construction and agent tool
renaming. Native actor calls use the imported MCP handler, preserving modern
request metadata and raw structured results. Discovery controls exposure; an
invalid call is corrected before the MCP handler runs. The responder sees the
incorporated result, and the action log records the qualified name and call ID.
Actor code cannot execute the same native callable again. MCP host authorization
runs through the imported handler before a tool request is sent. Its context
retains the client, namespace, tool schema, and arguments. A false decision
rejects the call; an absent decision permits it. Invalid model arguments never
reach the authorization callback. Ordinary
non-session tool invocation keeps its existing validation behavior.

Host regular-expression engines evaluate patterns; advanced expressions outside
the shared engine subset require additional compatibility evidence. The current
fixtures cover anchors, search semantics, character classes, and quantifiers.

MCP inheritance selection is shared in `mcp.axir`. It preserves selected client
order within MCP and UCP groups, rejects unknown or duplicate namespaces, and
treats both `none` and an empty allowlist as no inherited clients. Derived
contexts retain the original client handles. Agent attachment initializes the
selected catalogs and preserves ordinary tools under their existing `tools`
namespace. Child registration uses the same Core module composition rule.
Filtering or initializing a child
must not remove access to the parent's other clients. TypeScript-derived request
fixtures exercise child selection, tool results, and subsequent parent requests
in all five targets. This context-level evidence does not yet establish full
child-agent inheritance and cancellation parity.

## Routing, controls, and transport

Routing and model aliases resolve before session creation. The selected client
is pinned for that run. A disconnection does not reconnect and replay accepted
steering or started tools. HTTP streaming supports background tools without a
WebSocket dependency. Optional WebSocket adapters support native steering;
otherwise controls apply at a later response boundary and report that timing.

Child registration retains the child's program and signature schema. The shared
invocation boundary validates inputs, runs the child serially, and assigns paths
such as `root/team.researcher/executor`. Root controls reach future child stages;
child-targeted controls do not change parent stages. Each child owns its history.
The parent records the child's result in its next prompt and retains usage under
`children`, including usage incurred before a failed delegation. C++ rejects
transitive ownership cycles at registration. Exported action logs preserve call
IDs. Failures clear active client
bindings and close the parent code session. Recursive delegation into an active
agent is rejected. Registered children and tools are bound automatically into namespaced actor calls,
such as `team.researcher({ question })`, in each native JavaScript runtime.
The invocation checks discovery and validation before calling a handler. Calls
remain on the owning run thread; Java pumps host callbacks through its owning
dispatcher while QuickJS4J executes guest code separately. Runtime sessions retain
their callback snapshot. Run closure invalidates retained callbacks, including
`llmQuery`, after success or cancellation. Rust captures console output in runtime
feedback and clears it between actor turns.

Queued updates and applied updates are distinct. Root updates propagate to
matching descendant paths. Reasoning configuration updates retain conversation
order and the original cache prefix. The provider event adapter suppresses
repeated call completions, response completions, and acknowledgements. A separate
transport cursor prevents buffered parent events from replacing an active
successor response ID.

Owned flow workers preserve per-node program state and send events and results
to a serialized dispatcher. Unsupported custom factories select a traced serial
group. Group failure retains completed-node diagnostics, cancels active siblings,
and discards late work. Balancer workers share synchronized failure counters and the adaptive statistics
store. Python provider workers also share synchronized latency/error metrics.
Closed dispatchers reject late worker deliveries. C++ MCP tool workers retain
shared invocation state after the public client handle is destroyed. Transport
callbacks use weak ownership to avoid a client/transport cycle. C++ tool
registration uses synchronized lookups and unique IDs so concurrent construction
cannot replace another worker's handler.

Rust keeps borrowed clients and non-Send Core values on their owning thread.
Python, Java, C++, Go, and Rust cancellation tests cover stalled HTTP responses
and noncooperative tools. A noncooperative handler can finish after cancellation;
its eventual delivery is discarded by a closed run. Started calls still running at
closure receive an `unresolved` tool trace, which native agent invocation records
in the action log. No fabricated tool result is added to conversation memory.

## Evidence and remaining acceptance

The TypeScript source is `8c138f108c02d3f000d4ac9c03e078770b0c813c`
(the prior PR copy is `b83d294b39df41d60c725e0bcaf27f142b0e1127`).
Behavioral fixtures live in `ir/conformance/axai/` and `ir/conformance/axmcp/`.
Scripted agent fixtures belong under package tests, not public examples.

| Behavior | Shared evidence | Native evidence |
| --- | --- | --- |
| Raw schema validation | `session-raw-argument-validation.json`, evaluated against TypeScript | Invalid calls, correction requests, unchanged call IDs, and step exhaustion in all five session suites |
| MCP inheritance and attachment | `execution-context-inheritance.json`, `execution-context-inheritance-requests.json`, and `execution-context-agent-attachment.json` | Selected namespace order, invalid selections, exact MCP requests through agent invocation, retained ordinary tools, and subsequent parent requests in all five targets |
| Ordinary tools with owned children | `owned-child-delegation-preserves-existing-tools.json` | Existing tool invocation, child invocation, both action-log records, and final output across all five targets |
| Native MCP schemas and modern continuation | `native-tools-modern-roundtrip.json` | All-five native agent tests assert discovery boundaries, exact schemas, invalid-argument correction, overlap, raw result continuation, responder output, action logs, and duplicate prevention |
| Owned child delegation | `owned-child-delegation-through-parent-runtime.json` | All-five native session tests assert parent continuation input, isolated histories, scoped controls, cache prefixes, child usage, and cancellation cleanup |
| Real actor child calls | `axagent-real/agent-runtime-real-owned-child-delegation.json` | All five real engines execute parent and child actor code; assert child result, action log, and parent continuation. Native suites reject retained callbacks after success and cancellation. The five public `astra_child_agent` / `AstraChildAgentExample` examples passed with live Astra, including child-scoped controls |
| MCP host authorization | `native-tool-host-authorization.json`, extracted by calling the TypeScript MCP client | All-five native agent tests exercise denied and allowed calls, retained context, no transport call after denial, and no authorization after invalid arguments or actor replay |
| Completed calls and pending work | `astra-session-completed-calls-and-response-boundaries.json`, `astra-pending-results-out-of-order.json` | Delayed tools, blocking barriers, partial arguments, and provisional answers |
| Steering and reasoning history | `astra-native-steering-successor-no-replay.json`, `astra-native-late-pending-input.json`, `astra-session-transport-cursor.json` | Scripted sockets and delayed HTTP cleanup |
| Scope and cancellation | `astra-scoped-updates-and-cancellation.json` | Root/future-node controls, per-node histories, noncooperative handlers, and aborts; all-five native agent tests assert stage-specific steering and reasoning continuations |
| Concurrent flow groups | `flow.axir` dispatch and deterministic merge contract; `owned-workers-custom-client-serial-fallback.json` | All-five coordinated overlap and failure tests; Go and C++ race detection; Rust nested/custom non-Send programs; live parallel examples |
| Complete agent invocation and targeting | **Outstanding** | Child targeting, cancellation context through delegated programs, and serialized runtime state need expanded acceptance coverage |

Native session suites:

- Python: `packages/python/tests/astra_session_test.py`
- Go: `packages/go/session_test.go`
- Java: `packages/java/tests/AstraSessionTest.java`
- C++: `packages/cpp/tests/astra_session_test.cpp`
- Rust: tests in `packages/rust/src/session.rs`

Public provider-backed examples are under each language's `generation`,
`short-agents`, and `flows` directories in `src/examples/`. Earlier live example
runs establish only their exercised behavior. The second delivery must rerun
all five languages with the completed concurrency and control implementation.

Both Astra backlog entries remain open. Closure requires actual coordinated
parallel overlap, owned-worker compatibility/fallback, complete agent and scoped
control behavior, live evidence, and all repository acceptance gates. Passing
the existing release suite does not establish those outstanding behaviors.
