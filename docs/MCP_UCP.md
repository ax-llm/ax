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

## UCP

`AxUCPClient` negotiates UCP `2026-04-08` profiles and MCP or REST services. It
preserves business outcomes separately from transport failures, supports
catalog/cart/checkout/order and identity flows, validates advertised schemas,
and supports RFC 9421 signing/verification, rotated keys, replay protection,
payment handlers, and signed lifecycle events.

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
