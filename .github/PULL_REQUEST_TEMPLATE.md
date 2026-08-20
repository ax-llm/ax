- **What kind of change does this PR introduce?** (Bug fix, feature, docs update, ...)

- **What is the current behavior?** (You can also link to an open issue here)

- **What is the new behavior (if this is a feature change)?**

- **AxIR portable behavior check**:
  External contributors must submit handwritten TypeScript only. Do not commit AxIR or generated-language changes.
  If this changes portable TypeScript behavior, add a PR-bound entry with exact changed paths:
  `npm run axir:backlog -- add --title "..." --surface <surface> --impact "..." --paths <exact-ts-files> --pr <pull-request-number>`.
  Commit only the resulting `ir/axir-backlog.json` and `docs/AXIR_BACKLOG.md` alongside the TypeScript change.

- **Other information**:
