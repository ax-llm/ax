---
name: ax-llm
description: Build or debug TypeScript LLM applications with @ax-llm/ax. Use for Ax providers, structured generation, signatures, agents and tools, memory, MCP, workflows, audio, and optimization.
version: "25.4.6"
---

# Ax For TypeScript

Use this entry point for `@ax-llm/ax`. Read the guides relevant to the task before
writing code; the linked guides are bundled locally and need no extra skill
installation. Load additional guides when the task crosses into another area.

## Choose A Guide

| Task | Read |
| --- | --- |
| Start a program, choose factories, or find basic examples | [Quick reference](references/quickstart.md) |
| Configure providers, models, reasoning, embeddings, routing, or balancing | [AI providers](references/ax-ai.md) |
| Make typed decisions, use Jev, or retain probabilities and scores | [Typesafe / Jev](references/ax-typesafe.md) |
| Define signatures, field types, schemas, or validation | [Signatures](references/ax-signature.md) |
| Generate structured output, stream results, or attach tools | [Generation](references/ax-gen.md) |
| Build agents, use tools, or delegate to child agents | [Agents](references/ax-agent.md) |
| Configure code execution, RLM loops, sessions, or runtime state | [Agent runtime](references/ax-agent-rlm.md) |
| Choose context maps, trajectory policy, optimization, or recall | [Agent context](references/ax-agent-context.md) |
| Add persistent memory, recall, or dynamic skill discovery | [Memory and skills](references/ax-agent-memory-skills.md) |
| Inspect tracing, callbacks, logs, usage, or replay | [Agent observability](references/ax-agent-observability.md) |
| Evaluate or tune agents and their playbooks | [Agent optimization](references/ax-agent-optimize.md) |
| Compose workflow graphs, branches, or parallel steps | [Workflows](references/ax-flow.md) |
| Connect MCP servers, transports, authentication, or catalogs | [MCP](references/ax-mcp.md) |
| Ingest events, schedule wakeups, resume runs, or use stores and sinks | [Event runtime](references/ax-event-runtime.md) |
| Transcribe, synthesize, or exchange conversational audio | [Audio](references/ax-audio.md) |
| Optimize prompts with BootstrapFewShot or GEPA | [Optimization](references/ax-gepa.md) |
| Evolve reusable context or learn from run-end feedback | [Playbooks](references/ax-playbook.md) |
| Improve candidates using reward scores and evaluator feedback | [Refinement](references/ax-refine.md) |

## Essential Conventions

- Prefer `ai(...)`, `ax(...)`, `agent(...)`, `flow(...)`, `optimize(...)`,
  `s(...)`, and `fn(...)`. Use string signatures or fluent `f()` field builders.
- Check the installed package's types and version before borrowing an example
  from another release. These guides ship with the package version above.
- Use provider credentials from the application's environment.

```typescript
import { ai, ax } from '@ax-llm/ax';

const llm = ai({ name: 'openai', apiKey: process.env.OPENAI_APIKEY });
const answer = ax('question:string -> answer:string');
const result = await answer.forward(llm, { question: 'What is a signature?' });
```

For example, an agent with persistent recall needs the agent and memory guides;
a provider-backed workflow needs the provider, generation, and workflow guides.
Specialist skills remain optional for users who want separate skill entries.
