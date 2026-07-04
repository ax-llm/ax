---
name: ax-agent-context
description: This skill helps an LLM pick the right AxAgent context tool for a job - contextMap for recurring corpora, contextPolicy presets for within-run trajectory compaction, agent.optimize for offline GEPA instruction/demo tuning, agent.playbook for an evolving context playbook (offline evolve + online update), and recall/memories + skills for per-turn retrieval. Use when the user asks "which context feature should I use", confuses contextMap with contextPolicy or memory, or wants a decision guide for long-context agents. For contextPolicy/contextMap codegen use ax-agent-rlm; for recall/skills use ax-agent-memory-skills; for agent.optimize or agent.playbook use ax-agent-optimize.
version: "22.0.9"
---

# AxAgent Context Selection (@ax-llm/ax)

Use this skill to route a context-management need to the right AxAgent tool, then open the matching codegen skill. AxAgent manages four distinct context objects; choosing the wrong one is the usual mistake. Do not write tutorial prose; pick the tool and hand off.

## Pick The Right Context Tool

| Need | Object | Scope | Use | Next skill |
| --- | --- | --- | --- | --- |
| Many tasks over the same large corpus (repo, doc set, dataset) | Context map | recurring corpus, persists across runs | `contextMap` | `ax-agent-rlm` |
| One long run whose own history must stay under control | Trajectory compaction | this run only | `contextPolicy: { preset, budget }` | `ax-agent-rlm` |
| Evolve task strategy from examples or live feedback | Context playbook | a stage, offline + online | `agent.playbook(...)` | `ax-agent-optimize` |
| Tune the prompt/instructions/demos offline | Instruction text | a program, offline | `agent.optimize(...)` (GEPA) | `ax-agent-optimize` |
| Pull task-relevant facts or guides for a turn | Retrieval | one turn | `recall(...)` / skills | `ax-agent-memory-skills` |

## Defaults

- Recurring corpus + many different questions -> `contextMap` (persistent orientation cache).
- One long multi-turn run with prompt pressure -> `contextPolicy: { preset: 'checkpointed', budget: 'balanced' }`; move to `lean` for very long runs with strong models, `full` for short tasks or weak models.
- Evolve a context playbook -> `agent.playbook(...)` (offline from examples, or online from live feedback).
- Tune instructions/demos offline -> `agent.optimize(...)` (GEPA).
- Fetch facts or guides on demand -> `recall(...)` for memories, `discover({ skills })` for skill guides.
- A single oversized input value (a pasted doc, a big JSON blob) -> do nothing; `autoUpgrade` (ON by default) keeps it runtime-only with a prompt preview. Reach for `contextFields` only when you want a specific inline policy or the value is a large required non-string field. See `ax-agent-rlm`.

## Anti-Patterns

- Do not use `contextMap` to compress a single run's history. That is `contextPolicy`.
- Do not use `contextPolicy` to carry knowledge across runs. That is `contextMap`.
- Do not hand-build a strategy playbook in the prompt. Evolve it with `agent.playbook(...)`.
- Do not stuff a whole corpus into the prompt every run. Use a context map plus on-demand `recall(...)`.
- Do not confuse runtime skills (`discover({ skills })` guides) with these installable codegen skills.

## See Also

- `ax-agent-rlm` - contextPolicy presets, context maps, and runtime sessions.
- `ax-agent-memory-skills` - recall, memories, and dynamic skill loading.
- `ax-agent-optimize` - GEPA via `agent.optimize(...)` and the context playbook via `agent.playbook(...)`.
- `ax-agent` - core agent shape and the final/clarification protocol.
