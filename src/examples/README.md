# Ax Examples

Public examples live under `src/examples/<language>/<group>/` and are generated
from each file's `ax-example` metadata header. Every public example calls a real
provider API and may require environment variables from the repo `.env`.

The public catalog currently requires beginner, intermediate, and advanced
examples for each language in `generation`, `short-agents`, `long-agents`,
`flows`, `optimization`, and `audio`. The `long-agents` group holds the
flagship DSPy+RLM+Peek agents (large context, native tools at scale, and skills
+ memory) in all six languages. Add `story: <number>` to a header only when the
example should appear in the website Advanced Start path.

List the current catalog:

```bash
npm run example -- list
npm run example -- list --json
```

Run an example from the repo root:

```bash
npm run example -- typescript src/examples/typescript/generation/axgen-openai.ts
npm run example -- python src/examples/python/generation/axgen-openai.py
npm run example -- java src/examples/java/generation/BasicGenerationExample.java
npm run example -- cpp src/examples/cpp/generation/basic_generation.cpp
npm run example -- go src/examples/go/generation/basic_generation.go
npm run example -- rust src/examples/rust/generation/basic_generation.rs
```

Internal generated package fixtures remain under `packages/<language>/examples`
for AxIR verification, but they are not part of the public examples catalog.
