# Ax Event Runtime

`AxEventRuntime` connects external events to Ax programs without coupling the
program to a transport or invoking a model inside a notification callback.

```text
source -> inbox -> route policy -> AxGen / AxAgent / AxFlow -> stored run -> sink
```

The runtime is opt-in. Constructing an Ax program does not start listeners,
timers, or background model calls. Events start a program only through an
explicit `wake` or `resume` route.

## Quick Start

```ts
import {
  AxPushEventSource,
  eventRoute,
  eventRuntime,
  eventTarget,
} from '@ax-llm/ax';

const source = new AxPushEventSource('orders');
const target = eventTarget({
  id: 'order-agent',
  ai: llm,
  program: orderAgent,
  mapInput: ({ event }) => ({ order: event.data }),
  retrySafety: 'idempotent',
  sinks: [{
    id: 'results',
    write: (result, { run }) => saveResult(run.id, result),
  }],
});

const runtime = eventRuntime({
  sources: [source],
  routes: [eventRoute({
    id: 'new-order',
    match: { types: ['commerce.order.created'] },
    action: 'wake',
    target,
    requireAuthenticated: true,
  })],
});

await runtime.start();
await source.publish({
  event: {
    specversion: '1.0',
    id: 'evt-42',
    source: 'https://orders.example',
    type: 'commerce.order.created',
    data: { orderId: 'ord-42' },
  },
  identity: { tenantId: 'acme' },
  trust: 'authenticated',
});
await runtime.waitForIdle();
await runtime.close();
```

## Envelope, Identity, and Trust

`AxEventEnvelope` follows the CloudEvents 1.0 field model. Event `data` must be
persistable: finite JSON values, arrays, and plain objects. Functions, class
instances, cyclic objects, sockets, clients, and credentials are rejected.

Identity and trust are not read from event data. The source adapter supplies
`AxEventIdentity` and `AxEventTrust` after authenticating the caller. An event
without that mapping is anonymous and untrusted. Dedupe and continuation keys
include the verified identity scope, preventing one tenant from consuming
another tenant's notification.

## Route Actions

- `observe` records or forwards telemetry without calling a model.
- `invalidate` refreshes a declared catalog or cache without calling a model.
- `wake` starts a target with inputs produced by its typed `mapInput`.
- `resume` finds the continuation that owns a correlation key and restores its
  target instance.

Matching an event is never enough to invoke an LLM. The route action remains
the authorization boundary.

Event data is not injected as a fake user message. `mapInput` selects and
validates the fields accepted by the program signature. The immutable
`eventContext` remains available to nested programs and tool handlers for
identity, trust, causation, cancellation, and idempotency.

## State and Instances

Targets created with a single `program` object are limited to one logical
instance key. Stateful multi-tenant Agents must use `createProgram(instance)`
so concurrent identities never share mutable Agent state.

Program state is stored in `AxProgramStateEnvelope` with schema, program, and
revision versions. When a target changes either version it must provide
`migrateState`; otherwise the delivery is dead-lettered with
`state_migration_required`.

AxAgent `getState()` / `setState()` are detected automatically. Clarification
creates a `waiting_event` continuation instead of losing the Agent trajectory.

## Continuations

Code running under an event target can register durable correlation intent:

```ts
context.eventContext.registerContinuation({
  correlation: [{ kind: 'payment', value: paymentId }],
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
});
```

Correlation ownership is unique within one identity scope. Progress events can
use `observe`; terminal events use `resume`. Missing, ambiguous, or expired
continuations are dead-lettered rather than converted into fresh work.

## Delivery and Side Effects

The built-in `AxInMemoryEventStore` is volatile and single-process. It retries
during the process lifetime but cannot recover events after a crash. Its
defaults are 10,000 pending deliveries, 64 MiB queued data, 1 MiB per event,
and a five-second publish wait. Capacity exhaustion throws
`AxEventBackpressureError`; events are never silently dropped.

Ordering is strict for one target instance. Different routes are unordered,
especially during retry. Set `ordering: 'relaxed'` only when concurrent work is
safe. `debounceMs` delays a route; adding `coalesce: 'latest'` explicitly
replaces an older queued delivery for the same route and instance. Final output
is stored before final sink dispatch. Sink failure has its own dead letter and
does not repeat the model call.

Targets default to unknown side-effect safety. If a program may have performed
a side effect and then fails, the runtime records `outcome_unknown` rather than
blindly replaying it. Set `retrySafety: 'idempotent'` only when every effect is
protected by the stable delivery idempotency key.

## Cancellation and Shutdown

`cancelRun(runId)` aborts the active program and its nested calls. `close()`
stops sources, drains by default, then aborts remaining workers. Caller-owned
protocol clients remain caller-owned. Background source failures are supervised
through `onSourceError`; they are never thrown from an unobserved callback.

## Deterministic Tests

Pass `AxManualEventClock` to the runtime and in-memory store. Retry delay,
debounce, continuation expiry, and backpressure then advance only when the test
calls `advanceBy`, avoiding wall-clock flakes.

Persistent and multi-worker guarantees are capability-gated. Ax documents
those guarantees only for stores that pass the event-store conformance kit.

## MCP Adapter

`AxMCPEventSource` converts client notifications into generic envelopes. It
preserves existing client callbacks, supervises Streamable HTTP listening, and
restores logical subscriptions after safe session recovery. Supply verified
identity from the application's token mapping; MCP sessions alone are
anonymous. `axMCPEventRoutes({ client })` provides observe/invalidate/task
resume defaults, while resource changes require an explicit wake route.
