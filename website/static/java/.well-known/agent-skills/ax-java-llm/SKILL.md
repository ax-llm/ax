---
name: "ax-java-llm"
description: "Use when writing Java code with `dev.axllm:ax` for using the generated Ax package, factory functions, package docs, examples, and API reference."
version: "25.4.7"
---
# Ax For Java

Use this entry point when working with `dev.axllm:ax`. Read the guides relevant to the task before writing code. The guides are bundled locally; no additional skill installation is needed. Load more guides when a task crosses into another area.

## Choose A Guide

| Task | Read |
| --- | --- |
| Start a program, choose native factories, or find package docs and examples | [Quick reference](references/quickstart.md) |
| provider clients and model routing | [AxAI Providers](references/ax-java-ai.md) |
| decision signatures and native questions | [Typesafe / Jev](references/ax-java-typesafe.md) |
| audio and realtime provider mappings | [Ax Audio And Realtime](references/ax-java-audio.md) |
| signatures, fields, schemas, and validation | [Ax Signatures](references/ax-java-signature.md) |
| structured generation and tools | [AxGen Structured Generation](references/ax-java-gen.md) |
| RLM agents and tools | [AxAgent](references/ax-java-agent.md) |
| runtime sessions and actor-code execution | [AxAgent RLM Runtime](references/ax-java-agent-rlm.md) |
| memory, recall, and dynamic skill loading | [AxAgent Memory And Skills](references/ax-java-agent-memory-skills.md) |
| traces, logs, usage, and diagnostics | [AxAgent Observability](references/ax-java-agent-observability.md) |
| agent evaluation and optimization artifacts | [AxAgent Optimize](references/ax-java-agent-optimize.md) |
| choosing context maps, policy, optimization, and recall | [AxAgent Context Selection](references/ax-java-agent-context.md) |
| workflow graphs and orchestration | [AxFlow](references/ax-java-flow.md) |
| Pareto optimization and prompt evolution | [Ax GEPA](references/ax-java-gepa.md) |
| evolving context playbooks | [Ax Playbook](references/ax-java-playbook.md) |
| candidate improvement and evaluation feedback | [Ax Refinement Patterns](references/ax-java-refine.md) |

For an agent with persistent recall, read the agent and memory guides. For a provider-backed workflow, read the AI, generation, and flow guides.

## Essential Conventions

- Use this language's native package API and examples; TypeScript call shapes are not interchangeable.
- Check the installed package version against the guide version before using an API from another release.
- Start with a focused guide. Use the package's `API.md`, `axir-api.json`, and `axir-capabilities.json` for exact signatures and supported surfaces.
- Specialist skills remain optional when separate skill entries are useful.
