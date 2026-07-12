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

## Testing

Use `AxManualEventClock`, `AxInMemoryEventStore`, deterministic event IDs, and
an output-capturing sink. Assert that unmatched or observe-only events never
invoke the program, tenant scopes do not collide, outputs exist before sinks,
and uncertain side effects become `outcome_unknown`.
