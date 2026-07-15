# MCP Catalog Discovery And Resource Subscriptions

An MCP endpoint is the server address. It is not a resource name and it does
not need to encode the server's tools, prompts, or resource URIs. Ax connects
to that endpoint, negotiates the MCP session, and asks the server for its
catalog.

The complete event path is:

```text
endpoint -> catalog discovery -> subscription policy -> maintained subscriptions
         -> AxEventRuntime inbox -> explicit observe/invalidate/wake/resume route
```

Discovery does not subscribe, subscription does not wake a model, and an MCP
session does not establish application tenant identity. Those are three
separate application decisions.

## Inspect What The Endpoint Offers

Create the transport and client, then inspect one immutable snapshot:

```ts
import {
  AxMCPClient,
  AxMCPStreamableHTTPTransport,
} from '@ax-llm/ax';

const transport = new AxMCPStreamableHTTPTransport(
  'https://mcp.example.com/mcp'
);
const client = new AxMCPClient(transport, { namespace: 'inventory' });

const catalog = await client.inspectCatalog();

console.table(catalog.tools.map(({ name, description }) => ({
  kind: 'tool',
  name,
  description,
})));
console.table(catalog.resources.map(({ name, uri, mimeType }) => ({
  kind: 'resource',
  name,
  uri,
  mimeType,
})));
console.table(catalog.resourceTemplates.map(({ name, uriTemplate }) => ({
  kind: 'template',
  name,
  uriTemplate,
})));
```

`inspectCatalog()` initializes the client once, follows bounded pagination,
and returns a deep-cloned `AxMCPCatalogSnapshot` containing:

- the namespace, protocol version, revision, server identity, and negotiated
  capabilities;
- tools and prompts;
- concrete resources and URI templates;
- the currently owned logical resource subscriptions.

Mutating the returned object cannot mutate the live client. Pass
`{ refresh: true }` when the application needs a forced round trip. Normal MCP
list-change notifications refresh the live catalog and increment its revision.

## Concrete Resources Versus URI Templates

A concrete resource has a URI that can be subscribed to immediately, such as
`inventory://warehouse/current`. A template describes a family of resources,
such as `inventory://warehouse/{warehouseId}`.

Ax never expands templates automatically. The application must obtain or
choose the template arguments, construct the concrete URI, and subscribe to
that URI explicitly. The MCP completion API can help suggest argument values,
but it does not authorize expansion or subscription.

A server may legitimately return no concrete resources while returning one or
more templates. In that case an `'all'` policy currently selects nothing; it
will reconsider the policy if the server later emits
`notifications/resources/list_changed`.

## Choose A Managed Subscription Policy

`AxMCPEventSource` defaults to no resource subscriptions. Task, progress,
logging, and catalog events still enter the event runtime.

### Subscribe to every discovered concrete resource

Use this only when the endpoint is trusted and its complete resource catalog is
appropriate for this application identity:

```ts
const source = new AxMCPEventSource({
  client,
  resourceSubscriptions: 'all',
  identity: { tenantId: account.tenantId },
  trust: 'authenticated',
});
```

`'all'` is the endpoint-only convenience. It selects concrete resources from
the discovered catalog; it does not expand URI templates.

### Select resources by catalog metadata

For production integrations, select by stable server metadata instead of
copying a URI from documentation:

```ts
const source = new AxMCPEventSource({
  client,
  resourceSubscriptions: {
    select: (resource) =>
      resource.mimeType === 'application/json' &&
      resource.annotations?.audience?.includes('assistant') === true &&
      /inventory|stock/i.test(
        `${resource.name} ${resource.description ?? ''}`
      ),
  },
  identity: { tenantId: account.tenantId },
  trust: 'authenticated',
});
```

The selector receives each concrete resource and the whole catalog snapshot.
It may inspect name, URI, description, MIME type, annotations, or related
catalog information. Selected URIs are sorted and deduplicated.

If selector evaluation throws during a catalog change, the source keeps its
previous selection, reports the error, and waits for the next catalog change
or reconnect to retry. It does not tear down known-good subscriptions.

### Supply concrete URIs explicitly

Dynamic or application-constructed resources can bypass catalog selection:

```ts
const source = new AxMCPEventSource({
  client,
  resourceSubscriptions: [
    `inventory://warehouse/${encodeURIComponent(warehouseId)}`,
  ],
  identity,
  trust: 'authenticated',
});
```

The deprecated `resources: string[]` option remains a compatibility alias.
Do not specify it together with `resourceSubscriptions`.

## Route Notifications Into An Agent

A source only publishes envelopes. It never invokes an Agent or converts the
notification into a user message. An authenticated route and a signature-aware
target make that decision explicitly:

```ts
const target = eventTarget('inventory-agent')
  .program(inventoryAgent)
  .ai(llm)
  .input((input) => input.field('uri', eventPath.data('uri')))
  .forwardOptions({ mcp: client })
  .retrySafety('idempotent')
  .build();

const runtime = eventRuntime({
  allowVolatile: true,
  sources: [source],
  routes: [
    ...axMCPEventRoutes({ client }),
    eventRoute('inventory-resource-updated')
      .sources('mcp://inventory')
      .types('mcp.resource.updated')
      .authenticated()
      .instanceKey(eventPath.subject())
      .wake(target)
      .build(),
  ],
});

await runtime.start();
```

The input plan admits only `uri` to the program signature. The original,
untrusted MCP envelope remains available as attributed `eventContext`. Add
multiple matching routes when one resource update should wake multiple Agents;
each target then receives independent authorization, ordering, retry,
cancellation, and run records.

## Managed And Manual Subscription Ownership

Applications may also subscribe manually:

```ts
await client.subscribeResource(uri);
// Later:
await client.unsubscribeResource(uri);
```

The client tracks logical owners per URI. A manual call, each event source, and
restored continuation intent are separate owners. Ax sends
`resources/subscribe` only for the first owner and sends
`resources/unsubscribe` only after the final owner releases the URI.

Closing one event source releases only that source's ownership. It cannot
break another source or a manual subscription sharing the client. Closing the
client ends every subscription and closes the transport session.

## Catalog Changes And Reconnect

When the server sends `notifications/resources/list_changed`, a managed event
source:

1. refreshes the catalog;
2. evaluates its policy against the new concrete resources;
3. subscribes to additions and unsubscribes from removals;
4. publishes the catalog-change event to the runtime.

Wire-level partial failures keep successful changes. Failed transitions are
reported and retried on the next list change or reconnect. After a transport
reconnect, the client restores each currently owned URI exactly once and the
source retries any incomplete reconciliation.

Always shut down in ownership order:

```ts
await runtime.close({ drain: false }); // closes its event sources
await client.close();                  // closes the caller-owned MCP client
```

## Task Continuations Are Independent

Resource subscription policy does not control MCP tasks. When an event-driven
tool call creates a task, Ax records the qualified `namespace:taskId` and can
register the owning continuation automatically. Progress is observed without a
model call. `input_required` and terminal task notifications resume the owner
through an explicit resume route.

Keep polling available: MCP task notifications are optional, and a server may
require clients to call `tasks/get` until the task becomes terminal.

## Identity, Trust, And Network Safety

MCP identifies a protocol session, not an application tenant. Derive
`AxEventIdentity` from the application's verified OAuth token/account mapping.
Without that mapping, use anonymous, untrusted ingress; those notifications
cannot match `.authenticated()` routes.

Treat resource names, descriptions, contents, annotations, and notifications
as untrusted remote data. A subscription grants notification delivery, not
permission to invoke models or tools.

Remote HTTP transports require secure network settings. A controlled localhost
demo must opt in explicitly:

```ts
new AxMCPStreamableHTTPTransport('http://127.0.0.1:3001/mcp', {
  ssrfProtection: { allowHTTP: true, allowLoopback: true },
});
```

Never copy that relaxation to an arbitrary endpoint.

## Troubleshooting

### The catalog is empty

- Confirm the server advertises and implements `resources/list`.
- Call `inspectCatalog({ refresh: true })` and inspect the negotiated server
  capabilities.
- Check whether the server exposes only `resourceTemplates`.
- Ensure authentication scopes permit resource discovery.

### The server has templates but no subscriptions start

Templates are intentionally not expanded. Construct an authorized concrete URI
and pass it in an explicit URI-array policy.

### Ax says resource subscriptions are unsupported

The server did not advertise the resource subscription capability. Ax rejects
an explicit subscription policy instead of pretending notifications will
arrive. Catalog, task, logging, and progress events may still work.

### Notifications never arrive

- Verify `runtime.start()` completed and the source subscribed before treating
  the application as ready.
- Verify the Streamable HTTP GET/SSE listener is connected.
- Check that the server actually sends resource notifications; support for
  listing resources alone is not subscription support.
- Check the route source/type, authenticated identity, and selector result.
- For localhost, verify the explicit SSRF opt-in.
- On shutdown, close the runtime/source before the client.

### A notification arrives but no Agent runs

That is the safe default. Add an explicit `wake` route. Catalog changes default
to `invalidate`; progress and logs default to `observe`; only task continuations
with a matching owner default to `resume`.

## Runnable Evidence

- `src/examples/typescript/mcp/native-mcp-tools.ts` prints a discovered catalog.
- `src/examples/typescript/mcp/resource-wake-agent.ts` uses the explicit
  all-resource policy and an authenticated wake route.
- Equivalent examples are checked in for Python, Java, C++, Go, and Rust.
- `npm run test:mcp-events:generated` runs the credential-free localhost
  HTTP/SSE matrix for discovery, dynamic catalog reconciliation, reconnect,
  automatic wake, progress, and task continuation.
