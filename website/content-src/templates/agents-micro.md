# Micro Agents

The smallest thing that acts: one signature, a few tools, a typed reply. Most agents in a production codebase should be this size.

{{agentMinimalExample}}

That is the whole program. There is no prompt to write, no parser to maintain, no retry loop to hand-roll — the signature generates all three, and the reply comes back as typed data.

## Zero Config Is The Full Harness

A micro agent is not a lesser mode. With no configuration, `agent()` already has the complete pipeline — distiller, executor with a live runtime session, responder — the same machinery the [long-horizon tier]({{langRoot}}/agents/long-horizon/) uses. You just haven't needed to touch any of it yet. (When a micro agent has no tools to run, the distiller answers directly and the executor stage is skipped — one fewer model call, same typed output.) Two practical consequences:

- **Typed outputs are the system boundary.** The reply is validated against the signature and retried with feedback on mismatch, so downstream code consumes data, not prose.
- **Actions really run.** Tools execute in the runtime; results are inspected before the agent answers. A micro agent that looks up an order answers from the record it fetched, not from a guess.

## Keeping It Micro

- One signature, one job. If the task description needs the word "then", consider two agents or a [flow]({{langRoot}}/concepts/dspy/).
- Pass tools flat — `functions: [lookupOrder, sendReply]`. At this size every callable is obviously relevant, and flat inline tools are the most reliable shape for small models (grouped discovery earns its keep later, at catalog scale).
- Small models are the point. Micro agents run well on cheap, fast models — see [Performance]({{langRoot}}/agents/performance/) for measured model guidance.

## When To Graduate

Move up a tier when one of these appears:

| Signal | Go to |
| --- | --- |
| The tool list is growing past what fits comfortably in one prompt | [Standard]({{langRoot}}/agents/standard/) — namespaces, groups, discovery |
| A specialist should own part of the job (its own signature, tools, identity) | [Standard]({{langRoot}}/agents/standard/) — child agents |
| An input field is getting bulky (logs, ledgers, transcripts) | [Long-horizon]({{langRoot}}/agents/long-horizon/) — context fields |
| Runs are getting long, or the same material is queried repeatedly | [Long-horizon]({{langRoot}}/agents/long-horizon/) — policies, maps, memory |

Runnable code: [agent examples]({{langRoot}}/examples/short-agents/) and the [agent() API]({{langRoot}}/api/agent/).
