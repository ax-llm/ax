# AxFlow Dialect

`ax.flow` models AxFlow as an Ax program graph. It is not a generic workflow
engine: every executable node is an Ax program boundary or a deterministic host
callback, and the flow itself exposes the same program surfaces as AxGen and
AxAgent where useful.

The alpha contract covers graph construction, duplicate step checks, planning
metadata, cache-key generation from the actual input object, child-program
forward calls, trace/chat-log aggregation, and `.returns()` projection.

## Owned worker dispatch

Core plans dependency groups and calls `intrinsic.flow.dispatch_group` for an
independent group. The host returns ordered worker reports or null when safe
owned workers are unavailable. Null selects the existing serial loop and records
`flow_parallel_fallback` with reason `owned-worker-unavailable`.

Each worker owns its client, executable program, conversation, pending calls,
control path, and cancellation scope. Workers send lifecycle events and completed
reports to the owning dispatcher. Only that dispatcher installs completed
programs into the flow; Core merges results, histories, traces, and usage in plan
order. A failure retains successful state in `completed_state`, cancels active
siblings, and identifies unresolved nodes and calls. Late deliveries cannot
change the finished flow. Neither failures nor disconnections replay work.

Built-in provider factories preserve authentication, endpoint, model settings,
transport factories, and hooks. Router factories preserve aliases; adaptive
balancer workers share the configured statistics store. Custom clients and
programs may opt in with their language's owned-worker factory. Without that
capability, the entire group executes serially. Rust transfers factory closures
and owned JSON values, never borrowed clients or `Rc` Core state; the existing
client trait gains no Send/Sync requirement.

Controllers propagate to active and future matching descendants. Worker
lifecycle events return through the dispatcher, so application callbacks can
safely enqueue more controls. Controlled runs bypass result caching while
retaining provider prompt caching. Completed nodes are not rerun by an update.

Coordinated native barrier tests require both requests to arrive before either
is released. Separate failure tests preserve a completed sibling and return
before a deliberately noncooperative worker is released. These tests live in
each target's session suite; `ir/axcore/session.md` tracks wider acceptance.

Rust custom executable programs implement `AxExecutableProgram` and join a flow
through `execute_program`; nested `AxFlow` values use the same method. The
optional factory returns a `Send` closure that constructs the program on its
worker. The program itself and the existing client trait require no `Send` or
`Sync` bound. Without a factory, the whole dependency group follows the traced
serial fallback. Existing `execute` calls with `AxGen` remain compatible.
