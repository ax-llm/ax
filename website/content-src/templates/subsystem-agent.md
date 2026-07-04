# agent() Agents

Use `agent()` to build either a short tool-using agent or a long-horizon RLM agent with a typed final response.

```{{fence}}
{{agentCode}}
```

Agents coordinate tools, child agents, runtime sessions, memories, skills, context policies, discovery, recall, shared fields, traces, usage, and final typed responses.

Pick the path by task shape:

- **Short agents:** quick tool calls, small child-agent composition, and compact final responses.
- **Long-horizon agents:** RLM runtime execution, context policy, context maps, memory, skills, and optimizer artifacts.

See [short agent examples]({{langRoot}}/examples/short-agents/) and [Advanced Start]({{langRoot}}/advanced-start/) for the broader Ax path.

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

### Short agent

{{agentMinimalExample}}

### Namespaced tools and discovery

Use a flat `functions` list for small stable sets: local `fn()` tools, child agents, MCP clients, and runtime providers can all live beside each other. The actor sees those callables directly.

{{agentToolsExample}}

Use grouped functions when the catalog is large or easier to reason about by domain. Each group gives the actor a namespace plus module-level selection criteria; with `functionDiscovery: true`, concrete schemas are loaded only after the actor calls `discover(...)`. You rarely need to set the flag yourself: `autoUpgrade` (ON by default) enables discovery automatically once the inline tool docs get large, and likewise keeps oversized input values runtime-only with a truncated prompt preview when they aren't declared in `contextFields`. Explicit settings always win; pass `autoUpgrade: false` to opt out.

{{agentDiscoveryExample}}

For the cross-language smart-default path, see the Smart Defaults Agent in the [long-agent examples]({{langRoot}}/examples/long-agents/).

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
