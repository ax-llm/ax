---
name: ax-mcp
description: This skill helps an LLM build correct native Model Context Protocol integrations with @ax-llm/ax. Use when the user asks about AxMCPClient, MCP transports, tools, prompts, resources, subscriptions, tasks, sampling, elicitation, roots, authentication, OAuth, MCP Apps, recording/replay, or MCP integration with AxGen, AxAgent, AxFlow, chat, optimization, and AxEventRuntime.
version: "__VERSION__"
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
- Let Ax initialize each attached client once and reuse its negotiated session.
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
mcp.docs.tasks.list()
mcp.docs.tasks.get(taskId)
mcp.docs.tasks.result(taskId)
mcp.docs.tasks.cancel(taskId)
mcp.docs.complete(...)
```

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

After initialization, inspect negotiated catalogs without converting them:

```ts
await docs.init();

const tools = docs.getTools();
const prompts = docs.getPrompts();
const resources = docs.getResources();
const templates = docs.getResourceTemplates();

const prompt = await docs.getPrompt('review', { topic: 'MCP' });
const resource = await docs.readResource('docs://guide');
const completion = await docs.complete(reference, argument);
```

Catalog getters contain the current negotiated snapshot. List-change
notifications refresh the catalog revision, and native Ax model steps rebuild
tool definitions when that revision changes.

## Tasks, Progress, And Cancellation

Use task-aware calls when the server advertises tasks:

```ts
const created = await docs.callToolTask('reindex', { scope: 'all' });
const task = await docs.getTask(created.task.taskId);
await docs.cancelTask(task.taskId);
```

Use `subscribeTaskStatus` or `subscribeEvents` for observation. Keep polling
available because task notifications are optional. Pass Ax abort signals
through program execution; never blindly replay a tool call after an uncertain
post-side-effect failure.

## Subscriptions And Event-Driven Agents

Use `AxMCPEventSource` with `AxEventRuntime`. A subscription callback only
publishes an event into the inbox. Explicit routes decide whether to observe,
invalidate, wake, or resume.

```ts
const source = new AxMCPEventSource({
  client: docs,
  resources: ['docs://guide'],
  identity: { tenantId: 'tenant-1' },
  trust: 'authenticated',
});

const runtime = eventRuntime({
  allowVolatile: true,
  sources: [source],
  routes: [
    ...axMCPEventRoutes({ client: docs }),
    eventRoute({
      id: 'guide-updated',
      match: { types: ['mcp.resource.updated'] },
      action: 'wake',
      requireAuthenticated: true,
      target: eventTarget({
        id: 'reviewer',
        ai: llm,
        program: reviewer,
        mapInput: ({ event }) => ({
          uri: (event.data as { uri: string }).uri,
        }),
      }),
    }),
  ],
});
```

Safe defaults are:

- catalog changes -> `invalidate`
- progress and logging -> `observe`
- resource updates -> no implicit wake
- `input_required` and terminal task states -> resume the owning continuation

`mapInput` is the signature and trust boundary. Raw event data remains in
`eventContext`; only selected fields become program inputs.

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

Keep SSRF protection enabled for remote discovery and redirect handling. Relax
loopback or HTTP restrictions only for controlled local development.

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

For generic inbox, continuation, store, and sink behavior, use the
`ax-event-runtime` skill. For program-specific behavior, combine this skill with
`ax-gen`, `ax-agent`, or `ax-flow`.
