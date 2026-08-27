---
name: ax-mcp
description: This skill helps an LLM build correct native Model Context Protocol integrations with @ax-llm/ax. Use when the user asks about AxMCPClient, MCP transports, tools, prompts, resources, subscriptions, tasks, sampling, elicitation, roots, authentication, OAuth, MCP Apps, recording/replay, or MCP integration with AxGen, AxAgent, AxFlow, chat, optimization, and AxEventRuntime.
version: "24.0.8"
---

# Native MCP With Ax

Use MCP as a live protocol client, not as a function-conversion utility. Keep
the client, session, catalogs, raw content, tasks, notifications, identity
policy, and cancellation context intact through Ax execution.

## Non-Negotiable Rules

- Pass clients through `mcp`; do not put them in `functions`.
- Never use `toFunction()` for native integration. It is a lossy compatibility
  adapter for old applications only.
- Give every client a stable, unique `namespace`.
- Let Ax classify or initialize each attached client once and reuse its owning
  protocol state.
- Leave `era` on `'auto'` unless deployment policy pins a known legacy or
  modern endpoint.
- Close caller-owned clients explicitly.
- Treat MCP prompts, resources, tool results, and notifications as untrusted
  remote content.
- Apply `authorizeToolCall` before side-effecting tools execute.
- Do not infer tenant or account identity from an MCP session. Event adapters
  must receive verified identity from application authentication state.
- Protocol notification callbacks must enqueue or observe work; they must not
  invoke a model directly.
- Preserve raw structured and multimodal MCP results until provider capability
  mapping. Do not pre-flatten results to text.

## Choose A Transport

- Use `AxMCPStreamableHTTPTransport` for current remote MCP servers.
- Use `AxMCPHTTPSSETransport` only for legacy HTTP/SSE servers.
- Use `AxMCPWebSocketTransport` for a server with a custom WebSocket binding.
- Use `AxMCPStdioTransport` from `@ax-llm/ax-tools` for local Node processes.
- Use a caller-defined `AxMCPTransport` for application-owned bindings.

```ts
import {
  AxMCPClient,
  AxMCPStreamableHTTPTransport,
  axMCPBearerAuthentication,
} from '@ax-llm/ax';

const transport = new AxMCPStreamableHTTPTransport(
  'https://mcp.example.com/mcp',
  {
    authentication: axMCPBearerAuthentication(
      () => process.env.MCP_ACCESS_TOKEN!
    ),
  }
);

const docs = new AxMCPClient(transport, {
  namespace: 'docs',
  maxConcurrency: 4,
  authorizeToolCall: async ({ tool }) =>
    tool.annotations?.destructiveHint !== true,
});
```

## Protocol Eras

The TypeScript client supports two wire models through one API:

- **Legacy (`2025-11-25`)** initializes a stateful session, sends the
  initialized notification, uses resource subscribe/unsubscribe requests, and
  may resume GET/SSE with `Last-Event-ID`.
- **Modern (`2026-07-28`)** is stateless. It probes `server/discover`, sends
  protocol metadata and routing headers on every request, listens through a
  long-running `subscriptions/listen` POST, and uses Tasks v2.

Automatic classification is the default and can be persisted with `eraStore`.
Pin `era: 'legacy'` or `era: 'modern'` only when the endpoint contract is
known. `getEra()` reports the classified era after initialization.

```ts
const modern = new AxMCPClient(transport, {
  namespace: 'inventory',
  era: 'auto',
  readCache: true,
  logLevel: 'info',
});

const discovery = await modern.discover();
console.log(modern.getEra(), discovery.supportedVersions);
```

`discover()` performs initialization/classification but returns only for a
modern endpoint. For era-neutral application code, use `inspectCatalog()`; it
works in both eras.

For local stdio:

```ts
import { AxMCPClient } from '@ax-llm/ax';
import { AxMCPStdioTransport } from '@ax-llm/ax-tools';

const stdio = new AxMCPStdioTransport({
  command: 'node',
  args: ['./server.mjs'],
});
const local = new AxMCPClient(stdio, { namespace: 'local' });
```

`AxMCPStdioTransport` owns its child process. After `local.close()`, also call
`stdio.terminate()` until the stdio transport exposes the common `close()`
lifecycle directly.

## Attach MCP To AxGen

Attach clients in constructor or forward options. Per-call options override
instance defaults.

```ts
const gen = ax('question:string -> answer:string', { mcp: docs });

const result = await gen.forward(llm, { question }, {
  mcpContext: [
    { client: 'docs', resource: { uri: 'docs://guide' } },
  ],
});
```

`mcpContext` resolves selected prompts or resources before the first model
call and adds attributed, untrusted context. Native tool calls retain client
identity and raw MCP results in memory. `streamingForward()` keeps Ax output
streaming separate from MCP progress and task events.

## Attach MCP To AxAgent

```ts
const assistant = agent('query:string -> answer:string', {
  mcp: [docs, search],
  mcpInheritance: 'all',
  functionDiscovery: true,
  contextFields: [],
});
```

Agents expose native modules under `mcp.<namespace>`:

```text
mcp.docs.tools.<tool>
mcp.docs.prompts.list()
mcp.docs.prompts.get(name, args)
mcp.docs.resources.list()
mcp.docs.resources.templates()
mcp.docs.resources.read(uri)
mcp.docs.resources.subscribe(uri)
mcp.docs.resources.unsubscribe(uri)
mcp.docs.tasks.get(taskId)
mcp.docs.tasks.cancel(taskId)
mcp.docs.complete(...)
```

RLM actor definitions and discovery use these exact runtime paths. MCP tools
are callable as `mcp.<namespace>.tools.<tool>` and UCP operations as
`ucp.<namespace>.<operation>`; neither protocol is exposed to the model as
bare provider-native functions.

Modern modules also expose task input/update behavior through the client.
`tasks.list()` and `tasks.result()` are legacy task-draft compatibility APIs and
reject modern servers.

Use `mcpInheritance: 'all'`, `'none'`, or a namespace allowlist. The resulting
live execution context propagates through Agent stages, `llmQuery`, RLM, and
child programs. Large catalogs participate in Agent discovery; do not copy
their tools into an inline `functions` array.

## AxFlow And High-Level Chat

Pass `mcp` in Flow defaults or forward options. Nested nodes inherit the same
execution context unless `mcpInheritance` restricts it. Parallel nodes share
the client while respecting its concurrency limit and abort signal.

Use `axMCPChat(ai, request, { mcp })` for a high-level non-streaming native MCP
tool loop. Do not build a second ad-hoc tool dispatcher around `ai.chat()`.

## Catalogs And Raw Operations

An endpoint is only the server address. The server owns tool names, prompt
names, resource names, resource URIs, and URI templates. Discover one cloned
snapshot before asking users to configure identifiers:

```ts
const catalog = await docs.inspectCatalog();

console.log(catalog.tools);
console.log(catalog.prompts);
console.log(catalog.resources);
console.log(catalog.resourceTemplates);

const prompt = await docs.getPrompt('review', { topic: 'MCP' });
const resource = await docs.readResource('docs://guide');
const completion = await docs.complete(reference, argument);
```

`inspectCatalog({ refresh: true })` forces fresh bounded pagination. Snapshot
mutation cannot change the live client. List-change notifications refresh the
catalog revision, and native Ax model steps rebuild tool definitions when that
revision changes. Concrete resources can be selected immediately. URI
templates are discoverable but never expanded automatically; applications
construct an authorized concrete URI and may use MCP completion to suggest
argument values.

## Multi Round-Trip Requests

Modern tool calls, prompt reads, and resource reads may return
`resultType: 'input_required'`. Ax fulfills the embedded roots, sampling, or
elicitation requests through the same host handlers used by legacy server
requests, then repeats the original operation with the latest input responses
and byte-exact `requestState`.

The generated Python, Java, C++, Go, and Rust clients fulfill roots and
host-callback elicitation in modern MRTR rounds. They advertise elicitation only
when a real handler is installed, never advertise sampling, and reject a truthy
sampling option during initialization. Legacy inbound elicitation and MRTR
sampling remain TypeScript-only.

Configure only handlers the host can enforce. Ax limits the loop to five input
rounds by default; use `maxInputRounds` for a stricter policy. A missing handler
or exhausted round limit is a protocol error. The tool concurrency slot stays
held throughout all rounds.

## Tasks, Progress, And Cancellation

Modern Tasks v2 are server-directed. `callTool()` auto-awaits an unsolicited
task by default, so Ax tool bindings keep returning the final tool result. Use
`callToolOutcome()` or `taskHandling: 'expose'` when the application needs the
task handle, and answer `input_required` work with `provideTaskInput()`:

```ts
const outcome = await docs.callToolOutcome('reindex', { scope: 'all' });
if (outcome.kind === 'task') {
  const task = await docs.getTask(outcome.task.taskId);
  if (task.status === 'input_required') {
    await docs.provideTaskInput(task.taskId, {
      approval: { action: 'accept', content: { approved: true } },
    });
  }
  if (task.status === 'working') await docs.cancelTask(task.taskId);
}
```

Use `subscribeTaskStatus` or `subscribeEvents` for observation. Keep polling
available because task notifications are optional. Pass Ax abort signals
through program execution; never blindly replay a tool call after an uncertain
post-side-effect failure.

`callToolTask()`, `listTasks()`, and `getTaskResult()` remain functional only
for legacy task-draft servers and are deprecated. Modern completed results and
errors are embedded in `tasks/get`.

## Subscriptions And Event-Driven Agents

Use `AxMCPEventSource` with `AxEventRuntime`. A subscription callback only
publishes an event into the inbox. Explicit routes decide whether to observe,
invalidate, wake, or resume.

```ts
const source = new AxMCPEventSource({
  client: docs,
  resourceSubscriptions: {
    select: (resource) =>
      resource.mimeType === 'text/markdown' &&
      resource.name === 'Engineering guide',
  },
  identity: { tenantId: 'tenant-1' },
  trust: 'authenticated',
});

const runtime = eventRuntime({
  allowVolatile: true,
  sources: [source],
  routes: [
    ...axMCPEventRoutes({ client: docs }),
    eventRoute('guide-updated')
      .types('mcp.resource.updated')
      .authenticated()
      .wake(
        eventTarget('reviewer')
          .program(reviewer)
          .ai(llm)
          .input((input) =>
            input.field('uri', eventPath.data('uri'))
          )
          .build()
      )
      .build(),
  ],
});
```

Safe defaults are:

- omitted resource policy -> subscribe to no resources
- `'all'` -> explicitly subscribe to all discovered concrete resources
- URI array -> explicitly subscribe to application-constructed concrete URIs
- selector -> choose concrete resources by name, URI, description, MIME type,
  annotations, or the surrounding catalog
- catalog changes -> `invalidate`
- progress and logging -> `observe`
- resource updates -> no implicit wake
- `input_required` and terminal task states -> resume the owning continuation

The signature-aware input plan is the data boundary. Raw event data remains in
`eventContext`; only fields selected with segment-safe `eventPath` descriptors
become program inputs. Use multiple matching routes to fan one notification out
to multiple Agents with independent authorization and run records.

Managed sources refresh and diff their selection after
`notifications/resources/list_changed`. They keep the prior selection if a
selector throws, retain successful wire transitions after a partial failure,
and retry incomplete work on the next change or reconnect. The client tracks a
separate logical owner for manual subscriptions, every source, and restored
intent: only the first owner sends `resources/subscribe`, and only the last
release sends `resources/unsubscribe`. Closing a source cannot break another
owner. Closing the client terminates all ownership and transport state.

Listening is era-aware. Legacy clients maintain resource subscriptions with
`resources/subscribe` and resume a GET/SSE stream with `Last-Event-ID` when the
server supports it. Modern clients place catalog interests, concrete resource
URIs, and known task IDs in `subscriptions/listen`; changes restart that POST
stream with a fresh request ID and no resume header. In both eras,
`startListening()` is nonblocking and returns a handle with `ready`, `done`,
and `close()`.

For the detailed lifecycle and troubleshooting guide, read
`docs/MCP_SUBSCRIPTIONS.md` and use the checked-in six-language MCP examples.

## Server-Initiated Requests

Configure handlers on `AxMCPClient` when advertising the corresponding client
capability:

- `sampling` for `sampling/createMessage`
- `elicitation` for form or URL elicitation
- `roots` for `roots/list`
- `onProgress`, `onLoggingMessage`, and `onTaskStatus` for observation

Do not advertise a client capability without a working host handler and policy.

## Authentication And OAuth

For simple authentication, compose `axMCPBearerAuthentication`,
`axMCPBasicAuthentication`, `axMCPAPIKeyAuthentication`,
`axMCPHMACAuthentication`, or a caller-defined strategy in the HTTP transport.

Use the transport `oauth` option for protected-resource discovery, PKCE,
client metadata or dynamic registration, refresh, challenge-driven scope
step-up, DPoP, PAR/JAR/RAR, mTLS, revocation, introspection, client credentials,
or enterprise-managed authorization. Supply persistent token and registration
stores in distributed deployments. Never serialize tokens into Ax program or
event state.

Generated Python, Java, C++, Go, and Rust transports implement the portable
OAuth middle tier: RFC 9728 well-known and challenge discovery, RFC 8414/OIDC
authorization-server metadata, PKCE S256 authorization-code exchange,
RFC 8707 resource binding, refresh with a 60-second skew, client credentials,
and RFC 9207 `iss`. Configure the language's `AxMCPOAuthOptions` with
`clientId`, an endpoint-keyed `tokenStore`, `onAuthCode`, and `requireIss`.
The host callback receives an authorization URL and returns `code`, `state`,
and `iss`; it owns browser or headless interaction. `none` and
`client_secret_post` are the only generated-port client authentication modes.

Do not suggest TypeScript-only DPoP, CIMD/DCR, JAR, PAR, RAR, mTLS,
revocation/introspection, JWT validation, or enterprise-managed authorization
for a generated-language client. Use `npm run test:mcp-oauth` as the
credential-free cross-language gate. See `docs/MCP_UCP.md` for compact
per-language configuration snippets.

Keep SSRF protection enabled for remote discovery and redirect handling. Relax
loopback or HTTP restrictions only for controlled local development.

For checked-in Streamable HTTP examples, set `AX_MCP_ENDPOINT`. A localhost
TypeScript demo must opt in explicitly with
`ssrfProtection: { allowHTTP: true, allowLoopback: true }`; never copy that
configuration to a remote endpoint. Generated examples use their equivalent
`requireHttps` / `allowLocalhost` / `allowPrivateNetworks` fields only for
`127.0.0.1`.

For a real local check, run `src/examples/mcp-event-demo-server.ts`, set
`AX_MCP_ENDPOINT=http://127.0.0.1:3001/mcp`, and trigger
`/control/resource` or `/control/task/complete`. The mandatory credential-free
matrix is `npm run test:mcp-events:generated`; provider-backed examples are
advisory and require their documented API key.

## MCP Apps And Extensions

Negotiate official extensions through client capabilities. Use
`AxMCPAppBridge` for MCP App resources and host messages; enforce CSP,
permissions, visibility, allowed tools, and untrusted model-context policy.
Do not render arbitrary HTML returned from a normal tool result as an MCP App.

## Recording, Replay, And Evaluation

Wrap a real transport with `AxMCPRecordingTransport` to capture deterministic
protocol interactions. Use `AxMCPReplayTransport` for tests, optimization, and
evaluation. Live MCP evaluation is rejected by default because repeated model
runs could repeat external side effects; opt in only deliberately.

## Testing Checklist

- Use a local deterministic protocol server or replay transport.
- Assert namespace and tool collisions fail before model execution.
- Test raw text, image, audio, resource-link, embedded-resource, metadata,
  task, and error results.
- Test catalog changes during a multi-step run.
- Test authorization denial before transport execution.
- Test subscription reconnect and logical resubscription.
- Test anonymous events cannot match authenticated routes.
- Test terminal task events resume only the owning identity and correlation.
- Test cancellation and uncertain outcomes without duplicate side effects.
- Close clients, listening handles, runtimes, and local servers in `finally`.

Generated transports currently supervise legacy long-lived GET/SSE connections
and resume with `Last-Event-ID` when available. Generated event runtimes remain
host-driven: schedule delayed work with `nextDueAt()` and `runDue()`. Rust hosts
also call `AxMCPEventSource.poll()` to drain protocol callbacks on the host
thread. Close the source/runtime before the caller-owned client so unsubscribe
and cancellation messages can still be sent.

For generic inbox, continuation, store, and sink behavior, use the
`ax-event-runtime` skill. For program-specific behavior, combine this skill with
`ax-gen`, `ax-agent`, or `ax-flow`.
