# agent() Agents

Use `agent()` to build an RLM agent with a typed final response.

```{{fence}}
{{agentCode}}
```

Agents coordinate tools, child agents, runtime sessions, memories, skills, context policies, discovery, recall, shared fields, traces, usage, and final typed responses.

{{< svg "agent-tree" "Agent tree" >}}

## What It Does

`agent()` creates a structured agent program. The agent planner/executor/responder loop can call tools, delegate to child agents, inspect runtime state, ask for clarification, discover tools or skills, recall memory, and finish with a typed output object.

## Core Call Shape

```text
helper = agent(signature, options)
result = helper.forward(aiClient, inputs)
```

## Common Patterns

- Start with a signature that names the final answer fields.
- Add `fn()` tools for host data and side effects.
- Add child agents to the same callable list as tools.
- Use namespaces to keep tool calls readable.
- Enable discovery when available tools are too numerous to include in full.
- Save and restore state around clarification.
- Use context policies for long-running sessions.

### Minimal agent

{{agentMinimalExample}}

### Namespaced tools and discovery

Use a flat `functions` list for small stable sets: local `fn()` tools, child agents, MCP clients, and runtime providers can all live beside each other. The actor sees those callables directly.

{{agentToolsExample}}

Use grouped functions when the catalog is large or easier to reason about by domain. Each group gives the actor a namespace plus module-level selection criteria; with `functionDiscovery: true`, concrete schemas are loaded only after the actor calls `discover(...)`.

{{agentDiscoveryExample}}

Grouped mode keeps big catalogs out of the prompt until needed. Keep the top-level list either flat or grouped. If a child agent belongs inside a group, pass `childAgent.getFunction()` inside the group's `functions` list.

### Memory, skills, and context policy

{{agentMemoryExample}}

{{agentContextPolicyExample}}

### Connect MCP servers

MCP clients can be passed as tool providers after initialization. Use the flat form when the server exposes a small, obvious tool set.

{{agentMCPFlatExample}}

Use grouped discovery when an MCP server has many tools, prompts, or resources. The group gives the actor a namespace and selection criteria before it asks to see detailed schemas.

{{agentMCPGroupedExample}}

## Production Notes

Trace actor turns, tool calls, child-agent calls, clarification, discovery, recall, context growth, token usage, and final typed outputs. Keep host functions narrow and typed. Let fatal infrastructure errors bubble; let task uncertainty become clarification or a typed final answer.

See [Tools]({{langRoot}}/concepts/tools/), [agent() API]({{langRoot}}/api/agent/), and [MCP]({{langRoot}}/concepts/mcp/).
