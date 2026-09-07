# Chat session Core

`session.axir` owns run-local pending calls, response accounting, scope matching,
update acknowledgement, continuation decisions, and terminal state. Its helpers
are internal; they do not expose a raw OpenAI API to applications.

The host must validate completed tool arguments before submitting a
`tool.validated` transition. Workers return results to the owning dispatcher;
they must never mutate Core state, memory, action logs, or conversation history.
The same call ID may occur in separate node states. Within one state, duplicate
calls and response completions are ignored.

A boundary decision is one of `wait`, `submit`, `continue`, `validate`, or
`closed`. `submit` carries ready results without acknowledging them. The host
acknowledges submission only after transport acceptance. `validate` permits
final validation; it does not itself declare successful completion. Closing a
state preserves the IDs of unresolved work and ignores late tool results.

`openai_responses_session_event` in the provider Core normalizes only completed
function-call items into tool notifications. Argument deltas cannot trigger a
tool. Response completion and steering acknowledgements are deduplicated
independently, and pending steering retains required call IDs.

The shared conformance cases exercise these transitions and native emitted Core
in all five languages. Host tests also exercise high-level generation, typed
native agent tools and action logs, sequential flow isolation, scoped root
updates, native steering successors, and cancellation. The Python, Java, C++,
and Rust tests use stalled loopback HTTP responses to verify connection closure;
Go uses an HTTP server observing request cancellation. These complement the
scripted WebSocket fixtures rather than replacing them.

The TypeScript reference commit is
`b83d294b39df41d60c725e0bcaf27f142b0e1127` (the PR copy of original
`8c138f108c02d3f000d4ac9c03e078770b0c813c`). Provider-backed examples under
`src/examples/{python,go,java,cpp,rust}/` cover Astra generation, background
work through generation and agents, flows, steering/reasoning updates, and
cooperative cancellation. All five live agent and cancellation examples passed
on 2026-09-06; this is evidence for those examples, not full generated parity.

The broader work remains open under
`axir-2026-09-05-port-shared-chat-sessions-and-run-controls`. Outstanding work
includes expanded routing failure/accounting coverage, MCP native agent
invocation and child targeting, parallel flow controls, expanded
failure and retry coverage, public documentation, regenerated metadata, and
final repository verification after those changes. Do not close the
backlog or advertise complete parity based on the current focused tests.

Native transport cancellation stays in the host. Rust uses a current-thread
Tokio runtime within its owned HTTP worker to cancel reqwest futures without
replaying requests; application entrypoints and tool handlers remain synchronous.
Python owns a closable HTTP response iterator and shuts down the socket before
closing a buffered reader. Custom transports remain responsible for honoring
cancellation and preserving ownership of any work that cannot stop immediately.

Router and mixed-capability balancer tests now exercise high-level background
overlap and chat-only fallback. Rust additionally covers nested flow and agent
routing. A nested-client preprocessing bug found by these tests was fixed in
the canonical Rust template; all five development suites passed afterward.

Additional validation on 2026-09-06: noncooperative-tool cancellation tests passed
in Python, Java, C++, and Rust (Go already had coverage). The caller returns
before the handler finishes and transport requests are not replayed. Live
high-level generation and agent examples passed again in all five languages
against regenerated packages. One Python live attempt exposed a shared failure
path that raised a string; Core now creates a runtime error, with all-target
fixtures retaining provider failures, rejected requests, and output-limit reasons.

Further audit found that the existing Core parallel flow group currently executes
its independent nodes serially. Genuine concurrent node execution and isolation
therefore still require implementation; sequential node isolation tests do not
cover that requirement. The Rust MCP native-tool wrapper also needs schema and
modern invocation-path coverage before background MCP parity can be claimed.

The optional Rust `realtime` feature now supplies a native session WebSocket
adapter through `with_native_session_web_socket()`. Its loopback test and live
`generation/astra_native_steering.rs` example passed, preserving the parent and
successor IDs and closing the connection. The public runner enables that optional
feature only for examples that request it. Website/profile/backlog checks passed;
the initial full AxIR run found import-audit and transport-ownership shape expectations.
Those were corrected, and the full `npm run test:axir` release verification
subsequently passed in all five languages (log `/tmp/astra-test-axir-111.log`).
That gate covers implemented behavior and does not establish coverage of the
outstanding work listed above.

Additional live flow verification passed in all five languages against regenerated
packages (`/tmp/astra-live-flow-{python,go,java,cpp,rust}-123.log`). Earlier Go,
C++, and Rust attempts timed out while an intermediate response was still being
generated. A Go trace showed the background tool had finished but its result
could only be submitted at the next response boundary. Explicit instructions to
end the intermediate response while results were pending reduced the diagnostic
run from 88 seconds to 14 seconds; generation and flow examples now use that
wording. These failures were not account-access rejections.

High-level invalid-argument and step-exhaustion regressions passed in Python,
Go, Java, and Rust (`/tmp/astra-invalid-125.log`) and C++
(`/tmp/astra-required-cpp-127.log`). Core now falls back to the field name when a
validation title is empty. C++ sessions also validate required properties in raw
tool schemas before starting handlers; raw-schema constraints and
MCP invocation coverage still remain. A subsequent Go release verification
also passed with an explicit unsupported-temperature assertion on session
requests (`/tmp/astra-no-budget-126.log`).

The regenerated package freshness check, conformance synchronization, provider
profile checks, and website checks passed again after these fixes (logs suffixed
`130`/`131`). All five changed high-level generation examples also passed live
against the regenerated packages (`/tmp/astra-live-gen-*-132.log`), checking
background overlap, final tool-result incorporation, and controller timing.

`npm run test:examples:generated` also passed after regeneration
(`/tmp/astra-examples-131.log`), including the generated runtime examples and
MCP example compilation. The two Astra backlog entries remain open and the
AxIR changes remain uncommitted because the full requested behavior is unfinished.

The follow-up fixes add Core validation of raw JSON argument types (including
nullable unions, nested properties, array items, and integers) before C++ tool
handlers start. Invalid string arguments now take the correction continuation
without invoking the handler; the regression also checks step exhaustion.
Raw JSON Schema constraint and MCP invocation coverage remains incomplete.

Java, C++, and Rust WebSocket readers now update a separate Core transport cursor
when frames arrive. Consuming a buffered `response.created` frame cannot reactivate
a completed response. Native steering uses this cursor; the continuation history
keeps its own response ID. Deterministic host tests wait until the terminal frame
has arrived before issuing steering, and the shared
`astra-session-transport-cursor` fixture covers late parent completions and
repeated creation events without losing an active successor.

All five development verification suites passed after the host fixes
(`/tmp/astra-fix-all.log`). This does not resolve the parallel flow dispatch
requirement: native workers still need isolated program ownership and a serialized
provider dispatcher, particularly for Rust's non-Send custom clients. No unsafe
cross-thread client sharing or parallel-execution parity claim was added.

The subsequent all-five-language release verification also passed, including the
new shared cursor fixture, native transport regressions, and package consumers
(`/tmp/astra-fix-release.log`). Strict Core checks, conformance synchronization,
provider profiles, and generated-package freshness passed. The independently
rerun parallel-flow probe still reports `overlap:False`
(`/tmp/astra-fix-parallel-status.log`), so that blocker remains unresolved.
