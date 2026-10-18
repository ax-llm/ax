---
name: "ax-python-llm"
description: "Use when writing Python code with `axllm` for using the generated Ax package, factory functions, package docs, examples, and API reference."
version: "25.4.3"
---
# Ax For Python

Use this entry point when working with `axllm`. Read the guides relevant to the task before writing code. The guides are bundled locally; no additional skill installation is needed. Load more guides when a task crosses into another area.

## Choose A Guide

| Task | Read |
| --- | --- |
| Start a program, choose native factories, or find package docs and examples | [Quick reference](references/quickstart.md) |
| provider clients and model routing | [AxAI Providers](references/ax-python-ai.md) |
| decision signatures and native questions | [Typesafe / Jev](references/ax-python-typesafe.md) |
| audio and realtime provider mappings | [Ax Audio And Realtime](references/ax-python-audio.md) |
| signatures, fields, schemas, and validation | [Ax Signatures](references/ax-python-signature.md) |
| structured generation and tools | [AxGen Structured Generation](references/ax-python-gen.md) |
| RLM agents and tools | [AxAgent](references/ax-python-agent.md) |
| runtime sessions and actor-code execution | [AxAgent RLM Runtime](references/ax-python-agent-rlm.md) |
| memory, recall, and dynamic skill loading | [AxAgent Memory And Skills](references/ax-python-agent-memory-skills.md) |
| traces, logs, usage, and diagnostics | [AxAgent Observability](references/ax-python-agent-observability.md) |
| agent evaluation and optimization artifacts | [AxAgent Optimize](references/ax-python-agent-optimize.md) |
| choosing context maps, policy, optimization, and recall | [AxAgent Context Selection](references/ax-python-agent-context.md) |
| workflow graphs and orchestration | [AxFlow](references/ax-python-flow.md) |
| Pareto optimization and prompt evolution | [Ax GEPA](references/ax-python-gepa.md) |
| evolving context playbooks | [Ax Playbook](references/ax-python-playbook.md) |
| candidate improvement and evaluation feedback | [Ax Refinement Patterns](references/ax-python-refine.md) |

For an agent with persistent recall, read the agent and memory guides. For a provider-backed workflow, read the AI, generation, and flow guides.

## Essential Conventions

- Use this language's native package API and examples; TypeScript call shapes are not interchangeable.
- Check the installed package version against the guide version before using an API from another release.
- Start with a focused guide. Use the package's `API.md`, `axir-api.json`, and `axir-capabilities.json` for exact signatures and supported surfaces.
- Specialist skills remain optional when separate skill entries are useful.
