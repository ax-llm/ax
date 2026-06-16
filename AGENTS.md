# Ax Repository Guide

## What This File Is For

This file should stay short.

Use it for repo-specific rules, workspace conventions, and pointers to the deeper subsystem docs in `src/ax/skills/`.

Do not turn this file into a second full API manual.

## Repository Layout

- `src/ax/` - main library package: `@ax-llm/ax`
- `src/ai-sdk-provider/` - Vercel AI SDK provider: `@ax-llm/ax-ai-sdk-provider`
- `src/examples/` - runnable examples and integration-style demos
- `website/` - Hugo documentation site, deployed to axllm.dev via GitHub Pages
- `docs/` - canonical markdown docs

## Canonical Docs

`docs/` holds the canonical maintainer markdown. The public site under
`website/` is built separately with `npm run website:build` (TypeDoc API
markdown → `npm run website:prepare` → Hugo → Pagefind); never edit the
generated copies under `website/.generated/` or `website/public/`.

## Current Project Defaults

Prefer the modern factory-style API:

- use `ai(...)`, `ax(...)`, `agent(...)`, `flow(...)`, `optimize(...)`
- prefer string signatures and `s(...)`
- prefer `fn(...)` for tools

Avoid deprecated patterns in new code:

- `new AxAI(...)`
- template literal forms like ``ax`...` `` and ``s`...` ``

## Skills As Subsystem Docs

Use the skill files in `src/ax/skills/` as the primary subsystem documentation:

- `src/ax/skills/ax-llm.md` - top-level Ax quick reference
- `src/ax/skills/ax-ai.md` - AI providers, models, presets, embeddings, thinking
- `src/ax/skills/ax-audio.md` - conversational audio input/output in `.chat()`
- `src/ax/skills/ax-signature.md` - signatures, field types, validation, fluent API
- `src/ax/skills/ax-gen.md` - generators and structured output
- `src/ax/skills/ax-agent.md` - agents, runtime, discovery, delegation, shared fields
- `src/ax/skills/ax-agent-optimize.md` - `agent.optimize(...)`, evals, judges, artifacts
- `src/ax/skills/ax-flow.md` - workflows and orchestration
- `src/ax/skills/ax-gepa.md` - Pareto optimization
- `src/ax/skills/ax-learn.md` - self-improving agent patterns

When adding or changing a subsystem, update the relevant skill instead of expanding this file.

Repo-maintainer skills that should not ship in Ax packages live under `tools/*/skills/`.
Use `tools/axir/skills/axir-language-backend/SKILL.md` when adding generated
language backends.
Use `tools/website-md/skills/website-md-language-docs/SKILL.md` when changing
features, languages, examples, API symbols, AxIR capabilities, or generated
website language docs.
Public language features should keep generated package source, public runnable
examples, and website markdown in sync in the same PR.

## AxIR Backlog For Portable TS Changes

If a PR changes portable TypeScript behavior under `src/ax/ai/`, `src/ax/dsp/`,
`src/ax/agent/`, `src/ax/flow/`, or `src/ax/mcp/`, either update
AxIR/conformance in the same PR or add a backlog entry:

```bash
npm run axir:backlog -- add --title "..." --surface axai --impact "..." --paths src/ax/ai/...
npm run axir:backlog:validate
```

Most TS-only PR agents should prefer a backlog entry over attempting an AxIR
migration unless they are already working in `ir/` or `tools/axir/`. AxIR
maintainers can refresh conformance with:

```bash
npm run axir:conformance:check
npm run axir:conformance:write
npm run test:axir
```

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
- run changed runnable examples from the repo root with `npm run tsx src/examples/<example-file>.ts`; API keys are provided through the repo `.env`
