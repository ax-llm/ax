---
name: ax-llm
description: Build or debug TypeScript LLM applications with @ax-llm/ax. Use for Ax providers, structured generation, signatures, agents and tools, memory, MCP, workflows, audio, and optimization.
version: "__VERSION__"
---

# Ax For TypeScript

Use this entry point for `@ax-llm/ax`. Read the guides relevant to the task before
writing code; the linked guides are bundled locally and need no extra skill
installation. Load additional guides when the task crosses into another area.

## Choose A Guide

| Task | Read |
| --- | --- |
| Start a program, choose factories, or find basic examples | [Quick reference](references/quickstart.md) |
| Configure providers, models, reasoning, embeddings, routing, or balancing | [AI providers](ax-ai.md) |
| Make typed decisions, use Jev, or retain probabilities and scores | [Typesafe / Jev](ax-typesafe.md) |
| Define signatures, field types, schemas, or validation | [Signatures](ax-signature.md) |
| Generate structured output, stream results, or attach tools | [Generation](ax-gen.md) |
| Build agents, use tools, or delegate to child agents | [Agents](ax-agent.md) |
| Configure code execution, RLM loops, sessions, or runtime state | [Agent runtime](ax-agent-rlm.md) |
| Choose context maps, trajectory policy, optimization, or recall | [Agent context](ax-agent-context.md) |
| Add persistent memory, recall, or dynamic skill discovery | [Memory and skills](ax-agent-memory-skills.md) |
| Inspect tracing, callbacks, logs, usage, or replay | [Agent observability](ax-agent-observability.md) |
| Evaluate or tune agents and their playbooks | [Agent optimization](ax-agent-optimize.md) |
| Compose workflow graphs, branches, or parallel steps | [Workflows](ax-flow.md) |
| Connect MCP servers, transports, authentication, or catalogs | [MCP](ax-mcp.md) |
| Ingest events, schedule wakeups, resume runs, or use stores and sinks | [Event runtime](ax-event-runtime.md) |
| Transcribe, synthesize, or exchange conversational audio | [Audio](ax-audio.md) |
| Optimize prompts with BootstrapFewShot or GEPA | [Optimization](ax-gepa.md) |
| Evolve reusable context or learn from run-end feedback | [Playbooks](ax-playbook.md) |
| Improve candidates using reward scores and evaluator feedback | [Refinement](ax-refine.md) |

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
