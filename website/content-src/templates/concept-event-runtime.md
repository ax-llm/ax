# Event Runtime

AxEventRuntime is the protocol-neutral layer for autonomous work:

`source → inbox → explicit route → AxGen/AxAgent/AxFlow → persisted output → sinks`

MCP subscriptions, UCP webhooks, timers, queues, and application events all use the same envelope, trust policy, continuation, cancellation, and tracing model. Source callbacks publish events; they never call a model directly.

```mermaid
flowchart LR
  Source["Source or protocol adapter"] --> Inbox["Event inbox"]
  Inbox --> Policy["Route action and trust gate"]
  Policy -->|observe| Store["Persist event"]
  Policy -->|invalidate| Cache["Refresh catalog or cache"]
  Policy -->|wake or resume| Program["AxGen, AxAgent, or AxFlow"]
  Program --> Output["Persist output"]
  Output --> Sinks["Retry sinks independently"]
```

## Wake

A `wake` route starts a typed target. The program signature is the destination
contract: segment-safe `eventPath` descriptors project or rename selected event
values, and invalid or missing fields dead-letter before invocation. Ax never
fabricates a user message from event data. Use multiple matching routes when
one event should wake multiple Agents so each keeps independent authorization,
ordering, retries, and run records.

{{eventWakeExample}}

## Resume

A `resume` route atomically consumes an identity-scoped continuation. State envelopes carry schema and program versions; unsupported migrations dead-letter instead of crossing program versions silently.

Targets can declare different `.wakeInput()` and `.resumeInput()` plans. The
action-specific plan wins and neither action silently falls back to the other.
`.waitFor(kind, path)` creates a continuation from verified ingress without
putting protocol data into a user message.

{{eventResumeExample}}

## UCP Webhooks

The application owns HTTP hosting. `AxUCPWebhookEventSource.ingest(request)` verifies the signer profile, RFC 9421 signature, freshness, digest, and replay state before enqueue. Application identity mapping happens afterward and remains outside the business payload.

{{eventUCPExample}}

## Store Guarantees

`AxInMemoryEventStore` is volatile and single-worker. It is useful for development and retries within one process, but it makes no crash-recovery claim.

The Node-only SQLite store supplies transactional enqueue, output persistence, leases, fencing, compare-and-set state, and cooperating-process recovery for workers sharing a local SQLite file. It is not recommended on a network filesystem. Other stores must pass the event-store conformance kit before advertising persistent or multi-worker capability.

Output is persisted before sink dispatch. Sink retries use `(runId, sinkId)` idempotency keys and never repeat a completed model call. A possible post-side-effect crash becomes `outcome_unknown` rather than an automatic replay.

Generated Python, Java, C++, Go, and Rust packages provide a deterministic
inline single-worker runtime. Sources publish into the runtime and due
deliveries invoke targets automatically; there is no hidden worker thread.
Their shared lifecycle conformance covers retry, state restoration,
continuations, cooperative cancellation, dead letters, and sink-only redrive.

See [MCP]({{langRoot}}/concepts/mcp/) and the [Event Runtime maintainer guide](https://github.com/ax-llm/ax/blob/main/docs/EVENT_RUNTIME.md).
