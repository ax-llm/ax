# Ax Repository Guide

## What This File Is For

This file should stay short.

Use it for repo-specific rules, workspace conventions, and pointers to the deeper subsystem docs in `src/ax/skills/`.

Do not turn this file into a second full API manual.

## Repository Layout

- `src/ax/` - main library package: `@ax-llm/ax`
- `src/ai-sdk-provider/` - Vercel AI SDK provider: `@ax-llm/ax-ai-sdk-provider`
- `src/examples/` - runnable examples and integration-style demos
- `src/docs/` - docs site sources
- `docs/` - canonical markdown docs

## Canonical Docs

Edit files in `docs/`, not the generated copies under `src/docs/`.

Example:

- edit `docs/AI.md`
- do not edit `src/docs/src/content/docs/ai.md`

## Current Project Defaults

Prefer the modern factory-style API:

- use `ai(...)`, `ax(...)`, `agent(...)`, `flow(...)`
- prefer string signatures and `s(...)`
- prefer `fn(...)` for tools

Avoid deprecated patterns in new code:

- `new AxAI(...)`
- template literal forms like ``ax`...` `` and ``s`...` ``

## Skills As Subsystem Docs

Use the skill files in `src/ax/skills/` as the primary subsystem documentation:

- `src/ax/skills/ax-llm.md` - top-level Ax quick reference
- `src/ax/skills/ax-ai.md` - AI providers, models, presets, embeddings, thinking
- `src/ax/skills/ax-signature.md` - signatures, field types, validation, fluent API
- `src/ax/skills/ax-gen.md` - generators and structured output
- `src/ax/skills/ax-agent.md` - agents, runtime, discovery, delegation, shared fields
- `src/ax/skills/ax-agent-optimize.md` - `agent.optimize(...)`, evals, judges, artifacts
- `src/ax/skills/ax-flow.md` - workflows and orchestration
- `src/ax/skills/ax-gepa.md` - Pareto optimization
- `src/ax/skills/ax-learn.md` - self-improving agent patterns

When adding or changing a subsystem, update the relevant skill instead of expanding this file.

## Package Management

Install dependencies from the repo root with workspace flags:

```bash
npm i <package-name> --workspace=@ax-llm/ax
npm i <package-name> --workspace=@ax-llm/ax-ai-sdk-provider
npm i <package-name> --workspace=@ax-llm/ax-examples
npm i <package-name> --workspace=@ax-llm/ax-docs
```

Do not run `npm install` inside individual workspace folders.

## Development Commands

```bash
npm run build
npm run fix
npm run test
npm run test --workspace=@ax-llm/ax
npm run dev --workspace=@ax-llm/ax
npm run tsx ./src/examples/<example-file>.ts
npm run build:index --workspace=@ax-llm/ax
```

## Important Repo Constraints

- `src/ax/index.ts` is auto-generated; do not edit it manually
- if exports change, update source exports and run `npm run build:index --workspace=@ax-llm/ax`
- Node.js `>= 20`
- ES modules only
- keep `src/ax/` browser-compatible; do not add `fs`, `path`, or `os` there
- never commit API keys; use environment variables

## Examples

Examples should usually follow these conventions:

- top-level executable code
- minimal logging
- no unnecessary wrappers
- export reusable components when helpful
