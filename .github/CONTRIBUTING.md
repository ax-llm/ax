# Contributing to Ax

## External pull requests

Pull requests authored by anyone other than a GitHub organization `OWNER` or
`MEMBER` are limited to handwritten TypeScript. Allowed file extensions are
`.ts`, `.tsx`, `.mts`, and `.cts`.

Do not run AxIR generation or commit changes to AxIR, generated TypeScript,
Python, Java, C++, Go, Rust, generated examples, generated website files,
configuration, lock files, or documentation. If a non-TypeScript change is
useful, describe it in the pull request so a maintainer can recreate it on a
member-owned branch.

Portable TypeScript changes under `src/ax/ai/`, `src/ax/dsp/`,
`src/ax/agent/`, `src/ax/flow/`, `src/ax/mcp/`, or `src/ax/mem/` must add a new
open AxIR backlog entry tied to the pull request. List exact changed files, not
a parent directory:

```bash
npm run axir:backlog -- add \
  --title "Describe the portable behavior" \
  --surface <surface> \
  --impact "Describe how generated languages can drift" \
  --paths <exact-ts-files> \
  --pr <pull-request-number>
```

Commit both `ir/axir-backlog.json` and the rendered
`docs/AXIR_BACKLOG.md`. Existing backlog entries and non-portable exemptions
are maintainer-owned and must not be changed. The `axir-no-impact` escape hatch
does not apply to external pull requests.

The `External Contribution Policy` status runs automatically. If it fails,
remove the listed files or update the backlog entry; the policy comment and
status will refresh on the next push.
