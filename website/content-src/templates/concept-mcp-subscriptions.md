# MCP Catalog Discovery And Subscriptions

An MCP endpoint is only the server address. The server owns its tool names,
prompt names, concrete resource URIs, and URI templates. Ax discovers those
values after connecting, so an application does not need to hard-code names
that the server can list.

```text
endpoint → catalog → explicit subscription policy → maintained subscriptions
         → event inbox → explicit wake or resume route
```

Discovery does not subscribe. Subscription does not wake a model. An MCP
session does not prove application tenant identity.

## Inspect The Endpoint Catalog

`inspectCatalog()` initializes the client once, follows bounded pagination, and
returns a deep-cloned snapshot with the namespace, protocol version, revision,
server capabilities, tools, prompts, concrete resources, URI templates, and
current logical subscriptions. Use the refresh option for a forced round trip.

{{mcpNativeExample}}

Concrete resources can be selected immediately. A URI template describes a
family such as `orders://{orderId}`. Ax never expands templates automatically;
the application chooses authorized arguments and supplies the resulting URI.
MCP completion may suggest argument values, but it does not authorize them.

## Select What To Subscribe To

Resource subscription policy defaults to **none**. Task, progress, logging, and
catalog events still work.

- **All:** explicitly select every discovered concrete resource. This is the
  simple endpoint-only shortcut for a trusted server.
- **Selector:** select concrete resources by name, URI, description, MIME type,
  annotations, or the full catalog. This is the normal production choice.
- **URI list:** supply dynamic or application-constructed concrete URIs.
- **None:** receive non-resource MCP events without resource subscriptions.

Templates are never included by an all or selector policy. If a selector fails
during a catalog change, Ax keeps the prior known-good selection. Partial wire
failures retain successful transitions and retry incomplete work on the next
change or reconnect.

{{mcpResourceWakeExample}}

## Catalog Changes, Ownership, And Reconnect

After `notifications/resources/list_changed`, Ax refreshes the catalog,
recomputes selection, subscribes to additions, unsubscribes from removals, and
then publishes the catalog-change event.

Logical ownership prevents shared clients from breaking each other. Manual
subscriptions, every event source, and restored intent are separate owners.
Only the first owner sends `resources/subscribe`; only the final release sends
`resources/unsubscribe`. Closing a source releases its ownership. Closing the
client terminates all subscriptions and transport state.

Reconnect restores the currently selected logical subscriptions exactly once.
Close the runtime or source before closing the caller-owned client so final
unsubscribe and cancellation requests can still be sent.

## Wake And Resume Stay Explicit

`AxMCPEventSource` publishes attributed, untrusted envelopes into
`AxEventRuntime`. A resource update needs an explicit authenticated `wake`
route and a signature-aware input mapping. Multiple routes can fan one update
out to multiple Agents with independent authorization, ordering, retries, and
run records.

Task continuation is independent of resource policy. Progress defaults to
observe. An input-required or terminal task notification can resume its owning
Agent or Flow. Keep polling available because task notifications are optional.

{{mcpTaskResumeExample}}

## Identity And Network Safety

Map tenant/account identity from verified application authentication state,
not from an MCP session ID. Unmapped notifications remain anonymous and cannot
match authenticated routes. Treat catalog metadata, resources, and
notifications as untrusted remote content.

Secure HTTP and SSRF defaults stay enabled for remote endpoints. Controlled
localhost demos must explicitly allow loopback HTTP; never copy that relaxation
to an arbitrary endpoint.

## Troubleshooting

- **Empty catalog:** force a refresh, inspect negotiated capabilities and auth
  scopes, and check whether the server exposes templates only.
- **Templates but no subscriptions:** construct a concrete URI explicitly.
- **Subscription capability error:** the server lists resources but does not
  advertise resource subscriptions.
- **No notifications:** verify runtime start, the HTTP/SSE listener, server
  notification support, the selected policy, route source/type, identity, and
  localhost policy.
- **Notification but no Agent run:** add an explicit wake route; safe defaults
  observe progress/logs, invalidate catalogs, and resume only owned tasks.

See [MCP]({{langRoot}}/concepts/mcp/), [Event Runtime]({{langRoot}}/concepts/event-runtime/), and the [complete maintainer guide](https://github.com/ax-llm/ax/blob/main/docs/MCP_SUBSCRIPTIONS.md).
