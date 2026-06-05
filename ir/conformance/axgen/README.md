# AxGen Conformance Fixtures

These fixtures describe the focused Python AxGen Core Alpha slice. They are backend-neutral and intentionally small: each fixture captures behavior derived from the TypeScript Ax reference implementation without requiring the generated Python library to execute TypeScript.

Reference areas:

- `src/ax/dsp/parser.ts` and `src/ax/dsp/sig.ts` for string signatures, fluent fields, class outputs, duplicate checks, optional/internal/cache flags, and nested fields.
- `src/ax/dsp/jsonSchema.ts`, `src/ax/dsp/standardSchema.ts`, and `src/ax/dsp/extract/structuredJson.ts` for JSON schema shape, constraints, optional/null handling, and structured-output validation.
- `src/ax/dsp/prompt.ts` for the no-examples/no-memory/default-template prompt subset.
- `src/ax/dsp/functions.ts` and `src/ax/dsp/generate.ts` for native tool calls, validation retries, assertion correction retries, infrastructure retries, and final public output cleanup.
- `src/ax/dsp/asserts.ts` for portable whole-output assertion descriptors: `{ field?, contains?, equals?, return?, message? }`.
- `src/ax/dsp/response/streaming.ts` and `src/ax/dsp/asserts.ts` for deterministic string delta folding and portable streaming assertion descriptors: `{ field, not_contains, message? }`.

The generated Python conformance runner loads these JSON files through `python -m ax.conformance`.
