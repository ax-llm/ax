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
const target = eventTarget({
  id: 'triage',
  ai: llm,
  program: triageAgent,
  mapInput: ({ event }) => ({ incident: event.data }),
  sinks: [{ id: 'result', write: saveResult }],
});

const events = eventRuntime({
  sources: [source],
  routes: [eventRoute({
    id: 'incident-created',
    match: { types: ['incident.created'] },
    action: 'wake',
    target,
  })],
});

await events.start();
await source.publish({ event, identity, trust: 'authenticated' });
```

## Rules

- Supply identity from authenticated adapter state, never from event data.
- Treat events without verified identity as anonymous and untrusted.
- Map event data into signature inputs; do not synthesize a user message.
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
single-worker event state machine and host-owned source, sink, clock, and store
boundaries. Do not claim persistent multi-worker support from
`axevent.single-worker` alone.

## Testing

Use `AxManualEventClock`, `AxInMemoryEventStore`, deterministic event IDs, and
an output-capturing sink. Assert that unmatched or observe-only events never
invoke the program, tenant scopes do not collide, outputs exist before sinks,
and uncertain side effects become `outcome_unknown`.

Persistent store implementations must pass
`runAxEventStoreConformance(createStore, { clock })`. A store must not advertise
multi-worker capability without the conformance marker checked by runtime
startup.
