---
name: ax-event-runtime
description: Use AxEventRuntime to ingest events, explicitly wake or resume AxGen, AxAgent, and AxFlow, persist state and results, and route outputs safely.
---

# Ax Event Runtime

Use this skill when an Ax program should react to notifications, webhooks,
timers, queues, task completion, or application events.

## Mental Model

```text
source -> inbox -> route -> target -> stored run -> sink
```

Sources never call an Ax program directly. A route must explicitly choose
`observe`, `invalidate`, `wake`, or `resume`. Only the last two invoke a model.

## Minimal Pattern

```ts
const source = new AxPushEventSource('application');
const target = eventTarget('triage')
  .program(triageAgent)
  .ai(llm)
  .input((input) => input.field('incident', eventPath.data()))
  .sink({ id: 'result', write: saveResult })
  .build();

const events = eventRuntime({
  sources: [source],
  routes: [
    eventRoute('incident-created')
      .types('incident.created')
      .wake(target)
      .build(),
  ],
});

await events.start();
await source.publish({ event, identity, trust: 'authenticated' });
```

## Rules

- Supply identity from authenticated adapter state, never from event data.
- Treat events without verified identity as anonymous and untrusted.
- Map event data into signature inputs; do not synthesize a user message.
- Use `eventPath.data('field')` and other segment-safe selectors. Do not use
  dotted JSONPath strings or repurpose `s()` as a mapping language.
- Use `.project(path)` only for same-name signature projection. Explicit
  `.field()` mappings override projection; missing or invalid signature inputs
  dead-letter before model invocation.
- Use `eventInput().project(...).field(...)` when a declarative mapping should
  be callback-free and reusable, then pass that plan to `.input()`,
  `.wakeInput()`, or `.resumeInput()`.
- Callback `mapInput` is an escape hatch, not a validation bypass: its result is
  normalized to the program signature and mapper failures dead-letter before
  invocation.
- Use `.wakeInput()` and `.resumeInput()` when the two actions need different
  contracts. Neither action silently uses the other action's mapping.
- Use `observe` for progress/logs and `invalidate` for catalog changes.
- Use `resume` only with an owned continuation correlation key.
- Use `createProgram(instance)` for stateful multi-tenant Agents.
- Declare `retrySafety: 'idempotent'` only when stable delivery keys protect
  every possible side effect.
- Persist outputs before final sink delivery; redrive sink failures separately.
- Use `debounceMs` and `coalesce: 'latest'` only when replacing intermediate
  events is part of the route's declared policy.
- Observe source failures with `onSourceError`.
- The in-memory store is volatile and single-process.
- For cooperating Node processes on one local disk, use
  `AxSQLiteEventStore` from `@ax-llm/ax-tools/event/sqlite` with explicit
  retention and `coordination: 'multi-worker'`. Never recommend SQLite on a
  network filesystem.
- Close the runtime and caller-owned protocol clients explicitly.
- Fan out to several Agents with several matching routes, not a multi-target
  route. This preserves independent authorization, ordering, retries, and runs.

## Continuation Pattern

```ts
eventContext.registerContinuation({
  correlation: [{ kind: 'task', value: taskId }],
  expiresAt,
});
```

Route progress to `observe`. Route `input_required`, completed, failed, or
cancelled task events to `resume` when the owning program must run again.

## MCP Adapter

Use `ax-mcp` for client construction, transports, authentication, catalogs,
subscriptions, tasks, and MCP-specific security policy. This skill owns the
generic inbox, routing, continuation, store, and sink behavior.

Use `AxMCPEventSource({ client, resources, identity, trust })`. Identity must
come from the application's authenticated client or token mapping; a bare MCP
session is anonymous. Add `...axMCPEventRoutes({ client })` for catalog
invalidation, progress/log observation, and task resume. Resource notifications
never get an implicit wake route.

## UCP Adapter

Use `AxUCPWebhookEventSource({ client, identity })` inside an application-owned
HTTP handler, then call `source.ingest(request)`. Verification of the signer
profile, RFC 9421 signature, digest, freshness window, key rotation, and replay
key completes before enqueue. Resolve tenant/account identity from application
state after verification; do not copy identity from the business payload.

Generated Python, Java, C++, Go, and Rust packages expose the same Core-owned
single-worker event state machine plus functioning inline lifecycle dispatch,
continuations, state restoration, cancellation, persisted outputs, isolated
sink redrive, signature-aware path/input/target/route builders, and host-owned
source, sink, clock, and store boundaries. Generated targets use the host
signature plus a typed invocation callback when no common object-safe program
interface exists. Do not claim persistent multi-worker support from
`axevent.single-worker` alone.

Generated runtimes do not create worker threads. `publish()` drains work due at
`clock.now()`. Hosts use `nextDueAt()` to schedule `runDue()` for debounce,
retry, and continuation expiry; `redrive()` is due immediately. Manual clocks
make these transitions deterministic. Generated in-memory stores enforce
10,000 pending deliveries, 64 MiB queued data, 1 MiB per envelope, and a
five-second publication wait.

## Testing

Use `AxManualEventClock`, `AxInMemoryEventStore`, deterministic event IDs, and
an output-capturing sink. Assert that unmatched or observe-only events never
invoke the program, tenant scopes do not collide, outputs exist before sinks,
and uncertain side effects become `outcome_unknown`.

Persistent store implementations must pass
`runAxEventStoreConformance(createStore, { clock })`. A store must not advertise
multi-worker capability without the conformance marker checked by runtime
startup.
