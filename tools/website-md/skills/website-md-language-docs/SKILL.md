---
name: website-md-language-docs
description: Use when changing Ax website language docs, language-specific snippets, examples, API symbol mappings, generated package capabilities, or adding a new website language route. Keeps the markdown-only Hugo site source-audited and generated from repo truth.
---

# Website-MD Language Docs

Use this skill when a change affects `website/`, Ax public APIs, examples, AxIR package docs, language capabilities, or docs that should appear in language-prefixed markdown routes.

## Workflow

1. Inspect current repo truth first:
   - public exports in `src/ax/index.ts`
   - subsystem skills in `src/ax/skills/`
   - examples via `npm run example -- list` and the files it names
   - generated package metadata under `packages/{python,java,cpp,go,rust}/`
2. Update common prose once in `website/content-src/templates/`.
3. Put language-specific install commands, snippets, package labels, and API section mappings in `website/content-src/languages/<language>.json`.
   - Snippets may be plain arrays/strings for simple text, or metadata objects with `code`, `fence`, `verified`, `illustrative`, `sourcePath`, `requiresCredentials`, and `notes`.
   - Prefer `sourcePath` pointing at a checked-in runnable example when a snippet is meant to be copy/paste runnable.
   - Mark conceptual generated-language equivalents as `illustrative` or let the generator label them automatically.
4. Add or reorder pages only in `website/content-src/site-map.json`; generated pages read this manifest.
5. Do not hand-edit `website/.generated/` or generated package docs. If AxIR package truth is stale, refresh it with `npm run axir:generate-packages`.
6. Keep old Astro docs untouched unless the user explicitly asks to change that site.

## Feature, Language, And Example Sync

- When adding a public feature or language capability, update the runnable public examples under `src/examples/<language>/<group>/` with `ax-example` headers before updating generated markdown.
- Keep the public example catalog provider-backed: required header fields are `title`, `group`, `description`, `provider`, `env`, and `level`; use `story` only for examples that belong in Advanced Start.
- Maintain the core public groups for each language: `generation`, `short-agents`, `flows`, `optimization`, and `audio` need beginner, intermediate, and advanced examples.
- Keep generated package examples under `packages/<language>/examples` for AxIR verification separate from the public website catalog.
- After language or feature changes, validate the catalog with `npm run example -- list --json` and regenerate the website with `npm run website:prepare`.

## API Mapping

- TypeScript subsystem API pages map TypeDoc pages from `build/apidocs`.
- Generated language subsystem API pages map sections from `packages/<language>/axir-api.json`.
- Keep subsystem mappings small and intentional: `ai`, `ax`, `s`, `agent`, and `optimize`.
- Keep API landing pages curated: everyday symbols belong in “Most Used”; noisy long-tail symbols can stay collapsed under advanced/full reference.

## Checks

Run the narrow checks for the surface you changed, then run:

```bash
npm run doc:build:markdown
npm run axir:check-packages
npm run example -- list
npm run example -- list --json
npm run website:prepare
npm run website:check
npm run test:examples:generated
npx biome check package.json scripts/website-prepare.mjs scripts/check-website-links.mjs .github/workflows/ci.yml --files-ignore-unknown=true
git diff --check
```

If Hugo is not installed locally, install or point `PATH` at the pinned Hugo binary used by CI before running `website:check`.
