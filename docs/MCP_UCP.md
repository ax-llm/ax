# Native MCP and UCP

Ax treats MCP and UCP as live execution context, not as a function-conversion
step. The same client sessions, capabilities, trust policy, cancellation,
tasks, content, and traces flow through AxGen, streaming, chat, AxAgent,
children, RLM, AxFlow, memory continuation, and evaluation.

## Attach clients

```ts
const program = ax('question:string -> answer:string', {
  mcp: [docsClient, searchClient],
  ucp: merchantClient,
  mcpInheritance: 'all',
});

const answer = await program.forward(ai, { question }, {
  mcpContext: [
    { client: 'docs', resource: { uri: 'docs://handbook' } },
    { client: 'search', prompt: { name: 'research', arguments: { topic } } },
  ],
});
```

Constructor clients are defaults. Per-call clients override those defaults.
Nested programs inherit the resolved context unless `mcpInheritance` is
`'none'` or a namespace allowlist. Caller-owned clients remain caller-owned;
close them when the application no longer needs their sessions.

Ax rejects namespace and provider-visible tool collisions before the first
model request. It refreshes model tool definitions after catalog-change
notifications and keeps raw MCP/UCP results in memory alongside the
provider-compatible representation.

## Subscriptions, tasks, and autonomous wake

`AxMCPEventSource` adapts the live client event stream to `AxEventRuntime`.
Protocol callbacks enqueue events; they never invoke a model. Resource updates
need an explicit `wake` route, while `axMCPEventRoutes({ client })` supplies the
safe defaults for catalog invalidation, progress/log observation, and terminal
task continuation:

```ts
const source = new AxMCPEventSource({
  client,
  resources: ['docs://handbook'],
  // Identity comes from the application's authenticated client/token mapping.
  identity: { tenantId: account.tenantId },
  trust: 'authenticated',
});

const runtime = eventRuntime({
  sources: [source],
  routes: [
    ...axMCPEventRoutes({ client }),
    eventRoute('handbook-wake')
      .types('mcp.resource.updated')
      .authenticated()
      .wake(target)
      .build(),
  ],
  // Required only while using the Milestone 1-2 volatile store.
  allowVolatile: true,
});
```

MCP sessions do not prove tenant identity. Without an adapter-supplied verified
mapping, notifications are anonymous and untrusted and cannot enter routes
requiring authentication. Logical subscriptions are restored after safe
session recovery. Task polling remains available because servers are not
required to send task notifications.

A required task-backed MCP tool called under an event target automatically
registers `mcp.task:<namespace>:<taskId>` as a continuation. Progress is
observed without waking a model; `input_required` and terminal task states
resume the owning target. Closing the event source removes its listener and
cancels subscriptions it added, without closing the caller-owned client.

## Native content and runtime modules

MCP results retain text, structured content, images, audio, resource links,
embedded resources, metadata, task references, and protocol errors. Provider
adapters map supported content natively and perform deterministic degradation
only at an adapter that cannot represent the original type.

AxAgent exposes clients as `mcp.<namespace>` and `ucp.<namespace>` modules.
These modules include MCP tools, prompts, resources, subscriptions,
completions, tasks, and negotiated extension operations, plus typed UCP
commerce operations.

`AxMCPClient.toFunction()` is retained only for compatibility with older
applications. Native Ax execution paths do not call it.

## Transports, authentication, and safety

The TypeScript client supports stdio, Streamable HTTP, legacy/resumable SSE,
custom WebSocket, and recording/replay transports. JSON-RPC batching is
available only for the protocol version that permits it. Requests enforce
response IDs, limits, bounded pagination/redirects, cancellation, safe retry,
and non-replay of ambiguous side effects after session expiry.

Authentication includes API-key/custom strategies and MCP OAuth discovery,
PKCE, CIMD/DCR, client credentials and client assertions, DPoP, PAR/JAR/RAR,
mTLS host channels, revocation/introspection, JWT/JWKS validation, and
enterprise-managed authorization. MCP Apps are negotiated and sandboxed as an
extension rather than exposed as ordinary model tools.

### Listening and advanced recipes

HTTP, legacy SSE, WebSocket, and transports that listen during `connect()` all
use the same client lifecycle:

```ts
const listening = await client.startListening({
  signal,
  onError: reportTransportError,
});
// Later:
await listening.close();
```

Streamable HTTP supervises the background GET, resumes SSE with
`Last-Event-ID`, reinitializes expired sessions, and restores logical resource
subscriptions. Legacy SSE and WebSocket transports already receive messages on
their connected channel and use the same client handle for cancellation.

For the checked-in subscription examples, point `AX_MCP_ENDPOINT` at a real
Streamable HTTP endpoint. Plain HTTP and loopback remain denied by default.
Only a controlled localhost demo should opt in explicitly:

```ts
const transport = new AxMCPStreamableHTTPTransport(endpoint, {
  ssrfProtection: { allowHTTP: true, allowLoopback: true },
});
```

Generated-language examples make the equivalent local-only choice with
`requireHttps: false`, `allowLocalhost: true`, and
`allowPrivateNetworks: true` only when the endpoint is `127.0.0.1`. Keep secure
defaults for every remote endpoint. On shutdown, close the event source or
runtime first, then close the caller-owned MCP client and local demo server.

Run the credential-free five-language protocol gate with
`npm run test:mcp-events:generated`. To exercise a provider-backed public
example manually, start `src/examples/mcp-event-demo-server.ts`, set
`AX_MCP_ENDPOINT=http://127.0.0.1:3001/mcp`, then POST to
`/control/resource` or `/control/task/complete` from another terminal. The
examples wait on target/sink completion and close their source, runtime, and
client in order; they do not use `waitForIdle()` as an ingress detector.

- Sampling: pass `sampling(params, { client, namespace })` to the client and
  return a typed `sampling/createMessage` result.
- Elicitation: pass `elicitation` and validate both form and URL-mode requests
  before returning an accepted, declined, or cancelled result.
- MCP Apps: use negotiated App resources and `AxMCPAppBridge`; App content is
  untrusted and never silently becomes model input.
- OAuth refresh/step-up: configure the OAuth helper and token stores on the
  HTTP transport; resource challenges force safe refresh or incremental scope
  acquisition.
- Cancellation: call `unsubscribeResource`, `cancelTask`, or close the
  listening handle. Event runtime cancellation propagates to active MCP tool
  requests and task cleanup.
- Recording/replay: wrap a live transport in `AxMCPRecordingTransport`, then
  use `AxMCPReplayTransport` for deterministic evaluation without repeating
  side effects.

## UCP

`AxUCPClient` negotiates UCP `2026-04-08` profiles and MCP or REST services. It
preserves business outcomes separately from transport failures, supports
catalog/cart/checkout/order and identity flows, validates advertised schemas,
and supports RFC 9421 signing/verification, rotated keys, replay protection,
payment handlers, and signed lifecycle events.

Application HTTP handlers can pass signed lifecycle requests to
`AxUCPWebhookEventSource.ingest(request)`. The client verifies the business
profile, RFC 9421 signature, content digest, timestamp window, and replay key
before the adapter publishes. The application then maps the verified event to
tenant/account identity; an event without that mapping remains anonymous and
untrusted. The source requires durable acknowledgement unless the runtime
explicitly opts into volatile acceptance.

## Evaluation and continuation

Remote task IDs and subscription intent can be serialized in agent state, but
credentials, tokens, sockets, and transport objects never are. Restored runs
must rebind clients and revalidate remote references.

Optimization/evaluation rejects live MCP/UCP clients by default. Record a
session with `AxMCPRecordingTransport`, replay it with
`AxMCPReplayTransport`, or explicitly select live evaluation when repeated
side effects are intended.

## Generated packages

AxIR declares `AxExecutionContext`, `AxMCPContinuationState`, `AxUCPBinding`,
and `AxUCPClient`. Generated Python, Java, C++, Go, and Rust packages expose
native MCP/UCP bindings, namespace/tool collision checks, inheritance,
continuation fingerprints, typed UCP operation wrappers, and business-outcome
preservation. The shared conformance fixture
`ir/conformance/axmcp/execution-context-ucp.json` runs in all five targets.

AxIR also declares the protocol-neutral `ax.event` state machine. Generated
packages provide deterministic volatile single-worker routing, signature input
mapping, automatic dispatch of work due now, retry, cancellation, program-state
restoration, continuation resume, output-before-sink persistence, isolated sink
redrive, dead letters, and MCP normalization. Delayed work is host-scheduled:
call `nextDueAt()` to choose the next wake time and `runDue()` after advancing
or waiting on the injected clock. No generated runtime owns a hidden worker
thread.

Their `AxMCPEventSource` composes listeners, restores logical resource
subscriptions, and publishes identity-scoped notifications into the runtime.
Transport supervisors own the long-lived HTTP/SSE listener; Rust hosts also
call `source.poll()` to drain queued protocol callbacks on the host thread.
The `axevent.single-worker` and lifecycle-dispatch capability markers are tied
to the all-language conformance gate. Persistent multi-worker capability
remains store- and language-specific.
