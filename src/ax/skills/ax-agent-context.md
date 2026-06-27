---
name: ax-agent-context
description: This skill helps an LLM pick the right AxAgent context tool for a job - contextMap for recurring corpora, contextPolicy presets for within-run trajectory compaction, agent.optimize (ACE + GEPA) for offline strategy and instruction tuning, and recall/memories + skills for per-turn retrieval. Use when the user asks "which context feature should I use", confuses contextMap with contextPolicy or memory, or wants a decision guide for long-context agents. For contextPolicy/contextMap codegen use ax-agent-rlm; for recall/skills use ax-agent-memory-skills; for ACE/GEPA use ax-agent-optimize.
version: "__VERSION__"
---

# AxAgent Context Selection (@ax-llm/ax)

Use this skill to route a context-management need to the right AxAgent tool, then open the matching codegen skill. AxAgent manages four distinct context objects; choosing the wrong one is the usual mistake. Do not write tutorial prose; pick the tool and hand off.

## Pick The Right Context Tool

| Need | Object | Scope | Use | Next skill |
| --- | --- | --- | --- | --- |
| Many tasks over the same large corpus (repo, doc set, dataset) | Context map | recurring corpus, persists across runs | `contextMap` | `ax-agent-rlm` |
| One long run whose own history must stay under control | Trajectory compaction | this run only | `contextPolicy: { preset, budget }` | `ax-agent-rlm` |
| Improve task strategy offline from examples | Strategy playbook | a task, offline | `agent.optimize(...)` with ACE | `ax-agent-optimize` |
| Evolve the prompt/instructions offline | Instruction text | a program, offline | `agent.optimize(...)` with GEPA | `ax-agent-optimize` |
| Pull task-relevant facts or guides for a turn | Retrieval | one turn | `recall(...)` / skills | `ax-agent-memory-skills` |

## Defaults

- Recurring corpus + many different questions -> `contextMap` (persistent orientation cache).
- One long multi-turn run with prompt pressure -> `contextPolicy: { preset: 'checkpointed', budget: 'balanced' }`; move to `lean` for very long runs with strong models, `full` for short tasks or weak models.
- Improve how the agent works, offline -> `agent.optimize(...)` (ACE playbook and/or GEPA instructions).
- Fetch facts or guides on demand -> `recall(...)` for memories, `discover({ skills })` for skill guides.

## Anti-Patterns

- Do not use `contextMap` to compress a single run's history. That is `contextPolicy`.
- Do not use `contextPolicy` to carry knowledge across runs. That is `contextMap`.
- Do not hand-build a strategy playbook in the prompt. Evolve it offline with `agent.optimize(...)` (ACE).
- Do not stuff a whole corpus into the prompt every run. Use a context map plus on-demand `recall(...)`.
- Do not confuse runtime skills (`discover({ skills })` guides) with these installable codegen skills.

## See Also

- `ax-agent-rlm` - contextPolicy presets, context maps, and runtime sessions.
- `ax-agent-memory-skills` - recall, memories, and dynamic skill loading.
- `ax-agent-optimize` - ACE and GEPA via `agent.optimize(...)`.
- `ax-agent` - core agent shape and the final/clarification protocol.
